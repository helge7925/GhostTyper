import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function InfografikPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/');
  }, [router]);
  return null;
}