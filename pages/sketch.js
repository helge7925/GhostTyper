import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function SketchPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/');
  }, [router]);
  return null;
}