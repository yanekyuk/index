import { sendEmail } from './transport.helper';
import { connectionRequestTemplate } from './templates/connection-request.template';
import { connectionAcceptedTemplate } from './templates/connection-accepted.template';

export async function sendConnectionRequestEmail(
  to: string,
  initiatorName: string,
  receiverName: string,
  synthesisHtml: string,
  subject: string
): Promise<void> {
  const template = connectionRequestTemplate(initiatorName, receiverName, synthesisHtml, subject);
  await sendEmail({
    to,
    subject: template.subject,
    html: template.html,
    text: template.text
  });
}

export async function sendConnectionAcceptedEmail(
  to: string | string[],
  initiatorName: string,
  accepterName: string,
  synthesisHtml: string
): Promise<void> {
  const recipients = Array.isArray(to) ? to : [to];

  for (const recipient of recipients) {
    const template = connectionAcceptedTemplate(initiatorName, accepterName, synthesisHtml);
    await sendEmail({
      to: recipient,
      subject: template.subject,
      html: template.html,
      text: template.text
    });
  }
}
