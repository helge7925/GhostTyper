import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { query } from '../../../lib/db';
import { checkRateLimit } from '../../../lib/rate-limit';
import { normalizeEmail } from '../../../lib/email';

if (!process.env.NEXTAUTH_SECRET) {
  throw new Error('NEXTAUTH_SECRET ist nicht gesetzt. Bitte Umgebungsvariablen prüfen.');
}

const providers = [];

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

        const result = await query(
          'SELECT id, email, name, password_hash, role FROM users WHERE lower(email) = $1',
          [normalizedEmail]
        );

        const user = result.rows[0];
        if (!user) {
          return null;
        }

        const valid = await bcrypt.compare(credentials.password, user.password_hash);
        if (!valid) {
          return null;
        }

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
          if (!normalizedEmail) return token;
          const existing = await query(
            'SELECT id, email, name, role FROM users WHERE lower(email) = $1',
            [normalizedEmail]
          );
          const dbUser = existing.rows[0] || (await query(
            `INSERT INTO users (email, name, password_hash, role)
             VALUES ($1, $2, $3, 'user')
             RETURNING id, email, name, role`,
            [
              normalizedEmail,
              user.name || normalizedEmail,
              await bcrypt.hash(randomUUID(), 12),
            ]
          )).rows[0];

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
