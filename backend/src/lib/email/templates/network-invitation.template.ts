import { escapeHtml } from '../../escapeHtml';

export interface NetworkInvitationParams {
  networkName: string;
  apiKey: string;
  connectCommand: string;
}

export interface NetworkInvitationEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Plain-text + HTML invitation that delivers the user's raw API key. Possession
 * of this email is the user's verification — the key is bound to a single
 * network via the agent's `agent_permissions.scope='network'` row.
 */
export const networkInvitationTemplate = (
  p: NetworkInvitationParams,
): NetworkInvitationEmail => {
  const safeNetwork = escapeHtml(p.networkName);
  const safeKey = escapeHtml(p.apiKey);
  const safeCmd = escapeHtml(p.connectCommand);

  return {
    subject: `Your invitation to ${p.networkName}`,
    html: `<div style="font-family: Arial, sans-serif;">
  <p>You've been added to <strong>${safeNetwork}</strong> on Index Network.</p>
  <p>Your personal agent's API key:</p>
  <pre style="font-family: monospace; background: #f6f6f6; padding: 12px; border-radius: 6px;">${safeKey}</pre>
  <p>To connect a self-hosted OpenClaw agent, run:</p>
  <pre style="font-family: monospace; background: #f6f6f6; padding: 12px; border-radius: 6px;">${safeCmd}</pre>
  <p>This key is bound to ${safeNetwork} only. Treat it like a password.</p>
  <div style="margin-top: 20px; text-align: center;">
    <img src="https://index.network/logo.png" alt="Index" style="height: 24px; opacity: 0.5;" />
  </div>
</div>`,
    text: `You've been added to ${p.networkName} on Index Network.

Your personal agent's API key:
${p.apiKey}

To connect a self-hosted OpenClaw agent, run:
${p.connectCommand}

This key is bound to ${p.networkName} only. Treat it like a password.`,
  };
};
