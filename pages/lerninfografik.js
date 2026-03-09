import { useEffect } from 'react';
import { useRouter } from 'next/router';
import LoadingSpinner from '../components/LoadingSpinner';

export default function LerninfografikPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/infografik');
  }, [router]);

  return <LoadingSpinner />;
}
