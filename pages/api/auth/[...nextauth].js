import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { query } from '../../../lib/db';

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Passwort', type: 'password' },
      },
      async authorize(credentials) {
        const result = await query(
          'SELECT id, email, name, password_hash, role FROM users WHERE email = $1',
          [credentials.email]
        );

        const user = result.rows[0];
        console.log('Authorize: User found in DB:', user ? { id: user.id, email: user.email, role: user.role } : 'None');
        if (!user) {
          console.log('Authorize: User not found for email:', credentials.email);
          return null;
        }

        const valid = await bcrypt.compare(credentials.password, user.password_hash);
        console.log('Authorize: Password comparison result:', valid);
        if (!valid) {
          console.log('Authorize: Invalid password for user:', credentials.email);
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
