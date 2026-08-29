import { createHash, timingSafeEqual } from 'node:crypto';
import express, { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { messageSelection } from './message-selection.js';
import { notifyConversation } from './push.js';
import { conversationIdSchema } from './schemas.js';
import { publishConversationMessage } from './socket.js';

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_CONCURRENT_UPLOADS = 3;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_USER_STORAGE_BYTES = 256 * 1024 * 1024;
const MAX_USER_BYTES_PER_WINDOW = 32 * 1024 * 1024;
const RATE_WINDOW_MS = 15 * 60_000;
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const documentTypes = new Set(['application/pdf', 'text/plain']);
const attachmentMetadataSchema = z.object({
  clientId: z.string().uuid(),
  kind: z.enum(['IMAGE', 'DOCUMENT']),
  fileName: z.string().trim().min(1).max(180)
    .refine((name) => Buffer.byteLength(name, 'utf8') <= 180)
    .refine(safeFileName),
  mediaType: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).superRefine((value, context) => {
  const allowed = value.kind === 'IMAGE' ? imageTypes : documentTypes;
  if (!allowed.has(value.mediaType)) context.addIssue({ code: 'custom', path: ['mediaType'], message: 'MIME not allowed for kind' });
});

const rawAttachment = express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES });
let activeUploads = 0;
const userRates = new Map<string, { startedAt: number; requests: number; bytes: number }>();
class StorageQuotaError extends Error {}

export const attachmentRoutes = Router();

attachmentRoutes.post(
  '/conversations/:id/attachments',
  authorizeConversation,
  enforceUserRequestRate,
  readStorageUsage,
  reserveUploadSlot,
  parseRawAttachment,
  uploadAttachment,
);
attachmentRoutes.get('/attachments/:id', downloadAttachment);

async function authorizeConversation(request: Request, response: Response, next: NextFunction) {
  const conversationId = conversationIdSchema.safeParse(request.params.id);
  if (!conversationId.success) return response.status(400).json({ error: 'INVALID_CONVERSATION' });
  const membership = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: conversationId.data, userId: response.locals.user.id } },
    select: { conversationId: true },
  });
  if (!membership) return response.status(404).json({ error: 'CONVERSATION_NOT_FOUND' });
  response.locals.conversationId = conversationId.data;
  next();
}

function enforceUserRequestRate(_request: Request, response: Response, next: NextFunction) {
  const now = Date.now();
  const userId = response.locals.user.id as string;
  let rate = userRates.get(userId);
  if (!rate || now - rate.startedAt >= RATE_WINDOW_MS) {
    rate = { startedAt: now, requests: 0, bytes: 0 };
    userRates.set(userId, rate);
  }
  rate.requests += 1;
  if (rate.requests > 30) return response.status(429).json({ error: 'UPLOAD_RATE_LIMITED' });
  next();
}

async function readStorageUsage(request: Request, response: Response, next: NextFunction) {
  const aggregate = await db.messageAttachment.aggregate({
    where: { message: { senderId: response.locals.user.id } },
    _sum: { byteSize: true },
  });
  const used = aggregate._sum.byteSize ?? 0;
  response.locals.attachmentStorageUsed = used;
  const contentLength = Number(request.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 0 && used + contentLength > MAX_USER_STORAGE_BYTES) {
    const clientId = z.string().uuid().safeParse(request.get('x-client-id'));
    if (!clientId.success) return response.status(429).json({ error: 'STORAGE_QUOTA_EXCEEDED' });
    const retry = await db.message.findUnique({
      where: { conversationId_clientId: { conversationId: response.locals.conversationId, clientId: clientId.data } },
      select: { id: true },
    });
    if (!retry) return response.status(429).json({ error: 'STORAGE_QUOTA_EXCEEDED' });
  }
  next();
}

function reserveUploadSlot(_request: Request, response: Response, next: NextFunction) {
  if (activeUploads >= MAX_CONCURRENT_UPLOADS) return response.status(503).json({ error: 'UPLOAD_BUSY' });
  activeUploads += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeUploads -= 1;
  };
  response.once('finish', release);
  response.once('close', release);
  next();
}

function parseRawAttachment(request: Request, response: Response, next: NextFunction) {
  rawAttachment(request, response, (error?: unknown) => {
    if ((error as { type?: string } | undefined)?.type === 'entity.too.large') {
      return response.status(413).json({ error: 'ATTACHMENT_TOO_LARGE' });
    }
    if (error) return next(error);
    next();
  });
}

async function uploadAttachment(request: Request, response: Response, next: NextFunction) {
  let fileName: string;
  try {
    fileName = decodeURIComponent(request.get('x-file-name') ?? '').normalize('NFC');
  } catch {
    return response.status(400).json({ error: 'INVALID_ATTACHMENT' });
  }
  const metadata = attachmentMetadataSchema.safeParse({
    clientId: request.get('x-client-id'),
    kind: request.get('x-attachment-kind'),
    fileName,
    mediaType: normalizedMediaType(request.get('content-type')),
    sha256: request.get('x-content-sha256'),
  });
  const data = Buffer.isBuffer(request.body) ? request.body : null;
  const byteRateAllowed = data ? chargeUserBytes(response.locals.user.id, data.length) : true;
  if (!metadata.success || !data?.length || !matchesMagicBytes(metadata.data.mediaType, data)) {
    return response.status(400).json({ error: 'INVALID_ATTACHMENT' });
  }
  const actualHash = createHash('sha256').update(data).digest();
  const actualSha256 = actualHash.toString('hex');
  const expectedHash = Buffer.from(metadata.data.sha256, 'hex');
  if (!timingSafeEqual(actualHash, expectedHash)) return response.status(400).json({ error: 'HASH_MISMATCH' });
  const storageAllowed = response.locals.attachmentStorageUsed + data.length <= MAX_USER_STORAGE_BYTES;
  if (!byteRateAllowed || !storageAllowed) {
    const existing = await findExistingMessage(response.locals.conversationId, metadata.data.clientId);
    if (sameAttachment(existing, response.locals.user.id, metadata.data, data.length, actualSha256)) {
      return response.status(200).json(existing);
    }
    return response.status(429).json({ error: byteRateAllowed ? 'STORAGE_QUOTA_EXCEEDED' : 'UPLOAD_RATE_LIMITED' });
  }

  try {
    const message = await db.$transaction(async (transaction) => {
      const usage = await transaction.messageAttachment.aggregate({
        where: { message: { senderId: response.locals.user.id } },
        _sum: { byteSize: true },
      });
      if ((usage._sum.byteSize ?? 0) + data.length > MAX_USER_STORAGE_BYTES) throw new StorageQuotaError();
      return transaction.message.create({
        data: {
          conversationId: response.locals.conversationId,
          clientId: metadata.data.clientId,
          senderId: response.locals.user.id,
          kind: metadata.data.kind,
          body: '',
          attachment: { create: {
            fileName: metadata.data.fileName,
            mediaType: metadata.data.mediaType,
            byteSize: data.length,
            sha256: actualSha256,
            data: Uint8Array.from(data),
          } },
        },
        select: messageSelection,
      });
    }, { isolationLevel: 'Serializable' });
    publishConversationMessage(response.locals.conversationId, message);
    response.status(201).json(message);
    void notifyConversation(response.locals.conversationId, response.locals.user.id, response.locals.user.name, response.locals.user.avatarUrl)
      .catch(() => console.error('Failed to send conversation push'));
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (!(error instanceof StorageQuotaError) && code !== 'P2002' && code !== 'P2034') return next(error);
    const existing = await findExistingMessage(response.locals.conversationId, metadata.data.clientId);
    if (!sameAttachment(existing, response.locals.user.id, metadata.data, data.length, actualSha256)) {
      if (error instanceof StorageQuotaError) return response.status(429).json({ error: 'STORAGE_QUOTA_EXCEEDED' });
      if (code === 'P2034') return response.status(429).json({ error: 'UPLOAD_RETRY' });
      return response.status(409).json({ error: 'CLIENT_ID_CONFLICT' });
    }
    return response.status(200).json(existing);
  }
}

function findExistingMessage(conversationId: string, clientId: string) {
  return db.message.findUnique({
    where: { conversationId_clientId: { conversationId, clientId } },
    select: messageSelection,
  });
}

async function downloadAttachment(request: Request, response: Response) {
  const id = typeof request.params.id === 'string' && request.params.id.length <= 128 ? request.params.id : '';
  if (!id) return response.status(404).json({ error: 'ATTACHMENT_NOT_FOUND' });
  const attachment = await db.messageAttachment.findFirst({
    where: { id, message: { conversation: { members: { some: { userId: response.locals.user.id } } } } },
    select: { fileName: true, mediaType: true, byteSize: true, data: true, message: { select: { kind: true } } },
  });
  if (!attachment) return response.status(404).json({ error: 'ATTACHMENT_NOT_FOUND' });
  response.set({
    'Cache-Control': 'private, no-store',
    'Content-Type': attachment.mediaType,
    'Content-Length': String(attachment.byteSize),
    'Content-Disposition': contentDisposition(attachment.message.kind === 'IMAGE' ? 'inline' : 'attachment', attachment.fileName),
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  return response.send(Buffer.from(attachment.data));
}

function normalizedMediaType(value: string | undefined) {
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function safeFileName(name: string) {
  for (const character of name) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint < 0x20 || codePoint === 0x7f || codePoint === 0x2f || codePoint === 0x5c
      || (codePoint >= 0x202a && codePoint <= 0x202e) || (codePoint >= 0x2066 && codePoint <= 0x2069)) return false;
  }
  return true;
}

function matchesMagicBytes(mediaType: string, data: Buffer) {
  if (mediaType === 'image/jpeg') return validJpeg(data);
  if (mediaType === 'image/png') return validPng(data);
  if (mediaType === 'image/gif') return validGif(data);
  if (mediaType === 'image/webp') return validWebp(data);
  if (mediaType === 'application/pdf') return data.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mediaType === 'text/plain') return validPlainText(data);
  return false;
}

function chargeUserBytes(userId: string, bytes: number) {
  const rate = userRates.get(userId);
  if (!rate) return false;
  rate.bytes += bytes;
  return rate.bytes <= MAX_USER_BYTES_PER_WINDOW;
}

function validPng(data: Buffer) {
  if (!startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || data.length < 24) return false;
  return validDimensions(data.readUInt32BE(16), data.readUInt32BE(20));
}

function validGif(data: Buffer) {
  const signature = data.subarray(0, 6).toString('ascii');
  return data.length >= 10 && (signature === 'GIF87a' || signature === 'GIF89a')
    && validDimensions(data.readUInt16LE(6), data.readUInt16LE(8));
}

function validJpeg(data: Buffer) {
  if (!startsWith(data, [0xff, 0xd8, 0xff])) return false;
  let offset = 2;
  while (offset + 3 < data.length) {
    if (data[offset] !== 0xff) return false;
    const marker = data[offset + 1]!;
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) return false;
    const segmentLength = data.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > data.length) return false;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return segmentLength >= 7 && validDimensions(data.readUInt16BE(offset + 5), data.readUInt16BE(offset + 3));
    }
    offset += segmentLength;
  }
  return false;
}

function validWebp(data: Buffer) {
  if (data.length < 30 || data.subarray(0, 4).toString('ascii') !== 'RIFF' || data.subarray(8, 12).toString('ascii') !== 'WEBP') return false;
  const chunk = data.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X') {
    const width = 1 + data.readUIntLE(24, 3);
    const height = 1 + data.readUIntLE(27, 3);
    return validDimensions(width, height);
  }
  if (chunk === 'VP8L' && data[20] === 0x2f) {
    const width = 1 + data[21]! + ((data[22]! & 0x3f) << 8);
    const height = 1 + (data[22]! >> 6) + (data[23]! << 2) + ((data[24]! & 0x0f) << 10);
    return validDimensions(width, height);
  }
  if (chunk === 'VP8 ' && data.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
    return validDimensions(data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff);
  }
  return false;
}

function validDimensions(width: number, height: number) {
  return width > 0 && height > 0 && width * height <= MAX_IMAGE_PIXELS;
}

function startsWith(data: Buffer, bytes: number[]) {
  return data.length >= bytes.length && bytes.every((byte, index) => data[index] === byte);
}

function validPlainText(data: Buffer) {
  if (data.includes(0)) return false;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data).trimStart().toLowerCase();
    return !text.startsWith('<!doctype html') && !text.startsWith('<html') && !text.startsWith('<svg');
  } catch {
    return false;
  }
}

function sameAttachment(
  message: {
    senderId: string;
    kind: string;
    body: string;
    locationLatitude: number | null;
    locationLongitude: number | null;
    locationAccuracy: number | null;
    attachment: null | { fileName: string; mediaType: string; byteSize: number; sha256: string };
  } | null,
  senderId: string,
  metadata: z.infer<typeof attachmentMetadataSchema>,
  byteSize: number,
  actualSha256: string,
) {
  return Boolean(message
    && message.senderId === senderId
    && message.kind === metadata.kind
    && message.body === ''
    && message.locationLatitude === null
    && message.locationLongitude === null
    && message.locationAccuracy === null
    && message.attachment?.fileName === metadata.fileName
    && message.attachment.mediaType === metadata.mediaType
    && message.attachment.byteSize === byteSize
    && message.attachment.sha256 === actualSha256);
}

function contentDisposition(disposition: 'inline' | 'attachment', fileName: string) {
  const fallback = fileName.replace(/[^\x20-\x7e]/gu, '_').replace(/["\\]/gu, '_');
  const encoded = encodeURIComponent(fileName).replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
