'use client';

import { useEffect, use } from 'react';
import { useRouter } from 'next/navigation';

interface IntentPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default function IntentPage({ params }: IntentPageProps) {
  const resolvedParams = use(params);
  const router = useRouter();

  useEffect(() => {
    // Redirect to home - intents are now managed via AI chat
    router.replace('/');
  }, [router, resolvedParams.id]);

  return null;
}
