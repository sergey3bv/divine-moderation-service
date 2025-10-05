// ABOUTME: Tests for queue message schema validation
// ABOUTME: Ensures messages from main service have correct structure

import { describe, it, expect } from 'vitest';
import { validateQueueMessage, QueueMessageSchema } from './queue-message.mjs';

describe('QueueMessage Schema', () => {
  it('should validate a complete queue message', () => {
    const message = {
      sha256: 'a'.repeat(64),
      r2Key: 'videos/aaa...aaa.mp4',
      uploadedBy: '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d',
      uploadedAt: Date.now(),
      metadata: {
        fileSize: 1024000,
        contentType: 'video/mp4',
        duration: 6
      }
    };

    const result = validateQueueMessage(message);
    expect(result.valid).toBe(true);
    expect(result.data).toEqual(message);
  });

  it('should require sha256', () => {
    const message = {
      r2Key: 'videos/test.mp4',
      uploadedAt: Date.now()
    };

    const result = validateQueueMessage(message);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('sha256');
  });

  it('should validate sha256 is 64 hex characters', () => {
    const message = {
      sha256: 'invalid',
      r2Key: 'videos/test.mp4',
      uploadedAt: Date.now()
    };

    const result = validateQueueMessage(message);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('sha256');
  });

  it('should require r2Key', () => {
    const message = {
      sha256: 'a'.repeat(64),
      uploadedAt: Date.now()
    };

    const result = validateQueueMessage(message);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('r2Key');
  });

  it('should allow optional uploadedBy', () => {
    const message = {
      sha256: 'a'.repeat(64),
      r2Key: 'videos/test.mp4',
      uploadedAt: Date.now()
    };

    const result = validateQueueMessage(message);
    expect(result.valid).toBe(true);
  });

  it('should validate uploadedBy is valid nostr pubkey if provided', () => {
    const message = {
      sha256: 'a'.repeat(64),
      r2Key: 'videos/test.mp4',
      uploadedBy: 'invalid-pubkey',
      uploadedAt: Date.now()
    };

    const result = validateQueueMessage(message);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('uploadedBy');
  });

  it('should allow missing metadata', () => {
    const message = {
      sha256: 'a'.repeat(64),
      r2Key: 'videos/test.mp4',
      uploadedAt: Date.now()
    };

    const result = validateQueueMessage(message);
    expect(result.valid).toBe(true);
  });
});
