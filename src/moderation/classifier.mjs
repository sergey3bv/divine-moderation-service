// ABOUTME: Content severity classification logic
// ABOUTME: Determines action (SAFE/REVIEW/QUARANTINE) based on moderation scores

// Default thresholds (can be overridden by env vars)
const DEFAULT_NSFW_HIGH = 0.8;
const DEFAULT_NSFW_MEDIUM = 0.6;
const DEFAULT_VIOLENCE_HIGH = 0.8;
const DEFAULT_VIOLENCE_MEDIUM = 0.6;
const DEFAULT_AI_GENERATED_HIGH = 0.8;
const DEFAULT_AI_GENERATED_MEDIUM = 0.6;

/**
 * Classify moderation result into action categories
 * @param {Object} moderationData - Result from moderation service
 * @param {number} moderationData.maxNudityScore - Highest nudity score (0-1)
 * @param {number} moderationData.maxViolenceScore - Highest violence score (0-1)
 * @param {Array} [moderationData.flaggedFrames] - Frames that exceeded thresholds
 * @param {Object} [env] - Environment variables with threshold config
 * @returns {Object} Classification result with action and severity
 */
export function classifyModerationResult(moderationData, env = {}) {
  const {
    maxNudityScore = 0,
    maxViolenceScore = 0,
    maxAiGeneratedScore = 0,
    flaggedFrames = []
  } = moderationData;

  // Load thresholds from env or use defaults
  const nsfwHigh = parseFloat(env.NSFW_THRESHOLD_HIGH || DEFAULT_NSFW_HIGH);
  const nsfwMedium = parseFloat(env.NSFW_THRESHOLD_MEDIUM || DEFAULT_NSFW_MEDIUM);
  const violenceHigh = parseFloat(env.VIOLENCE_THRESHOLD_HIGH || DEFAULT_VIOLENCE_HIGH);
  const violenceMedium = parseFloat(env.VIOLENCE_THRESHOLD_MEDIUM || DEFAULT_VIOLENCE_MEDIUM);
  const aiGeneratedHigh = parseFloat(env.AI_GENERATED_THRESHOLD_HIGH || DEFAULT_AI_GENERATED_HIGH);
  const aiGeneratedMedium = parseFloat(env.AI_GENERATED_THRESHOLD_MEDIUM || DEFAULT_AI_GENERATED_MEDIUM);

  // Determine severity and action
  let action, severity, reason, primaryConcern;

  if (maxNudityScore >= nsfwHigh || maxViolenceScore >= violenceHigh || maxAiGeneratedScore >= aiGeneratedHigh) {
    action = 'QUARANTINE';
    severity = 'high';

    // Determine primary concern based on highest score
    const scores = { nudity: maxNudityScore, violence: maxViolenceScore, ai_generated: maxAiGeneratedScore };
    primaryConcern = Object.keys(scores).reduce((a, b) => scores[a] >= scores[b] ? a : b);

    reason = `High ${primaryConcern.replace('_', '-')} detected (score: ${scores[primaryConcern]})`;
  }
  else if (maxNudityScore >= nsfwMedium || maxViolenceScore >= violenceMedium || maxAiGeneratedScore >= aiGeneratedMedium) {
    action = 'REVIEW';
    severity = 'medium';

    // Determine primary concern based on highest score
    const scores = { nudity: maxNudityScore, violence: maxViolenceScore, ai_generated: maxAiGeneratedScore };
    primaryConcern = Object.keys(scores).reduce((a, b) => scores[a] >= scores[b] ? a : b);

    reason = `Potential ${primaryConcern.replace('_', '-')} detected, requires human review (score: ${scores[primaryConcern]})`;
  }
  else {
    action = 'SAFE';
    severity = 'low';
    primaryConcern = null;
    reason = 'Content appears safe for all audiences';
  }

  return {
    action,
    severity,
    reason,
    primaryConcern,
    scores: {
      nudity: maxNudityScore,
      violence: maxViolenceScore,
      ai_generated: maxAiGeneratedScore
    },
    flaggedFrames
  };
}
