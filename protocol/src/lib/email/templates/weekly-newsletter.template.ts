export interface Match {
  name: string;
  role?: string;
  reasoning: string;
}

export const weeklyNewsletterTemplate = (recipientName: string, matches: Match[]) => {
  const matchesHtml = matches.map((match) => `
    <div style="margin-bottom: 20px;">
      <p><strong>${match.name}${match.role ? ` — <em>${match.role}</em>` : ''}</strong></p>
      <p>${match.reasoning}</p>
    </div>
  `).join('');

  const matchesText = matches.map((match) => `
${match.name}${match.role ? ` — ${match.role}` : ''}
${match.reasoning}
  `).join('\n');

  const subject = `You’ve got ${matches.length} conversations waiting in your Index Inbox`;

  return {
    subject,
    html: `
      <div style="font-family: Arial, sans-serif;">
        <p>Hey ${recipientName},</p>
        <p>Index’s agents surfaced a few people this week whose work lines up unusually well with the things you’re pushing right now - fundraising, agent deployments, protocol scaling, semantic web thinking, and the early shape of a discovery network.</p>
        <p>Each one can shift something forward - choose your move, and I’ll take the next step with you.</p>
        
        <div style="margin: 20px 0;">
          <span style="font-size: 1.2em; vertical-align: middle; margin-right: 5px;">👉</span>
          <a href="https://index.network/inbox" style="text-decoration: none; font-weight: bold; color: #000;">Go to your Inbox</a>
        </div>
        
        ${matchesHtml}
        
        <div style="margin: 20px 0;">
          <span style="font-size: 1.2em; vertical-align: middle; margin-right: 5px;">👉</span>
          <a href="https://index.network/inbox" style="text-decoration: none; font-weight: bold; color: #000;">Go to your Inbox</a>
        </div>
        
        <p>—Index, keeping your next moves within reach</p>
      </div>
    `,
    text: `Hey ${recipientName},

Index’s agents surfaced a few people this week whose work lines up unusually well with the things you’re pushing right now - fundraising, agent deployments, protocol scaling, semantic web thinking, and the early shape of a discovery network.

Each one can shift something forward - choose your move, and I’ll take the next step with you.

👉 Go to your Inbox: https://index.network/inbox

${matchesText}

👉 Go to your Inbox: https://index.network/inbox

—Index, keeping your next moves within reach`
  };
};
