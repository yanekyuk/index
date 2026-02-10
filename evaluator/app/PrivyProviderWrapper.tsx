"use client";

import { PrivyProvider } from "@privy-io/react-auth";

export function PrivyProviderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const clientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID;

  if (!appId || !clientId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <p className="text-gray-600">
          Set NEXT_PUBLIC_PRIVY_APP_ID and NEXT_PUBLIC_PRIVY_CLIENT_ID in .env.local
        </p>
      </div>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      clientId={clientId}
      config={{ loginMethods: ["email", "google"] }}
    >
      {children}
    </PrivyProvider>
  );
}
