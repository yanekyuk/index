'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function ChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams?.get('sessionId');

  useEffect(() => {
    // Redirect to home page, preserving sessionId if present
    if (sessionId) {
      router.replace(`/?sessionId=${sessionId}`);
    } else {
      router.replace('/');
    }
  }, [router, sessionId]);

  return null;
}
