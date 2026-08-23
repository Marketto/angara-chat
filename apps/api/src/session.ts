import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { parse } from 'cookie';
import { config } from './config.js';
import { db } from './db.js';

export const SESSION_COOKIE = '__Host-chat_session';
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function readSessionToken(cookieHeader?: string): string | undefined {
  if (!cookieHeader) return undefined;
  return parse(cookieHeader)[SESSION_COOKIE];
}

export async function createSession(userId: string, response: Response) {
  const token = randomBytes(32).toString('base64url');
  const maxAge = config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  await db.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + maxAge) } });
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true, secure: config.COOKIE_SECURE, sameSite: 'strict', path: '/', maxAge,
  });
}

export async function sessionUser(cookieHeader?: string) {
  const token = readSessionToken(cookieHeader);
  if (!token) return null;
  return db.session.findFirst({
    where: { tokenHash: hashToken(token), expiresAt: { gt: new Date() } },
    select: { user: { select: { id: true, email: true, name: true, avatarUrl: true } } },
  }).then((session) => session?.user ?? null);
}

export async function requireUser(request: Request, response: Response, next: () => void) {
  const user = await sessionUser(request.headers.cookie);
  if (!user) return void response.status(401).json({ error: 'UNAUTHENTICATED' });
  response.locals.user = user;
  next();
}

export function verifyOrigin(request: Request, response: Response, next: () => void) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
  const origin = request.get('origin');
  if (!origin || !safeEqual(origin, config.APP_ORIGIN)) return void response.status(403).json({ error: 'INVALID_ORIGIN' });
  next();
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
