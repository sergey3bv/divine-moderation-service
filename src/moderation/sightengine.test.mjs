// ABOUTME: Tests for Sightengine API integration
// ABOUTME: Verifies video moderation API calls and response handling

import { describe, it, expect, vi } from 'vitest';
import { moderateVideoWithSightengine } from './sightengine.mjs';

describe('Sightengine Integration', () => {
  it('should call Sightengine API with correct parameters', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        data: {
          frames: [
            { info: { position: 0 }, nudity: { raw: 0.1, partial: 0.05, safe: 0.85 } },
            { info: { position: 3 }, nudity: { raw: 0.15, partial: 0.1, safe: 0.75 } },
            { info: { position: 6 }, nudity: { raw: 0.05, partial: 0.03, safe: 0.92 } }
          ]
        }
      })
    });

    const env = {
      SIGHTENGINE_API_USER: 'test-user',
      SIGHTENGINE_API_SECRET: 'test-secret'
    };

    const result = await moderateVideoWithSightengine(
      'https://cdn.divine.video/abcd1234.mp4',
      { sha256: 'abcd1234' },
      env,
      mockFetch
    );

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://api.sightengine.com/1.0/video/check-sync.json'),
      expect.objectContaining({
        method: 'GET'
      })
    );

    // Verify URL contains required parameters
    const callUrl = mockFetch.mock.calls[0][0];
    expect(callUrl).toContain('stream_url=');
    expect(callUrl).toContain('test-user');
    expect(callUrl).toContain('test-secret');

    expect(result.status).toBe('success');
    expect(result.frames).toHaveLength(3);
  });

  it('should extract max scores from frames', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        data: {
          frames: [
            {
              info: { position: 0 },
              nudity: { raw: 0.1, partial: 0.05, safe: 0.85 },
              violence: { prob: 0.05 }
            },
            {
              info: { position: 3 },
              nudity: { raw: 0.85, partial: 0.7, safe: 0.15 },
              violence: { prob: 0.15 }
            },
            {
              info: { position: 6 },
              nudity: { raw: 0.2, partial: 0.1, safe: 0.7 },
              violence: { prob: 0.9 }
            }
          ]
        }
      })
    });

    const env = {
      SIGHTENGINE_API_USER: 'test-user',
      SIGHTENGINE_API_SECRET: 'test-secret'
    };

    const result = await moderateVideoWithSightengine(
      'https://cdn.divine.video/test.mp4',
      {},
      env,
      mockFetch
    );

    expect(result.maxNudityScore).toBe(0.85);
    expect(result.maxViolenceScore).toBe(0.9);
  });

  it('should handle API errors gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests'
    });

    const env = {
      SIGHTENGINE_API_USER: 'test-user',
      SIGHTENGINE_API_SECRET: 'test-secret'
    };

    await expect(
      moderateVideoWithSightengine('https://cdn.divine.video/test.mp4', {}, env, mockFetch)
    ).rejects.toThrow('Sightengine API error: 429 Too Many Requests');
  });

  it('should handle network errors', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network timeout'));

    const env = {
      SIGHTENGINE_API_USER: 'test-user',
      SIGHTENGINE_API_SECRET: 'test-secret'
    };

    await expect(
      moderateVideoWithSightengine('https://cdn.divine.video/test.mp4', {}, env, mockFetch)
    ).rejects.toThrow('Network timeout');
  });

  it('should require API credentials', async () => {
    const env = {};

    await expect(
      moderateVideoWithSightengine('https://cdn.divine.video/test.mp4', {}, env, fetch)
    ).rejects.toThrow('Sightengine API credentials not configured');
  });

  it('should include flagged frame positions', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        data: {
          frames: [
            {
              info: { position: 0 },
              nudity: { raw: 0.1, partial: 0.05, safe: 0.85 }
            },
            {
              info: { position: 3 },
              nudity: { raw: 0.95, partial: 0.9, safe: 0.05 }  // Flagged
            },
            {
              info: { position: 6 },
              nudity: { raw: 0.15, partial: 0.1, safe: 0.75 }
            }
          ]
        }
      })
    });

    const env = {
      SIGHTENGINE_API_USER: 'test-user',
      SIGHTENGINE_API_SECRET: 'test-secret'
    };

    const result = await moderateVideoWithSightengine(
      'https://cdn.divine.video/test.mp4',
      {},
      env,
      mockFetch
    );

    expect(result.flaggedFrames).toContainEqual(
      expect.objectContaining({ position: 3 })
    );
  });
});
