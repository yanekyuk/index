"use client";

import { use } from "react";
import ClientLayout from "@/components/ClientLayout";
import ChatContent from "@/components/ChatContent";

export default function DiscoverySessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <ClientLayout>
      <ChatContent sessionIdParam={id} />
    </ClientLayout>
  );
}
