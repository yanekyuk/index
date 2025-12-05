import { sendEmail } from './transport.helper';
import { connectionRequestTemplate } from './templates/connection-request.template';
import { connectionAcceptedTemplate } from './templates/connection-accepted.template';
import db from '../db';
import { userNotificationSettings, users } from '../schema';
import { eq } from 'drizzle-orm';

const API_URL = process.env.API_URL || 'https://api.index.network';

async function getUnsubscribeUrl(userId: string, type: 'weeklyNewsletter' | 'connectionUpdates') {
  // Find or create settings (create should technically happen on user creation, but good to be safe)
  let settings = await db.select()
    .from(userNotificationSettings)
    .where(eq(userNotificationSettings.userId, userId))
    .limit(1);

  if (settings.length === 0) {
    // If no settings exist, strictly speaking we should create them, but for now let's assume existence or return null
    // Ideally we should insert if not exists to ensure token availability.
    const [newSettings] = await db.insert(userNotificationSettings)
      .values({ userId })
      .returning();
    settings = [newSettings];
  }

  const token = settings[0].unsubscribeToken;
  return `${API_URL}/api/notifications/unsubscribe?token=${token}&type=${type}`;
}

export async function sendConnectionRequestEmail(
  to: string,
  initiatorName: string,
  receiverName: string,
  synthesisHtml: string,
  subject: string
): Promise<void> {
  // We need to look up the user ID by email to get the token.
  // This is slightly inefficient as we only have 'to' email here, but acceptable.
  const user = await db.select({ id: users.id }).from(users).where(eq(users.email, to)).limit(1);

  let unsubscribeUrl: string | undefined;
  if (user.length > 0) {
    unsubscribeUrl = await getUnsubscribeUrl(user[0].id, 'connectionUpdates');
  }

  const template = connectionRequestTemplate(initiatorName, receiverName, synthesisHtml, subject, unsubscribeUrl);

  await sendEmail({
    to,
    subject: template.subject,
    html: template.html,
    text: template.text,
    headers: unsubscribeUrl ? {
      'List-Unsubscribe': `<mailto:hello@index.network?subject=Unsubscribe>, <${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    } : undefined
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
    const user = await db.select({ id: users.id }).from(users).where(eq(users.email, recipient)).limit(1);

    let unsubscribeUrl: string | undefined;
    if (user.length > 0) {
      unsubscribeUrl = await getUnsubscribeUrl(user[0].id, 'connectionUpdates');
    }

    const template = connectionAcceptedTemplate(initiatorName, accepterName, synthesisHtml, unsubscribeUrl);
    await sendEmail({
      to: recipient,
      subject: template.subject,
      html: template.html,
      text: template.text,
      headers: unsubscribeUrl ? {
        'List-Unsubscribe': `<mailto:hello@index.network?subject=Unsubscribe>, <${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
      } : undefined
    });
  }
}
