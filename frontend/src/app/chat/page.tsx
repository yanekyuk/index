"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import { useAuthContext } from "@/contexts/AuthContext";

export default function ChatLandingPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/');
    }
  }, [authLoading, isAuthenticated, router]);

  return (
    <div className="flex flex-col items-center justify-center h-full text-gray-400">
      <MessagesSquare className="w-12 h-12 mb-3 text-gray-300" />
      <p className="text-sm">No conversations yet</p>
    </div>
  );
}
