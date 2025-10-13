// ABOUTME: Complete moderation pipeline orchestration
// ABOUTME: Coordinates Sightengine analysis and classification for videos

import { moderateVideoWithSightengine } from './sightengine.mjs';
import { classifyModerationResult } from './classifier.mjs';
import { fetchNostrEventBySha256, parseVideoEventMetadata } from '../nostr/relay-client.mjs';

/**
 * Run full moderation pipeline on a video
 * @param {Object} videoData - Video information from queue message
 * @param {string} videoData.sha256 - Video hash
 * @param {string} [videoData.uploadedBy] - Uploader's nostr pubkey
 * @param {number} videoData.uploadedAt - Upload timestamp
 * @param {Object} [videoData.metadata] - Additional metadata
 * @param {Object} env - Environment variables
 * @param {Function} [fetchFn] - Fetch function (for testing)
 * @returns {Promise<Object>} Complete moderation result with classification
 */
export async function moderateVideo(videoData, env, fetchFn = fetch) {
  const { sha256, uploadedBy, uploadedAt, metadata } = videoData;

  // Validate configuration
  if (!env.CDN_DOMAIN) {
    throw new Error('CDN_DOMAIN not configured');
  }

  // Step 1: Fetch Nostr event context to get the actual video URL
  let nostrContext = null;
  let videoUrl = `https://${env.CDN_DOMAIN}/${sha256}.mp4`; // Fallback default

  try {
    const relays = env.NOSTR_RELAY_URL ? [env.NOSTR_RELAY_URL] : ['wss://relay3.openvine.co'];
    const event = await fetchNostrEventBySha256(sha256, relays);
    if (event) {
      nostrContext = parseVideoEventMetadata(event);
      console.log(`[MODERATION] Found Nostr context for ${sha256}:`, nostrContext);

      // Use the video URL from Nostr event if available
      if (nostrContext.videoUrl) {
        videoUrl = nostrContext.videoUrl;
        console.log(`[MODERATION] Using video URL from Nostr event: ${videoUrl}`);
      }
    } else {
      console.log(`[MODERATION] No Nostr event found for ${sha256}, using fallback URL: ${videoUrl}`);
    }
  } catch (error) {
    console.error(`[MODERATION] Failed to fetch Nostr context for ${sha256}:`, error);
    console.log(`[MODERATION] Using fallback URL: ${videoUrl}`);
    // Don't fail moderation if Nostr fetch fails
  }

  // Step 2: Analyze video with Sightengine using the correct URL
  const sightengineResult = await moderateVideoWithSightengine(
    videoUrl,
    { sha256 },
    env,
    fetchFn
  );

  // Step 3: Classify result into action categories
  const classification = classifyModerationResult({
    maxNudityScore: sightengineResult.maxNudityScore,
    maxViolenceScore: sightengineResult.maxViolenceScore,
    maxAiGeneratedScore: sightengineResult.maxAiGeneratedScore,
    maxScores: sightengineResult.maxScores,
    flaggedFrames: sightengineResult.flaggedFrames
  }, env);

  // Step 4: Return complete result
  return {
    // Classification
    ...classification,

    // Detailed subcategories for fine-grained filtering
    detailedCategories: sightengineResult.detailedCategories,

    // Video metadata
    sha256,
    uploadedBy,
    uploadedAt,
    metadata,

    // CDN URL for reference
    cdnUrl: videoUrl,

    // Nostr event context (if found)
    nostrContext,

    // Raw Sightengine data (for debugging/auditing)
    sightengineFrames: sightengineResult.frames
  };
}
