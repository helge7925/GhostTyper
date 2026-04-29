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

export const authOptions = {
  providers,
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user, account }) {
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
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  secret: process.env.NEXTAUTH_SECRET,
};

export default NextAuth(authOptions);
