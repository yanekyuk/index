import { Resend } from 'resend';
import { addEmailJob, emailQueueEvents } from './queue/email.queue';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export const executeSendEmail = async (options: {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}) => {
  // SAFETY: Override recipient for testing
  const isTestMode = process.env.ENABLE_EMAIL_TESTING === 'true';
  const recipient = isTestMode ? process.env.TESTING_EMAIL_ADDRESS : options.to;

  console.log('[EmailTransport] executeSendEmail called', {
    to: options.to,
    subject: options.subject,
    isTestMode,
    recipient,
    resendKeyConfigured: !!process.env.RESEND_API_KEY,
  });

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

    // Format headers for display
    const headersStr = options.headers
      ? Object.entries(options.headers).map(([k, v]) => `${k}: ${v}`).join('\n      ')
      : '(none)';

    const content = `
      ${separator}
      [${timestamp}] Email Sent
      ${separator}
      To: ${Array.isArray(recipient) ? recipient.join(', ') : recipient}
      Subject: ${options.subject}
      Headers:
      ${headersStr}

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
    console.log('Email is disabled for now: not from mainnet yet (ENABLE_EMAIL_TESTING is not true)');
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
      text: options.text,
      headers: options.headers,
    });

    if (result.error) {
      console.error('Resend returned error:', result.error);
      throw new Error(`Resend error: ${result.error.message}`);
    }

    console.log('Email sent successfully:', result);
    return result;
  } catch (error) {
    console.error('Failed to send email:', error);
    throw error;
  }
};


export const sendEmail = async (options: {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}): Promise<any> => {
  console.log('[EmailTransport] sendEmail called (queueing job)', { to: options.to, subject: options.subject });
  const job = await addEmailJob(options);
  console.log(`[EmailTransport] Email job ${job.id} added to queue, waiting for completion...`);
  
  // Wait for the job to actually complete
  const result = await job.waitUntilFinished(emailQueueEvents);
  
  console.log(`[EmailTransport] Email job ${job.id} completed`);
  return result;
};