/**
 * Email template for new opportunity notification (high-priority).
 */
export function opportunityNotificationTemplate(
  recipientName: string,
  summary: string,
  opportunityUrl: string,
  unsubscribeUrl?: string
) {
  const subject = `New opportunity for you on Index`;
  const html = `
    <div style="font-family: Arial, sans-serif;">
      <p>Hey ${recipientName},</p>
      <p>You have a new opportunity on Index that might be a good fit.</p>
      <p><strong>Summary:</strong> ${summary}</p>
      <div style="margin: 20px 0;">
        <a href="${opportunityUrl}" style="text-decoration: none; font-weight: bold; color: #FFFFFF; background-color: #0A0A0A; font-size: 1.1em; padding: 10px 20px; border-radius: 5px; display: inline-block;">View opportunity</a>
      </div>
      <p>—Index</p>
      ${unsubscribeUrl ? `
        <div style="margin-top: 40px; border-top: 1px solid #eee; padding-top: 20px; font-size: 0.8em; color: #888;">
          <p><a href="${unsubscribeUrl}" style="color: #888; text-decoration: underline;">Unsubscribe from opportunity emails</a></p>
        </div>
      ` : ''}
    </div>
  `;
  const text = `Hey ${recipientName},

You have a new opportunity on Index that might be a good fit.

Summary: ${summary}

View opportunity: ${opportunityUrl}

—Index
`;
  return { subject, html, text };
}
