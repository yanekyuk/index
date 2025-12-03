export const connectionAcceptedTemplate = (senderName: string, recipientName: string, synthesis?: string) => ({
  subject: `${senderName} <> ${recipientName} - something’s here`,
  html: `
    <div style="font-family: Arial, sans-serif;">
      <p>Hey ${senderName} and ${recipientName},</p>
      <p>You both said yes, love when that happens.</p>
      
      <p>From what you’re each exploring, this felt like a connection worth bringing into the real world. Whether it turns into a conversation, a collaboration, or just a useful exchange, it’s yours now.</p>
      
      ${synthesis ? `
        <p><strong>Quick recap:</strong></p>
        <div>${synthesis}</div>
      ` : ''}
      
      <p>No formal intros needed - just reply here and pick it up from wherever feels right.</p>
      <p>—Your discovery agent, quietly cheering from the background</p>
    </div>
  `,
  text: `Hey ${senderName} and ${recipientName},

You both said yes, love when that happens.

From what you’re each exploring, this felt like a connection worth bringing into the real world. Whether it turns into a conversation, a collaboration, or just a useful exchange, it’s yours now.

${synthesis ? `Quick recap:
${synthesis}

` : ''}No formal intros needed - just reply here and pick it up from wherever feels right.

—Your discovery agent, quietly cheering from the background`
});
