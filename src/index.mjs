// ABOUTME: Main entry point for Divine video moderation worker
// ABOUTME: Consumes queue messages and processes videos for harmful content

import { validateQueueMessage } from './schemas/queue-message.mjs';
import { moderateVideo } from './moderation/pipeline.mjs';
import { publishToFaro } from './nostr/publisher.mjs';

export default {
  /**
   * HTTP handler for testing
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    // Test endpoint to manually trigger moderation
    if (url.pathname === '/test-moderate' && request.method === 'POST') {
      const body = await request.json();
      const { sha256 } = body;

      // Send to queue (uploadedBy is optional, omit for test)
      await env.MODERATION_QUEUE.send({
        sha256,
        r2Key: `videos/${sha256}.mp4`,
        uploadedAt: Date.now(),
        metadata: { fileSize: 1000000, contentType: 'video/mp4', duration: 6 }
      });

      return new Response(JSON.stringify({ success: true, message: 'Moderation queued', sha256 }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Test KV write
    if (url.pathname === '/test-kv') {
      try {
        await env.MODERATION_KV.put('test-key', JSON.stringify({ test: true, timestamp: Date.now() }));
        const readBack = await env.MODERATION_KV.get('test-key');
        return new Response(JSON.stringify({ success: true, written: true, readBack }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          headers: { 'Content-Type': 'application/json' },
          status: 500
        });
      }
    }

    // Check moderation result
    if (url.pathname.startsWith('/check-result/')) {
      const sha256 = url.pathname.split('/')[2];
      const result = await env.MODERATION_KV.get(`moderation:${sha256}`);
      const quarantine = await env.MODERATION_KV.get(`quarantine:${sha256}`);

      return new Response(JSON.stringify({
        sha256,
        moderation: result ? JSON.parse(result) : null,
        quarantine: quarantine ? JSON.parse(quarantine) : null
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Divine Moderation Service\n\nEndpoints:\nPOST /test-moderate {"sha256":"..."}\nGET  /check-result/{sha256}', {
      headers: { 'Content-Type': 'text/plain' }
    });
  },

  /**
   * Queue consumer for video moderation
   * Triggered when messages are sent to the video-moderation-queue
   */
  async queue(batch, env) {
    console.log(`[MODERATION] Processing batch of ${batch.messages.length} videos`);

    for (const message of batch.messages) {
      const startTime = Date.now();

      try {
        console.log('[MODERATION] Step 1: Validating message');

        // Validate message schema
        const validation = validateQueueMessage(message.body);
        if (!validation.valid) {
          console.error(`[MODERATION] Invalid message schema: ${validation.error}`);
          message.ack(); // Acknowledge to remove invalid message
          continue;
        }

        const { sha256, r2Key, uploadedBy, uploadedAt, metadata } = validation.data;
        console.log(`[MODERATION] Step 2: Message validated for ${sha256}`);

        console.log(`[MODERATION] Step 3: Starting analysis for ${sha256}`);
        console.log(`[MODERATION] CDN URL will be: https://${env.CDN_DOMAIN}/${sha256}.mp4`);

        // Run moderation pipeline
        const result = await moderateVideo({
          sha256,
          r2Key,
          uploadedBy,
          uploadedAt,
          metadata
        }, env);

        console.log(`[MODERATION] Step 4: Analysis complete for ${sha256}`);
        console.log(`[MODERATION] Result: action=${result.action}, severity=${result.severity}`);
        console.log(`[MODERATION] Scores: nudity=${result.scores.nudity}, violence=${result.scores.violence}, ai=${result.scores.ai_generated}`);

        console.log(`[MODERATION] Step 5: Storing result in KV`);
        // Store result in KV
        await env.MODERATION_KV.put(
          `moderation:${sha256}`,
          JSON.stringify({
            ...result,
            processedAt: Date.now(),
            processingTimeMs: Date.now() - startTime
          }),
          {
            expirationTtl: 60 * 60 * 24 * 90 // 90 days
          }
        );
        console.log(`[MODERATION] Step 6: KV write successful`);

        // Handle based on severity
        console.log(`[MODERATION] Step 7: Handling result (action=${result.action})`);
        await handleModerationResult(result, env);
        console.log(`[MODERATION] Step 8: Result handled`);

        // Acknowledge successful processing
        message.ack();

        console.log(`[MODERATION] ✅ COMPLETED ${sha256} in ${Date.now() - startTime}ms - ${result.action}`);

      } catch (error) {
        console.error(`[MODERATION] Error processing message:`, error);

        // Retry logic
        if (message.attempts < 3) {
          console.log(`[MODERATION] Retrying (attempt ${message.attempts + 1}/3)`);
          message.retry({ delaySeconds: Math.pow(2, message.attempts) * 10 });
        } else {
          console.error(`[MODERATION] Max retries exceeded, logging failure`);

          // Log failed moderation
          await env.MODERATION_KV.put(
            `failed:${message.body.sha256 || 'unknown'}`,
            JSON.stringify({
              error: error.message,
              stack: error.stack,
              message: message.body,
              attempts: message.attempts,
              timestamp: Date.now()
            })
          );

          message.ack(); // Acknowledge to prevent infinite retries
        }
      }
    }
  }
};

/**
 * Handle moderation result based on severity
 */
async function handleModerationResult(result, env) {
  const { sha256, action, scores, reason, flaggedFrames, severity, cdnUrl } = result;

  console.log(`[MODERATION] handleModerationResult called for ${sha256} with action ${action}`);

  switch (action) {
    case 'SAFE':
      // Mark as approved, no further action needed
      console.log(`[MODERATION] ${sha256} approved (no further action)`);
      break;

    case 'REVIEW':
      // Flag for human review via Nostr event to faro.nos.social
      console.log(`[MODERATION] ${sha256} flagged for review - publishing to Nostr`);
      try {
        await publishToFaro({
          type: 'review',
          sha256,
          cdnUrl,
          scores,
          reason,
          frames: flaggedFrames
        }, env);
        console.log(`[MODERATION] ${sha256} - Nostr event published successfully`);
      } catch (error) {
        console.error(`[MODERATION] ${sha256} - Nostr publish failed:`, error);
        // Don't throw - we don't want Nostr failures to fail the whole moderation
      }
      break;

    case 'QUARANTINE':
      // Immediate quarantine - mark in KV (actual deletion handled by main service)
      console.log(`[MODERATION] ${sha256} quarantined - writing quarantine flag to KV`);
      await env.MODERATION_KV.put(
        `quarantine:${sha256}`,
        JSON.stringify({
          reason,
          scores,
          timestamp: Date.now(),
          severity
        })
      );
      console.log(`[MODERATION] ${sha256} - quarantine flag written`);

      // Notify via Nostr
      console.log(`[MODERATION] ${sha256} - publishing quarantine event to Nostr`);
      try {
        await publishToFaro({
          type: 'quarantine',
          sha256,
          cdnUrl,
          scores,
          reason,
          severity
        }, env);
        console.log(`[MODERATION] ${sha256} - Nostr quarantine event published`);
      } catch (error) {
        console.error(`[MODERATION] ${sha256} - Nostr publish failed:`, error);
        // Don't throw - we don't want Nostr failures to fail the whole moderation
      }
      break;

    default:
      console.warn(`[MODERATION] Unknown action: ${action}`);
  }

  console.log(`[MODERATION] handleModerationResult finished for ${sha256}`);
}
