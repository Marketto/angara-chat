import { describe, expect, it } from 'vitest';
import { attachmentCacheKey } from './attachment-cache';

describe('local image cache identity', () => {
  it('names cached bytes by both account and attachment', () => {
    expect(attachmentCacheKey('alice', 'photo-1')).toBe('alice:photo-1');
    expect(attachmentCacheKey('alice', 'photo-1')).not.toBe(attachmentCacheKey('bob', 'photo-1'));
  });
});
