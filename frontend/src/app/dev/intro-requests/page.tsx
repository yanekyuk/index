import ClientLayout from '@/components/ClientLayout';
import { ContentContainer } from '@/components/layout';
import IntroductionRequestFeed from '@/components/IntroductionRequestFeed';

export default function IntroRequestsDevPage() {
  return (
    <ClientLayout>
      <div className="px-6 lg:px-8 py-10">
        <ContentContainer>
          <div className="mb-8">
            <p className="text-xs font-ibm-plex-mono text-gray-400 uppercase tracking-wider mb-1">
              Component Preview
            </p>
            <h1 className="text-2xl font-bold text-black font-ibm-plex-mono">
              Introduction Requests
            </h1>
          </div>
          <div className="max-w-lg">
            <IntroductionRequestFeed />
          </div>
        </ContentContainer>
      </div>
    </ClientLayout>
  );
}

export const Component = IntroRequestsDevPage;
