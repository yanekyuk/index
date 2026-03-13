import { useEffect } from "react";

/**
 * Minimal OAuth callback page.
 * Composio redirects here after the user completes Gmail auth.
 * Notifies the opener via postMessage so the parent can proceed immediately,
 * then attempts to close the popup.
 */
function OAuthCallbackPage() {
  useEffect(() => {
    if (window.opener) {
      window.opener.postMessage(
        { type: "oauth_callback", status: "success" },
        window.location.origin,
      );
    }
    window.close();
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-white">
      <p className="text-sm text-neutral-400">Connected — you can close this window.</p>
    </div>
  );
}

export const Component = OAuthCallbackPage;
