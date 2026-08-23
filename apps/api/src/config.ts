import 'dotenv/config';
import { z } from 'zod';

const bool = z.string().transform((value) => value === 'true');

export const config = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(10),
  VAPID_PUBLIC_KEY: z.string().min(1),
  VAPID_PRIVATE_KEY: z.string().min(1),
  VAPID_SUBJECT: z.string().regex(/^mailto:/),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  COOKIE_SECURE: bool.default(true),
}).parse(process.env);
