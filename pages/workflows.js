import Head from 'next/head';
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import LoadingSpinner from '../components/LoadingSpinner';

export default function WorkflowsPage() {
  const router = useRouter();
  const { status } = useSession();

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/');
    } else if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  return (
    <>
      <Head>
        <title>Dashboard - GhostTyper</title>
      </Head>
      <LoadingSpinner />
    </>
  );
}
