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
  const userResult = await db.select({
    id: users.id,
    onboarding: users.onboarding,
    settings: userNotificationSettings
  })
    .from(users)
    .leftJoin(userNotificationSettings, eq(users.id, userNotificationSettings.userId))
    .where(eq(users.email, to))
    .limit(1);

  if (userResult.length === 0) return;

  const recipient = userResult[0];

  // 1. Check Onboarding
  if (!recipient.onboarding?.completedAt) {
    console.log(`[Email] Skipping connection email to ${to} - Onboarding not completed`);
    return;
  }

  // 2. Check Preferences
  // If settings exist and explicit false, skip. If no settings, default is true.
  if (recipient.settings?.preferences?.connectionUpdates === false) {
    console.log(`[Email] Skipping connection email to ${to} - User opted out`);
    return;
  }

  let unsubscribeUrl: string | undefined;
  // If settings exist, use token. If not (but onboarded), lazy create via getUnsubscribeUrl logic
  if (recipient.settings?.unsubscribeToken) {
    const API_URL = process.env.API_URL || 'https://api.index.network';
    unsubscribeUrl = `${API_URL}/api/notifications/unsubscribe?token=${recipient.settings.unsubscribeToken}&type=connectionUpdates`;
  } else {
    // Legacy support: Onboarded but no settings row yet. content.
    unsubscribeUrl = await getUnsubscribeUrl(recipient.id, 'connectionUpdates');
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

  for (const recipientEmail of recipients) {
    const userResult = await db.select({
      id: users.id,
      onboarding: users.onboarding,
      settings: userNotificationSettings
    })
      .from(users)
      .leftJoin(userNotificationSettings, eq(users.id, userNotificationSettings.userId))
      .where(eq(users.email, recipientEmail))
      .limit(1);

    if (userResult.length === 0) continue;

    const recipient = userResult[0];

    // 1. Check Onboarding
    if (!recipient.onboarding?.completedAt) {
      console.log(`[Email] Skipping connection accepted email to ${recipientEmail} - Onboarding not completed`);
      continue;
    }

    // 2. Check Preferences
    if (recipient.settings?.preferences?.connectionUpdates === false) {
      console.log(`[Email] Skipping connection accepted email to ${recipientEmail} - User opted out`);
      continue;
    }

    let unsubscribeUrl: string | undefined;
    if (recipient.settings?.unsubscribeToken) {
      const API_URL = process.env.API_URL || 'https://api.index.network';
      unsubscribeUrl = `${API_URL}/api/notifications/unsubscribe?token=${recipient.settings.unsubscribeToken}&type=connectionUpdates`;
    } else {
      unsubscribeUrl = await getUnsubscribeUrl(recipient.id, 'connectionUpdates');
    }

    const template = connectionAcceptedTemplate(initiatorName, accepterName, synthesisHtml, unsubscribeUrl);
    await sendEmail({
      to: recipientEmail,
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
