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
          <img src="/logo-text.png" alt="GhostTyper" className="h-16 mx-auto mb-6" />
          <p className="text-xl text-text-secondary mb-10 leading-relaxed">
            Your thoughts, decoded and distilled.
          </p>
          <Link
            href="/login"
            className="gradient-accent text-white px-8 py-3 rounded-full text-base font-medium hover:gradient-accent-hover transition-all shadow-lg hover:shadow-accent-orange/20"
          >
            Jetzt starten
          </Link>
        </div>
      </div>
    </>
  );
}
