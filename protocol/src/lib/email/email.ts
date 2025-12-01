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
  const recipient = isTestMode ? 'yanki@index.network' : options.to;

  if (!process.env.RESEND_API_KEY || !resend || process.env.RESEND_API_KEY === 'DISABLED') {
    console.warn('RESEND_API_KEY not configured or disabled, email not sent');
    return;
  }

  if (!isTestMode) {
    console.log('Email is disabled for now: not from mainnet yet');
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