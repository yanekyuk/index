import { AuthDatabaseAdapter } from '../../adapters/auth.adapter';
import { getTrustedOrigins } from '../cors';
import { sendMagicLinkEmail } from '../email/magic-link.handler';

import { createAuth } from './betterauth';

const authDb = new AuthDatabaseAdapter();

export const auth = createAuth({
  authDb,
  getTrustedOrigins,
  sendMagicLinkEmail,
});
