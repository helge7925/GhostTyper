import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useEffect } from 'react';

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/upload');
    }
  }, [status, router]);

  if (status === 'loading' || status === 'authenticated') {
    return null;
  }

  return (
    <>
      <Head>
        <title>GhostTyper</title>
      </Head>

      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="text-center max-w-lg">
          <h1 className="text-4xl font-semibold text-text-primary mb-4">
            GhostTyper
          </h1>
          <p className="text-lg text-text-secondary mb-8">
            Your thought, decoded and distilled.
          </p>
          <Link
            href="/login"
            className="gradient-accent text-white px-6 py-2.5 rounded-full text-sm font-medium hover:gradient-accent-hover transition-colors"
          >
            Anmelden
          </Link>
        </div>
      </div>
    </>
  );
}
