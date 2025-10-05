// ABOUTME: Nostr event publisher for faro.nos.social moderation system
// ABOUTME: Creates and publishes NIP-56 (kind 1984) reporting events

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { Relay } from 'nostr-tools/relay';
import { hexToBytes } from '@noble/hashes/utils';

/**
 * Publish moderation event to faro.nos.social
 * @param {Object} report - Moderation report data
 * @param {string} report.type - Report type: 'quarantine', 'review', 'safe'
 * @param {string} report.sha256 - Video hash
 * @param {Object} report.scores - Moderation scores
 * @param {string} [report.reason] - Human-readable reason
 * @param {string} [report.cdnUrl] - URL to video
 * @param {Object} env - Environment with Nostr credentials
 * @param {Object} [mockRelay] - Mock relay for testing
 */
export async function publishToFaro(report, env, mockRelay = null) {
  // Don't publish safe content
  if (report.type === 'safe') {
    return;
  }

  // Validate configuration
  if (!env.NOSTR_PRIVATE_KEY) {
    throw new Error('NOSTR_PRIVATE_KEY not configured');
  }
  if (!env.FARO_RELAY_URL) {
    throw new Error('FARO_RELAY_URL not configured');
  }

  // Create kind 1984 report event (NIP-56)
  const event = createReportEvent(report, env.NOSTR_PRIVATE_KEY);

  // Publish to relay
  if (mockRelay) {
    // Testing path
    await mockRelay.publish(event);
  } else {
    // Production path
    const relay = await Relay.connect(env.FARO_RELAY_URL);
    try {
      await relay.publish(event);
    } finally {
      relay.close();
    }
  }
}

/**
 * Create a signed NIP-56 report event
 * @param {Object} report - Report data
 * @param {string} privateKeyHex - Nostr private key (hex)
 * @returns {Object} Signed Nostr event
 */
function createReportEvent(report, privateKeyHex) {
  const { sha256, scores, reason, cdnUrl, type } = report;

  // Determine label based on primary concern
  let label = 'NS'; // Not Safe (NSFW)
  if (scores.violence > scores.nudity && scores.violence > (scores.ai_generated || 0)) {
    label = 'VI'; // Violence
  } else if ((scores.ai_generated || 0) > scores.nudity && (scores.ai_generated || 0) > scores.violence) {
    label = 'AI'; // AI-generated
  }

  // Build tags
  const tags = [
    ['L', 'MOD'],  // Namespace: Moderation
    ['l', label, 'MOD'],  // Label within MOD namespace
    ['p', sha256]  // Report target (using video hash as identifier)
  ];

  if (cdnUrl) {
    tags.push(['r', cdnUrl]);  // Reference URL
  }

  // Build content
  const content = JSON.stringify({
    reason: reason || `${type} flagged by automated moderation`,
    scores,
    type,
    timestamp: Date.now()
  }, null, 2);

  // Create unsigned event
  const unsignedEvent = {
    kind: 1984,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content
  };

  // Sign event
  const secretKey = hexToBytes(privateKeyHex);
  const signedEvent = finalizeEvent(unsignedEvent, secretKey);

  return signedEvent;
}
