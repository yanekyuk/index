import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { useAuthContext } from '@/contexts/AuthContext';
import ClientLayout from '@/components/ClientLayout';
import { ContentContainer } from '@/components/layout';
import ApiKeysSection from './api-keys';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate('/');
  }, [authLoading, isAuthenticated, navigate]);

  if (authLoading || !isAuthenticated) {
    return (
      <ClientLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout>
      <div className="px-6 lg:px-8 py-8">
        <ContentContainer>
          <h1 className="text-2xl font-bold text-black font-ibm-plex-mono mb-8">Settings</h1>
          <ApiKeysSection />
        </ContentContainer>
      </div>
    </ClientLayout>
  );
}

export const Component = SettingsPage;
