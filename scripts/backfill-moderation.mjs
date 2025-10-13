// ABOUTME: Backfill script to moderate existing kind 34236 events from relay
// ABOUTME: Fetches events, extracts SHA256 from imeta tags, and queues for moderation

import { WebSocket } from 'ws';

/**
 * Extract SHA256 from imeta tag parameters
 */
function extractSha256FromImeta(event) {
  if (!event || !event.tags) return null;

  for (const tag of event.tags) {
    if (tag[0] === 'imeta') {
      for (let i = 1; i < tag.length; i++) {
        const param = tag[i];
        if (param && param.startsWith('x ')) {
          return param.substring(2).trim();
        }
      }
    }
  }

  return null;
}

/**
 * Fetch kind 34236 events from relay
 */
async function fetchEventsFromRelay(relayUrl, limit = 100) {
  return new Promise((resolve, reject) => {
    const events = [];
    let ws;

    const timeout = setTimeout(() => {
      if (ws) ws.close();
      reject(new Error('WebSocket timeout'));
    }, 30000);

    try {
      ws = new WebSocket(relayUrl);

      ws.on('open', () => {
        const subscriptionId = Math.random().toString(36).substring(7);
        const reqMessage = JSON.stringify([
          'REQ',
          subscriptionId,
          {
            kinds: [34236],
            limit
          }
        ]);

        console.log(`[BACKFILL] Requesting ${limit} kind 34236 events from ${relayUrl}`);
        ws.send(reqMessage);
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg[0] === 'EVENT') {
            const event = msg[2];
            events.push(event);
          }

          if (msg[0] === 'EOSE') {
            console.log(`[BACKFILL] Received ${events.length} events`);
            clearTimeout(timeout);
            ws.close();
            resolve(events);
          }
        } catch (err) {
          console.error('[BACKFILL] Failed to parse message:', err);
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

/**
 * Check if video has been moderated
 */
async function checkModerated(sha256, workerUrl) {
  const response = await fetch(`${workerUrl}/check-result/${sha256}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  return data.moderation !== null;
}

/**
 * Queue video for moderation
 */
async function queueModeration(sha256, workerUrl) {
  const response = await fetch(`${workerUrl}/test-moderate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha256 })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Main backfill function
 */
async function backfillModeration(options = {}) {
  const {
    relayUrl = 'wss://relay3.openvine.co',
    workerUrl = 'https://divine-moderation-service.protestnet.workers.dev',
    limit = 100,
    dryRun = false
  } = options;

  console.log(`[BACKFILL] Starting backfill (limit: ${limit}, dry-run: ${dryRun})`);
  console.log(`[BACKFILL] Relay: ${relayUrl}`);
  console.log(`[BACKFILL] Worker: ${workerUrl}`);
  console.log('');

  // Step 1: Fetch events from relay
  const events = await fetchEventsFromRelay(relayUrl, limit);
  console.log(`[BACKFILL] Fetched ${events.length} events`);
  console.log('');

  // Step 2: Extract SHA256s and check moderation status
  const videoData = [];

  for (const event of events) {
    const sha256 = extractSha256FromImeta(event);

    if (!sha256) {
      console.log(`[BACKFILL] ⚠️  Event ${event.id} has no SHA256 in imeta tag`);
      continue;
    }

    videoData.push({
      eventId: event.id,
      sha256,
      event
    });
  }

  console.log(`[BACKFILL] Extracted ${videoData.length} videos with SHA256`);
  console.log('');

  // Step 3: Check which ones need moderation
  const stats = {
    total: videoData.length,
    alreadyModerated: 0,
    needsModeration: 0,
    queued: 0,
    failed: 0
  };

  for (const video of videoData) {
    try {
      const isModerated = await checkModerated(video.sha256, workerUrl);

      if (isModerated) {
        stats.alreadyModerated++;
        console.log(`[BACKFILL] ✓ ${video.sha256.substring(0, 16)}... already moderated`);
      } else {
        stats.needsModeration++;

        if (!dryRun) {
          const result = await queueModeration(video.sha256, workerUrl);
          stats.queued++;
          console.log(`[BACKFILL] ⏩ ${video.sha256.substring(0, 16)}... queued for moderation`);

          // Rate limit: 1 request per second
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          console.log(`[BACKFILL] 🔍 ${video.sha256.substring(0, 16)}... needs moderation (dry-run, not queued)`);
        }
      }
    } catch (error) {
      stats.failed++;
      console.error(`[BACKFILL] ✗ ${video.sha256.substring(0, 16)}... error: ${error.message}`);
    }
  }

  // Summary
  console.log('');
  console.log('='.repeat(60));
  console.log('[BACKFILL] Summary:');
  console.log(`  Total videos:         ${stats.total}`);
  console.log(`  Already moderated:    ${stats.alreadyModerated}`);
  console.log(`  Needs moderation:     ${stats.needsModeration}`);
  console.log(`  Queued for moderation: ${stats.queued}`);
  console.log(`  Failed:               ${stats.failed}`);
  console.log('='.repeat(60));

  return stats;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const options = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--relay' && args[i + 1]) {
      options.relayUrl = args[i + 1];
      i++;
    } else if (args[i] === '--worker' && args[i + 1]) {
      options.workerUrl = args[i + 1];
      i++;
    } else if (args[i] === '--dry-run') {
      options.dryRun = true;
    }
  }

  backfillModeration(options)
    .then(() => {
      console.log('[BACKFILL] Done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[BACKFILL] Fatal error:', error);
      process.exit(1);
    });
}

export { backfillModeration, fetchEventsFromRelay, extractSha256FromImeta };
