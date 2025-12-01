import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export const sendEmail = async (options: {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}) => {
  // SAFETY: Override recipient for testing
  const isTestMode = process.env.ENABLE_EMAIL_TESTING === 'true';
  const recipient = isTestMode ? process.env.TESTING_EMAIL_ADDRESS : options.to;

  if (isTestMode && !recipient) {
    console.warn('TESTING_EMAIL_ADDRESS not set. Skipping email sending.');
    return;
  }

  if (isTestMode) {
    const { appendFile } = await import('fs/promises');
    const { resolve } = await import('path');
    const debugPath = resolve(process.cwd(), 'email-debug.md');
    const separator = '='.repeat(80);
    const timestamp = new Date().toISOString();
    const content = `
      ${separator}
      [${timestamp}] Email Sent
      ${separator}
      To: ${Array.isArray(recipient) ? recipient.join(', ') : recipient}
      Subject: ${options.subject}

      --- TEXT CONTENT ---
      ${options.text}

      --- HTML CONTENT ---
      ${options.html}
    `;
    try {
      await appendFile(debugPath, content);
      console.log(`📝 Email logged to ${debugPath}`);
    } catch (err) {
      console.error('Failed to log email to file:', err);
    }
  }

  if (!process.env.RESEND_API_KEY || !resend || process.env.RESEND_API_KEY === 'DISABLED') {
    console.warn('RESEND_API_KEY not configured or disabled, email not sent');
    return;
  }

  if (!isTestMode) {
    console.log('Email is disabled for now: not from mainnet yet');
    return;
  }

  if (!recipient) {
    if (isTestMode) {
      console.warn('TESTING_EMAIL_ADDRESS not set. Skipping email sending (logged to file).');
      return;
    }
    console.error('No recipient defined for email.');
    return;
  }

  console.log(`[TEST MODE] Sending email to ${recipient} (Original: ${options.to})`);

  try {
    const result = await resend!.emails.send({
      from: 'Index Network <updates@agent.index.network>',
      to: recipient,
      replyTo: 'hello@index.network',
      subject: options.subject,
      html: options.html,
      text: options.text
    });

    console.log('Email sent successfully:', result);
    return result;
  } catch (error) {
    console.error('Failed to send email:', error);
    throw error;
  }
}; 