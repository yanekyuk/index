export const connectionRequestTemplate = (fromUserName: string, toUserName: string, synthesis?: string, subject?: string, unsubscribeUrl?: string) => ({
  subject: subject || `✨ ${fromUserName} wants to connect with you`,
  html: `
    <div style="font-family: Arial, sans-serif;">
      <p>Hey ${toUserName},</p>
      <p>You’ve got a new connection request on Index, <strong>${fromUserName}</strong> wants to connect with you.</p>
      
      <div style="margin: 20px 0;">
        <span style="font-size: 1.2em; vertical-align: middle; margin-right: 5px;">👉</span>
        <a href="https://index.network/inbox" style="text-decoration: none; font-weight: bold; color: #000; font-size: 1.1em; border: 1px solid #ccc; padding: 10px 20px; border-radius: 5px; display: inline-block;">Go to Index to approve</a>
      </div>
      
      ${synthesis ? `
        <p><strong>What could happen between you two:</strong></p>
        <div>${synthesis}</div>
      ` : ''}
      
      <p>If you want to move it forward, I’ll make the introduction. If not, everything stays quiet.</p>
      <p>—Index</p>

      ${unsubscribeUrl ? `
        <div style="margin-top: 40px; border-top: 1px solid #eee; padding-top: 20px; font-size: 0.8em; color: #888;">
          <p>You received this email because you have enabled <strong>Connection Updates</strong> in your notification settings. <a href="${unsubscribeUrl}" style="color: #888; text-decoration: underline;">Unsubscribe</a></p>
        </div>
      ` : ''}
    </div>
  `,
  text: `Hey ${toUserName},

You’ve got a new connection request on Index, ${fromUserName} wants to connect with you.

👉 Go to Index to approve: https://index.network/inbox

${synthesis ? `What could happen between you two:
${synthesis}

` : ''}If you want to move it forward, I’ll make the introduction. If not, everything stays quiet.

—Index

${unsubscribeUrl ? `Unsubscribe: ${unsubscribeUrl}` : ''}`
});
