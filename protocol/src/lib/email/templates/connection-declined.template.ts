export const connectionDeclinedTemplate = (senderName: string) => ({
  subject: `No connection this time — and that's totally fine`,
  html: `
    <div style="font-family: Arial, sans-serif;">
      <p>Hey ${senderName},</p>
      <p>Just a quick note — your connection request isn't looking to connect right now.</p>
      <p>No worries at all. Timing, focus, or energy — lots of reasons a connection might not land. But your intent is still active, and we'll keep an eye out for others who truly align with what you're exploring.</p>
      <p>Want to tweak your signal or shift your focus? You can always update it on Index.</p>
      <p>Thanks for putting yourself out there — the right ones do find their way.</p>
      <p>—Your discovery agent, always listening</p>
      
      <div style="margin-top: 30px;">
        <a href="https://index.network" style="text-decoration: none; font-weight: bold; color: #000; font-size: 1.1em; border: 1px solid #ccc; padding: 10px 20px; border-radius: 5px; display: inline-block;">Update on Index</a>
      </div>
    </div>
  `,
  text: `Hey ${senderName},

Just a quick note — your connection request isn't looking to connect right now.

No worries at all. Timing, focus, or energy — lots of reasons a connection might not land. But your intent is still active, and we'll keep an eye out for others who truly align with what you're exploring.

Want to tweak your signal or shift your focus? You can always update it on Index.

Thanks for putting yourself out there — the right ones do find their way.

—Your discovery agent, always listening

Update on Index: https://index.network`
});
