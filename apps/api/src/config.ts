import 'dotenv/config';
import { z } from 'zod';

const bool = z.string().transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(10),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  VAPID_PUBLIC_KEY: z.string().min(1),
  VAPID_PRIVATE_KEY: z.string().min(1),
  VAPID_SUBJECT: z.string().regex(/^mailto:/),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  COOKIE_SECURE: bool.default(true),
  BUILD_VERSION: z.string().min(1).max(100).default('dev'),
  TEST_AUTH_TOKEN: z.string().min(32).optional(),
  TURN_URL: z.string().url().optional(),
  TURN_AUTH_SECRET: z.string().min(32).optional(),
});

export const config = schema.parse(process.env);
if (config.NODE_ENV === 'production' && config.TEST_AUTH_TOKEN) throw new Error('TEST_AUTH_TOKEN is forbidden in production');
