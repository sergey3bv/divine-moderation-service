// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// ABOUTME: Nostr relay WebSocket client for fetching event context
// ABOUTME: Connects to relay3.openvine.co to get kind 34236 video events by SHA256

/**
 * Fetch Nostr event for a video SHA256 from relay
 * @param {string} sha256 - Video hash
 * @param {string[]} relays - Relay URLs to query
 * @returns {Promise<Object|null>} Nostr event or null if not found
 */
export async function fetchNostrEventBySha256(sha256, relays = ['wss://relay3.openvine.co']) {
  for (const relay of relays) {
    try {
      const event = await fetchFromRelay(relay, sha256);
      if (event) {
        return event;
      }
    } catch (error) {
      console.error(`[NOSTR] Failed to fetch from ${relay}:`, error);
    }
  }

  return null;
}

/**
 * Connect to a single relay and query for event
 * Since SHA256 is inside imeta tag parameters, we need to fetch events and filter client-side
 */
async function fetchFromRelay(relayUrl, sha256) {
  return new Promise((resolve, reject) => {
    let ws;
    const timeout = setTimeout(() => {
      if (ws) ws.close();
      reject(new Error('WebSocket timeout'));
    }, 30000); // 30 second timeout for larger query

    try {
      ws = new WebSocket(relayUrl);
      let foundEvent = null;

      ws.addEventListener('open', () => {
        // Query for kind 34236 events - filter client-side since SHA256 is in imeta parameters
        const subscriptionId = Math.random().toString(36).substring(7);
        const reqMessage = JSON.stringify([
          'REQ',
          subscriptionId,
          {
            kinds: [34236],
            limit: 1000 // Fetch recent events to search through
          }
        ]);

        console.log(`[NOSTR] Querying ${relayUrl} for kind 34236 events to find SHA256: ${sha256}`);
        ws.send(reqMessage);
      });

      ws.addEventListener('message', (msg) => {
        try {
          const data = JSON.parse(msg.data);

          // Check if this is an EVENT message
          if (data[0] === 'EVENT' && !foundEvent) {
            const event = data[2];

            // Check if this event's imeta tag contains the SHA256
            const eventSha256 = extractSha256FromImeta(event);

            if (eventSha256 === sha256) {
              console.log(`[NOSTR] Found matching event for SHA256: ${sha256}`);
              foundEvent = event;
              clearTimeout(timeout);
              ws.close();
              resolve(event);
            }
          }

          // Check if this is an EOSE (end of stored events)
          if (data[0] === 'EOSE') {
            clearTimeout(timeout);
            ws.close();
            if (!foundEvent) {
              console.log(`[NOSTR] No event found for SHA256: ${sha256}`);
              resolve(null);
            }
          }
        } catch (err) {
          console.error('[NOSTR] Failed to parse message:', err);
        }
      });

      ws.addEventListener('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      ws.addEventListener('close', () => {
        clearTimeout(timeout);
        if (!foundEvent) {
          resolve(null);
        }
      });

    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

/**
 * Extract SHA256 from imeta tag parameters
 * imeta format: ["imeta", "url ...", "m video/mp4", "x <sha256>", "image ..."]
 */
function extractSha256FromImeta(event) {
  if (!event || !event.tags) return null;

  for (const tag of event.tags) {
    if (tag[0] === 'imeta') {
      // Parse space-separated parameters in imeta tag
      for (let i = 1; i < tag.length; i++) {
        const param = tag[i];
        // Look for "x <sha256>" parameter
        if (param && param.startsWith('x ')) {
          return param.substring(2).trim();
        }
      }
    }
  }

  return null;
}

/**
 * Extract metadata from kind 34236 event tags
 */
export function parseVideoEventMetadata(event) {
  if (!event || !event.tags) {
    return null;
  }

  const metadata = {
    title: null,
    author: null,
    platform: null,
    loops: null,
    likes: null,
    comments: null,
    url: null,
    publishedAt: null
  };

  for (const tag of event.tags) {
    const [key, value] = tag;

    switch (key) {
      case 'title':
        metadata.title = value;
        break;
      case 'author':
        metadata.author = value;
        break;
      case 'platform':
        metadata.platform = value;
        break;
      case 'loops':
        metadata.loops = parseInt(value, 10);
        break;
      case 'likes':
        metadata.likes = parseInt(value, 10);
        break;
      case 'comments':
        metadata.comments = parseInt(value, 10);
        break;
      case 'r':
        metadata.url = value;
        break;
      case 'published_at':
        metadata.publishedAt = parseInt(value, 10);
        break;
    }
  }

  metadata.content = event.content;
  metadata.eventId = event.id;
  metadata.createdAt = event.created_at;

  return metadata;
}
