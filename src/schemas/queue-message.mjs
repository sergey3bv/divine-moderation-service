// ABOUTME: Queue message schema for video moderation requests
// ABOUTME: Validates incoming messages from the main divine video service

/**
 * Queue message structure expected from main service
 * @typedef {Object} QueueMessage
 * @property {string} sha256 - SHA256 hash of the video (64 hex chars)
 * @property {string} r2Key - R2 object key for the video
 * @property {string} [uploadedBy] - Nostr pubkey of uploader (64 hex chars)
 * @property {number} uploadedAt - Unix timestamp in milliseconds
 * @property {Object} [metadata] - Optional metadata about the video
 * @property {number} [metadata.fileSize] - File size in bytes
 * @property {string} [metadata.contentType] - MIME type
 * @property {number} [metadata.duration] - Duration in seconds
 */

const HEX_64_REGEX = /^[0-9a-f]{64}$/i;

/**
 * Validates a queue message
 * @param {any} message - Message to validate
 * @returns {{valid: true, data: QueueMessage} | {valid: false, error: string}}
 */
export function validateQueueMessage(message) {
  if (!message || typeof message !== 'object') {
    return { valid: false, error: 'Message must be an object' };
  }

  // Validate sha256
  if (!message.sha256 || typeof message.sha256 !== 'string') {
    return { valid: false, error: 'sha256 is required and must be a string' };
  }
  if (!HEX_64_REGEX.test(message.sha256)) {
    return { valid: false, error: 'sha256 must be 64 hexadecimal characters' };
  }

  // Validate r2Key
  if (!message.r2Key || typeof message.r2Key !== 'string') {
    return { valid: false, error: 'r2Key is required and must be a string' };
  }

  // Validate uploadedBy if present
  if (message.uploadedBy !== undefined) {
    if (typeof message.uploadedBy !== 'string') {
      return { valid: false, error: 'uploadedBy must be a string' };
    }
    if (!HEX_64_REGEX.test(message.uploadedBy)) {
      return { valid: false, error: 'uploadedBy must be a valid nostr pubkey (64 hex characters)' };
    }
  }

  // Validate uploadedAt
  if (!message.uploadedAt || typeof message.uploadedAt !== 'number') {
    return { valid: false, error: 'uploadedAt is required and must be a number' };
  }

  // Metadata is optional, no validation needed

  return { valid: true, data: message };
}
