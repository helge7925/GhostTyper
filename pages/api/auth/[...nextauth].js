import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { query } from '../../../lib/db';
import { checkRateLimit } from '../../../lib/rate-limit';
import { normalizeEmail } from '../../../lib/email';

if (!process.env.NEXTAUTH_SECRET) {
  throw new Error('NEXTAUTH_SECRET ist nicht gesetzt. Bitte Umgebungsvariablen prüfen.');
}

export const authOptions = {
  providers: [
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
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
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
