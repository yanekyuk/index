"use client";

import { useState } from "react";
import { authClient } from "@/app/AuthProviderWrapper";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import AuthModal from "@/components/AuthModal";

const TABS = [
  { label: "Runs", path: "/" },
  { label: "Test Cases", path: "/cases" },
] as const;

export function EvaluatorShell({
  children,
  headerExtra,
}: {
  children: React.ReactNode;
  headerExtra?: React.ReactNode;
}) {
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const session = authClient.useSession();
  const ready = !session.isPending;
  const authenticated = !!session.data?.session;
  const pathname = usePathname();
  const router = useRouter();

  const activeTab =
    TABS.find((t) =>
      t.path === "/"
        ? pathname === "/" || pathname.startsWith("/runs")
        : pathname.startsWith(t.path)
    ) ?? TABS[0];

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!authenticated) {
    return (
      <>
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-4">
          <h1 className="text-2xl font-semibold">Chat Evaluator</h1>
          <p className="text-gray-600">Sign in to run evaluations against the protocol API</p>
          <button
            onClick={() => setLoginModalOpen(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Log in
          </button>
        </div>
        <AuthModal
          isOpen={loginModalOpen}
          onClose={() => setLoginModalOpen(false)}
        />
      </>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold text-gray-900">Agent Evaluation</h1>
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
            {TABS.map((tab) => (
              <button
                key={tab.path}
                onClick={() => router.push(tab.path)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  activeTab.path === tab.path
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {activeTab.path === "/" && (
            <span className="text-sm text-gray-500">
              {process.env.NEXT_PUBLIC_API_URL || "API URL not set"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {headerExtra}
          <button
            onClick={() => authClient.signOut()}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Log out
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}
