import { Resend } from 'resend';
import { addEmailJob, emailQueueEvents } from './queue/email.queue';
import { log } from '../log';

const logger = log.lib.from("lib/email/transport.helper.ts");
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

  if (isTestMode && !recipient) {
    logger.warn('[EmailTransport] TESTING_EMAIL_ADDRESS not set - skipping email');
    return { data: null, skipped: true, reason: 'testing_email_not_set' };
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
      logger.debug(`Email logged to ${debugPath}`);
    } catch (err) {
      logger.error('Failed to log email to file', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (!process.env.RESEND_API_KEY || !resend || process.env.RESEND_API_KEY === 'DISABLED') {
    logger.warn('[EmailTransport] RESEND_API_KEY not configured or disabled - email not sent');
    return { data: null, skipped: true, reason: 'resend_not_configured' };
  }

  if (!isTestMode) {
    logger.debug('[EmailTransport] Email sending disabled (ENABLE_EMAIL_TESTING is not true)');
    return { data: null, skipped: true, reason: 'email_testing_disabled' };
  }

  if (!recipient) {
    if (isTestMode) {
      logger.warn('[EmailTransport] TESTING_EMAIL_ADDRESS not set - skipping email');
      return { data: null, skipped: true, reason: 'testing_email_not_set' };
    }
    logger.error('[EmailTransport] No recipient defined for email');
    return { data: null, skipped: true, reason: 'no_recipient' };
  }

  logger.info(`[EmailTransport] Sending email to test recipient`, { recipient: String(recipient), originalTo: String(options.to) });

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
      logger.error('[EmailTransport] Resend API returned error', {
        errorName: result.error.name,
        errorMessage: result.error.message,
        recipient: String(recipient),
        subject: options.subject,
      });
      throw new Error(`Resend error: ${result.error.message}`);
    }

    logger.info('[EmailTransport] Email sent successfully', {
      messageId: result.data?.id,
      recipient: String(recipient),
    });
    return result;
  } catch (error) {
    logger.error('[EmailTransport] Failed to send email via Resend API', {
      error: error instanceof Error ? error.message : String(error),
      recipient: String(recipient),
      subject: options.subject,
    });
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
  const job = await addEmailJob(options);
  
  // Wait for the job to complete with a 60 second timeout
  const WAIT_TIMEOUT_MS = 60000;
  
  try {
    const result = await job.waitUntilFinished(emailQueueEvents, WAIT_TIMEOUT_MS);
    
    // Check for null OR undefined - BullMQ stores undefined as null
    if (result == null) {
      // Job completed but with no result - could indicate the job wasn't processed
      // or QueueEvents missed the completion event. Check job state.
      const jobState = await job.getState();
      const returnValue = job.returnvalue;
      
      // If job is still waiting/active, the timeout was hit or worker didn't process it
      if (jobState === 'waiting' || jobState === 'active' || jobState === 'delayed') {
        logger.error(`[EmailTransport] Email job ${job.id} timed out or not processed`, { jobState });
      } else if (jobState === 'completed') {
        // Job actually completed, QueueEvents missed the event - return the stored result
        return returnValue;
      }
      
      return returnValue || result;
    }
    
    return result;
  } catch (error) {
    // Handle timeout or other errors
    const jobState = await job.getState().catch(() => 'unknown');
    logger.error(`[EmailTransport] Email job ${job.id} error while waiting`, {
      error: error instanceof Error ? error.message : String(error),
      jobState,
    });
    throw error;
  }
};
