// ABOUTME: Complete moderation pipeline orchestration
// ABOUTME: Coordinates Sightengine analysis and classification for videos

import { moderateVideoWithSightengine } from './sightengine.mjs';
import { classifyModerationResult } from './classifier.mjs';

/**
 * Run full moderation pipeline on a video
 * @param {Object} videoData - Video information from queue message
 * @param {string} videoData.sha256 - Video hash
 * @param {string} videoData.r2Key - R2 storage key
 * @param {string} [videoData.uploadedBy] - Uploader's nostr pubkey
 * @param {number} videoData.uploadedAt - Upload timestamp
 * @param {Object} [videoData.metadata] - Additional metadata
 * @param {Object} env - Environment variables
 * @param {Function} [fetchFn] - Fetch function (for testing)
 * @returns {Promise<Object>} Complete moderation result with classification
 */
export async function moderateVideo(videoData, env, fetchFn = fetch) {
  const { sha256, r2Key, uploadedBy, uploadedAt, metadata } = videoData;

  // Validate configuration
  if (!env.CDN_DOMAIN) {
    throw new Error('CDN_DOMAIN not configured');
  }

  // Construct public video URL for Sightengine
  const videoUrl = `https://${env.CDN_DOMAIN}/${sha256}.mp4`;

  // Step 1: Analyze video with Sightengine
  const sightengineResult = await moderateVideoWithSightengine(
    videoUrl,
    { sha256 },
    env,
    fetchFn
  );

  // Step 2: Classify result into action categories
  const classification = classifyModerationResult({
    maxNudityScore: sightengineResult.maxNudityScore,
    maxViolenceScore: sightengineResult.maxViolenceScore,
    maxAiGeneratedScore: sightengineResult.maxAiGeneratedScore,
    flaggedFrames: sightengineResult.flaggedFrames
  }, env);

  // Step 3: Return complete result
  return {
    // Classification
    ...classification,

    // Video metadata
    sha256,
    r2Key,
    uploadedBy,
    uploadedAt,
    metadata,

    // CDN URL for reference
    cdnUrl: videoUrl,

    // Raw Sightengine data (for debugging/auditing)
    sightengineFrames: sightengineResult.frames
  };
}
