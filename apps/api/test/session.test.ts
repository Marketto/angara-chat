import { beforeAll, describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';

let readSessionToken: typeof import('../src/session.js').readSessionToken;
let verifyOrigin: typeof import('../src/session.js').verifyOrigin;
let sessionCookie: typeof import('../src/session.js').SESSION_COOKIE;

beforeAll(async () => {
  Object.assign(process.env, {
    APP_ORIGIN: 'http://localhost:5173',
    DATABASE_URL: 'postgresql://chat:test@localhost:5432/chat_test',
    GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
    VAPID_PUBLIC_KEY: 'test-public-key',
    VAPID_PRIVATE_KEY: 'test-private-key',
    VAPID_SUBJECT: 'mailto:test@example.com',
    COOKIE_SECURE: 'false',
  });
  ({ readSessionToken, verifyOrigin, SESSION_COOKIE: sessionCookie } = await import('../src/session.js'));
});

function originRequest(method: string, origin?: string) {
  return {
    method,
    get: (name: string) => name === 'origin' ? origin : undefined,
  } as unknown as Request;
}

function originResponse() {
  const response = {
    status: (code: number) => {
      response.statusCode = code;
      return response;
    },
    json: (body: unknown) => {
      response.body = body;
      return response;
    },
    statusCode: 200,
    body: undefined as unknown,
  };
  return response as unknown as Response & { statusCode: number; body: unknown };
}

describe('session boundary helpers', () => {
  it('reads only the named session cookie', () => {
    expect(readSessionToken(`other=value; ${sessionCookie}=trusted-token`)).toBe('trusted-token');
    expect(readSessionToken('other=value')).toBeUndefined();
  });

  it('allows safe requests without an Origin header', () => {
    const response = originResponse();
    let continued = false;
    verifyOrigin(originRequest('GET'), response, () => { continued = true; });
    expect(continued).toBe(true);
    expect(response.statusCode).toBe(200);
  });

  it('rejects state changes from absent or foreign origins', () => {
    for (const origin of [undefined, 'https://attacker.example']) {
      const response = originResponse();
      let continued = false;
      verifyOrigin(originRequest('POST', origin), response, () => { continued = true; });
      expect(continued).toBe(false);
      expect(response.statusCode).toBe(403);
      expect(response.body).toEqual({ error: 'INVALID_ORIGIN' });
    }
  });

  it('allows state changes from the configured origin', () => {
    const response = originResponse();
    let continued = false;
    verifyOrigin(originRequest('POST', 'http://localhost:5173'), response, () => { continued = true; });
    expect(continued).toBe(true);
  });
});
