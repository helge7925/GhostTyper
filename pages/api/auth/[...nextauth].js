import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { query } from '../../../lib/db';
import { checkRateLimit } from '../../../lib/rate-limit';
import { normalizeEmail } from '../../../lib/email';
import { trackSecurityEvent } from '../../../lib/observability';
import {
  isEmailLockedOut,
  recordFailedLogin,
  recordSuccessfulLogin,
} from '../../../lib/login-attempts';

if (!process.env.NEXTAUTH_SECRET) {
  throw new Error('NEXTAUTH_SECRET ist nicht gesetzt. Bitte Umgebungsvariablen prüfen.');
}

// M6 (cybersecurity-audit-2026-05-09): close the user-enumeration timing
// side channel on the credentials provider. Pre-Phase-3, a non-existent
// email returned `null` immediately while an existing email always paid
// the ~100 ms bcrypt.compare cost. Even with rate-limiting, the timing
// gap leaks "this email exists" to anyone who can wall-clock a single
// failed login. Fix: when the user lookup misses, run bcrypt.compare
// against a fixed dummy hash so the response time matches.
//
// The dummy hash is pre-computed at module-load time using bcryptjs's
// 12-round cost (matching new-user creation), so the constant is
// real-cost equivalent. The plaintext doesn't matter — comparison will
// always fail, we only care about the timing.
const DUMMY_BCRYPT_HASH = bcrypt.hashSync(
  'd0_n0t_match_anything_b75e2c8b_dummy',
  12,
);

const providers = [];
const OIDC_LINK_BY_EMAIL = String(process.env.OIDC_LINK_BY_EMAIL || 'false').toLowerCase() === 'true';
// M7: when LINK_BY_EMAIL is on (typically a one-off migration window),
// default behaviour is still to auto-create a user record if the email
// doesn't exist yet. Operators who want SSO restricted to pre-existing
// accounts only — even during the migration window — can flip
// OIDC_AUTO_PROVISION=false and the auto-INSERT path is disabled, so
// SSO logins for unknown emails fail closed instead of silently
// minting a new `role=user` row.
const OIDC_AUTO_PROVISION = String(process.env.OIDC_AUTO_PROVISION || 'true').toLowerCase() !== 'false';
const OIDC_ALLOWED_EMAIL_DOMAINS = new Set(
  String(process.env.OIDC_ALLOWED_EMAIL_DOMAINS || '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean)
);

function parseEmailVerified(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function isAllowedOidcDomain(normalizedEmail) {
  if (!normalizedEmail) return false;
  if (OIDC_ALLOWED_EMAIL_DOMAINS.size === 0) return true;
  const domain = normalizedEmail.split('@')[1]?.toLowerCase() || '';
  return OIDC_ALLOWED_EMAIL_DOMAINS.has(domain);
}

async function resolveOidcUser({ provider, providerAccountId, normalizedEmail, displayName }) {
  const bound = await query(
    `SELECT u.id, u.email, u.name, u.role
       FROM oidc_account_bindings b
       JOIN users u ON u.id = b.user_id
      WHERE b.provider = $1 AND b.provider_account_id = $2
      LIMIT 1`,
    [provider, providerAccountId]
  );
  if (bound.rows[0]) return bound.rows[0];

  if (!OIDC_LINK_BY_EMAIL) return null;
  const existing = await query(
    'SELECT id, email, name, role FROM users WHERE lower(email) = $1 LIMIT 1',
    [normalizedEmail]
  );
  let dbUser = existing.rows[0];
  if (!dbUser) {
    if (!OIDC_AUTO_PROVISION) {
      trackSecurityEvent('oidc_auto_provision_blocked', {
        route: '/api/auth/[...nextauth]',
        provider,
      });
      return null;
    }
    dbUser = (await query(
      `INSERT INTO users (email, name, password_hash, role)
       VALUES ($1, $2, $3, 'user')
       RETURNING id, email, name, role`,
      [
        normalizedEmail,
        displayName || normalizedEmail,
        await bcrypt.hash(randomUUID(), 12),
      ]
    )).rows[0];
  }

  await query(
    `INSERT INTO oidc_account_bindings (provider, provider_account_id, user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (provider, provider_account_id) DO NOTHING`,
    [provider, providerAccountId, dbUser.id]
  );
  return dbUser;
}

if (process.env.AUTH_CREDENTIALS_ENABLED === 'true') {
  providers.push(
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Passwort', type: 'password' },
      },
      async authorize(credentials, req) {
        const rate = await checkRateLimit(req, {
          keyPrefix: 'auth-login',
          limit: 10,
          windowMs: 5 * 60 * 1000,
        });
        if (!rate.allowed) {
          return null;
        }

        const normalizedEmail = normalizeEmail(credentials?.email);
        if (!normalizedEmail || !credentials?.password) {
          return null;
        }

        // M4: per-email lockout check before any DB lookup or password
        // hashing. Distributed brute-force across many source IPs would
        // otherwise bypass the per-IP rate-limiter.
        const lockout = await isEmailLockedOut(normalizedEmail);
        if (lockout.locked) {
          trackSecurityEvent('login_email_locked', {
            route: '/api/auth/[...nextauth]',
            failureCount: lockout.failureCount,
          });
          return null;
        }

        const result = await query(
          'SELECT id, email, name, password_hash, role FROM users WHERE lower(email) = $1',
          [normalizedEmail]
        );

        const user = result.rows[0];
        // Always run bcrypt.compare so the response timing does not leak
        // whether the email exists. When `user` is missing we compare
        // against a fixed dummy hash; the result is discarded.
        const passwordHash = user ? user.password_hash : DUMMY_BCRYPT_HASH;
        const valid = await bcrypt.compare(credentials.password, passwordHash);
        if (!user || !valid) {
          await recordFailedLogin(normalizedEmail);
          return null;
        }

        await recordSuccessfulLogin(normalizedEmail);
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  );
}

if (process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET) {
  providers.push(
    {
      id: 'oidc',
      name: process.env.OIDC_PROVIDER_NAME || 'Single Sign-On',
      type: 'oauth',
      wellKnown: `${process.env.OIDC_ISSUER.replace(/\/$/, '')}/.well-known/openid-configuration`,
      authorization: { params: { scope: 'openid email profile' } },
      idToken: true,
      checks: ['pkce', 'state'],
      clientId: process.env.OIDC_CLIENT_ID,
      clientSecret: process.env.OIDC_CLIENT_SECRET,
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name || profile.preferred_username || profile.email,
          email: profile.email,
          emailVerified: parseEmailVerified(profile.email_verified),
          image: profile.picture,
        };
      },
    }
  );
}

async function loadOrgMemberships(userId) {
  if (!userId) return [];
  try {
    const result = await query(
      `SELECT o.id, o.name, o.slug, o.plan, o.is_personal, m.role
         FROM organization_members m
         JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = $1
        ORDER BY o.is_personal DESC, m.joined_at ASC`,
      [userId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      plan: row.plan,
      isPersonal: !!row.is_personal,
      role: row.role,
    }));
  } catch (error) {
    // Phase 4a may not yet be backfilled in some environments — fall back to
    // an empty list rather than blocking auth.
    if (error?.code === '42P01' || error?.code === '42703') return [];
    throw error;
  }
}

export const authOptions = {
  providers,
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user, account, trigger, session: clientSession }) {
      // Initial sign-in
      if (user) {
        if (account?.provider === 'oidc') {
          const normalizedEmail = normalizeEmail(user.email);
          const providerAccountId = String(account.providerAccountId || '').trim();
          if (!normalizedEmail || !providerAccountId) {
            throw new Error('OIDC_IDENTITY_INCOMPLETE');
          }
          if (!user.emailVerified) {
            trackSecurityEvent('oidc_email_unverified', {
              route: '/api/auth/[...nextauth]',
              provider: account.provider,
            });
            throw new Error('OIDC_EMAIL_NOT_VERIFIED');
          }
          if (!isAllowedOidcDomain(normalizedEmail)) {
            trackSecurityEvent('oidc_domain_rejected', {
              route: '/api/auth/[...nextauth]',
              provider: account.provider,
              domain: normalizedEmail.split('@')[1] || null,
            });
            throw new Error('OIDC_EMAIL_DOMAIN_NOT_ALLOWED');
          }
          const dbUser = await resolveOidcUser({
            provider: account.provider,
            providerAccountId,
            normalizedEmail,
            displayName: user.name,
          });
          if (!dbUser) {
            trackSecurityEvent('oidc_not_linked', {
              route: '/api/auth/[...nextauth]',
              provider: account.provider,
            });
            throw new Error('OIDC_ACCOUNT_NOT_LINKED');
          }

          token.id = dbUser.id;
          token.role = dbUser.role;
          token.name = dbUser.name;
          token.email = dbUser.email;
        } else {
          token.id = user.id;
          token.role = user.role;
        }
      }

      // Refresh memberships on first sign-in or when the client requests an
      // update (e.g. after switching orgs or accepting an invite).
      const needsRefresh = Boolean(user) || trigger === 'update';
      if (token.id && (needsRefresh || !Array.isArray(token.organizations))) {
        const memberships = await loadOrgMemberships(token.id);
        token.organizations = memberships;

        // Apply requested org-switch if it was passed via update().
        const requestedOrg = clientSession?.currentOrganizationId;
        if (
          requestedOrg !== undefined &&
          memberships.some((m) => String(m.id) === String(requestedOrg))
        ) {
          token.currentOrganizationId = requestedOrg;
        }

        // Default to the personal org (or the first available) when none set.
        if (!token.currentOrganizationId && memberships.length > 0) {
          const personal = memberships.find((m) => m.isPersonal) || memberships[0];
          token.currentOrganizationId = personal.id;
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.organizations = Array.isArray(token.organizations) ? token.organizations : [];
      session.user.currentOrganizationId = token.currentOrganizationId ?? null;
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  secret: process.env.NEXTAUTH_SECRET,
};

export default NextAuth(authOptions);
