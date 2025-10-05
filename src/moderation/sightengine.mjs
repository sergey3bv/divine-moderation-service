// ABOUTME: Sightengine API client for video content moderation
// ABOUTME: Handles video analysis and score extraction from Sightengine service

const SIGHTENGINE_API_URL = 'https://api.sightengine.com/1.0/video/check-sync.json';

// Threshold for flagging individual frames
const NUDITY_THRESHOLD = 0.7;
const VIOLENCE_THRESHOLD = 0.7;
const AI_GENERATED_THRESHOLD = 0.7;

/**
 * Moderate a video using Sightengine API
 * @param {string} videoUrl - Public URL to video file
 * @param {Object} metadata - Video metadata (sha256, etc)
 * @param {Object} env - Environment variables with API credentials
 * @param {Function} [fetchFn=fetch] - Fetch function (for testing)
 * @returns {Promise<Object>} Moderation result with scores and flagged frames
 */
export async function moderateVideoWithSightengine(videoUrl, metadata, env, fetchFn = fetch) {
  // Validate credentials
  if (!env.SIGHTENGINE_API_USER || !env.SIGHTENGINE_API_SECRET) {
    throw new Error('Sightengine API credentials not configured');
  }

  try {
    // Build URL with query parameters (GET request for video URL moderation)
    const url = new URL(SIGHTENGINE_API_URL);
    url.searchParams.append('stream_url', videoUrl);
    url.searchParams.append('models', 'nudity,violence,offensive,gore,genai');
    url.searchParams.append('api_user', env.SIGHTENGINE_API_USER);
    url.searchParams.append('api_secret', env.SIGHTENGINE_API_SECRET);

    const response = await fetchFn(url.toString(), {
      method: 'GET'
    });

    if (!response.ok) {
      throw new Error(`Sightengine API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.status !== 'success') {
      throw new Error(`Sightengine returned error: ${data.error?.message || 'Unknown error'}`);
    }

    // Extract scores from frames
    const frames = data.data?.frames || [];
    const result = analyzeFrames(frames);

    return {
      status: 'success',
      frames,
      ...result
    };

  } catch (error) {
    // Re-throw with context
    throw error;
  }
}

/**
 * Analyze frames and extract max scores
 * @param {Array} frames - Frame analysis results from Sightengine
 * @returns {Object} Aggregated scores and flagged frames
 */
function analyzeFrames(frames) {
  let maxNudityScore = 0;
  let maxViolenceScore = 0;
  let maxAiGeneratedScore = 0;
  const flaggedFrames = [];

  for (const frame of frames) {
    const position = frame.info?.position || 0;

    // Nudity score: use max of raw/partial nudity
    const nudityScore = Math.max(
      frame.nudity?.raw || 0,
      frame.nudity?.partial || 0
    );

    // Violence score
    const violenceScore = frame.violence?.prob || 0;

    // AI-generated score
    const aiGeneratedScore = frame.type?.ai_generated || 0;

    // Track maximums
    maxNudityScore = Math.max(maxNudityScore, nudityScore);
    maxViolenceScore = Math.max(maxViolenceScore, violenceScore);
    maxAiGeneratedScore = Math.max(maxAiGeneratedScore, aiGeneratedScore);

    // Flag frames exceeding thresholds
    if (nudityScore >= NUDITY_THRESHOLD || violenceScore >= VIOLENCE_THRESHOLD || aiGeneratedScore >= AI_GENERATED_THRESHOLD) {
      flaggedFrames.push({
        position,
        nudityScore,
        violenceScore,
        aiGeneratedScore,
        reason: nudityScore >= NUDITY_THRESHOLD ? 'nudity'
              : violenceScore >= VIOLENCE_THRESHOLD ? 'violence'
              : 'ai_generated'
      });
    }
  }

  return {
    maxNudityScore,
    maxViolenceScore,
    maxAiGeneratedScore,
    flaggedFrames
  };
}
