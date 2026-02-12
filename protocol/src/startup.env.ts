import { config } from 'dotenv';

const environment = process.env.NODE_ENV;

const dotenvPath =
  environment === 'development'
    ? '.env.development'
    : environment === 'test'
      ? '.env.test'
      : '.env';

config({ path: dotenvPath });
