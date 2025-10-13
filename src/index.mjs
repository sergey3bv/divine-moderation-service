// ABOUTME: Main entry point for Divine video moderation worker
// ABOUTME: Consumes queue messages and processes videos for harmful content

import { validateQueueMessage } from './schemas/queue-message.mjs';
import { moderateVideo } from './moderation/pipeline.mjs';
import { publishToFaro } from './nostr/publisher.mjs';
import { verifyPassword, createSession, requireAuth, getTokenFromCookie, deleteSession } from './admin/auth.mjs';
import { fetchNostrEventBySha256, parseVideoEventMetadata } from './nostr/relay-client.mjs';
import dashboardHTML from './admin/dashboard.html';
import loginHTML from './admin/login.html';

export default {
  /**
   * HTTP handler for testing and admin dashboard
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    // Admin dashboard routes
    if (url.pathname === '/admin' || url.pathname === '/admin/') {
      return Response.redirect(`${url.origin}/admin/dashboard`, 302);
    }

    if (url.pathname === '/admin/login') {
      if (request.method === 'POST') {
        // Handle login
        const { password } = await request.json();
        const isValid = await verifyPassword(password, env);

        if (!isValid) {
          return new Response(JSON.stringify({ success: false, error: 'Invalid password' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // Create session
        const token = await createSession(env);

        return new Response(JSON.stringify({ success: true }), {
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': `admin_token=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`
          }
        });
      }

      // Show login page
      return new Response(loginHTML, {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    if (url.pathname === '/admin/logout') {
      const cookieHeader = request.headers.get('Cookie');
      const token = getTokenFromCookie(cookieHeader);
      await deleteSession(token, env);

      return new Response(JSON.stringify({ success: true }), {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'admin_token=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'
        }
      });
    }

    if (url.pathname === '/admin/dashboard') {
      // Check authentication
      const authError = await requireAuth(request, env);
      if (authError) {
        return Response.redirect(`${url.origin}/admin/login`, 302);
      }

      return new Response(dashboardHTML, {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    if (url.pathname === '/admin/api/videos') {
      // Check authentication
      const authError = await requireAuth(request, env);
      if (authError) {
        return authError;
      }

      // Parse pagination parameters
      const cursor = url.searchParams.get('cursor') || undefined;
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100); // Max 100 per page

      // List moderation results from KV with pagination
      const videos = [];
      const listResult = await env.MODERATION_KV.list({
        prefix: 'moderation:',
        cursor,
        limit
      });

      for (const key of listResult.keys) {
        const data = await env.MODERATION_KV.get(key.name);
        if (data) {
          try {
            videos.push(JSON.parse(data));
          } catch (error) {
            console.error(`Failed to parse moderation data for ${key.name}:`, error);
          }
        }
      }

      return new Response(JSON.stringify({
        videos,
        cursor: listResult.cursor,
        list_complete: listResult.list_complete
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get Nostr event context for a video
    if (url.pathname.startsWith('/admin/api/nostr-context/')) {
      // Check authentication
      const authError = await requireAuth(request, env);
      if (authError) {
        return authError;
      }

      const sha256 = url.pathname.split('/')[4];

      try {
        const event = await fetchNostrEventBySha256(sha256, ['wss://relay3.openvine.co']);

        if (!event) {
          return new Response(JSON.stringify({ found: false }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const metadata = parseVideoEventMetadata(event);

        return new Response(JSON.stringify({ found: true, metadata }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error(`[ADMIN] Failed to fetch Nostr context for ${sha256}:`, error);
        return new Response(JSON.stringify({ found: false, error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Admin video proxy - bypasses quarantine check for authenticated moderators
    if (url.pathname.startsWith('/admin/video/')) {
      // Check authentication
      const authError = await requireAuth(request, env);
      if (authError) {
        return new Response('Unauthorized', { status: 401 });
      }

      // Extract sha256 from path
      const sha256 = url.pathname.split('/')[3].replace('.mp4', '');

      console.log(`[ADMIN] Fetching video: ${sha256}`);

      // Try multiple R2 key formats (Blossom uses blobs/ prefix)
      const possibleKeys = [
        `blobs/${sha256}`,        // New SDK worker format
        `videos/${sha256}.mp4`,   // Old format
        `${sha256}.mp4`,
        sha256
      ];

      let object = null;
      let usedKey = null;

      for (const key of possibleKeys) {
        console.log(`[ADMIN] Trying R2 key: ${key}`);
        object = await env.R2_VIDEOS.get(key);
        if (object) {
          usedKey = key;
          console.log(`[ADMIN] Found video at: ${key}`);
          break;
        }
      }

      if (!object) {
        console.error(`[ADMIN] Video not found in R2: ${sha256}`);
        return new Response(JSON.stringify({
          error: 'Video not found in R2',
          sha256,
          triedKeys: possibleKeys
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      console.log(`[ADMIN] Serving video from R2 key: ${usedKey}`);

      return new Response(object.body, {
        headers: {
          'Content-Type': 'video/mp4',
          'Cache-Control': 'private, no-cache',
          'X-Admin-Bypass': 'true',
          'X-R2-Key': usedKey
        }
      });
    }

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
      const ageRestricted = await env.MODERATION_KV.get(`age-restricted:${sha256}`);
      const permanentBan = await env.MODERATION_KV.get(`permanent-ban:${sha256}`);
      // Keep old quarantine key for backward compatibility
      const quarantine = await env.MODERATION_KV.get(`quarantine:${sha256}`);

      return new Response(JSON.stringify({
        sha256,
        moderation: result ? JSON.parse(result) : null,
        age_restricted: ageRestricted ? JSON.parse(ageRestricted) : null,
        permanent_ban: permanentBan ? JSON.parse(permanentBan) : null,
        quarantine: quarantine ? JSON.parse(quarantine) : null  // Legacy
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Divine Moderation Service\n\nEndpoints:\nPOST /test-moderate {"sha256":"..."}\nGET  /check-result/{sha256}\nGET  /admin (password protected)', {
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

        const { sha256, uploadedBy, uploadedAt, metadata } = validation.data;
        console.log(`[MODERATION] Step 2: Message validated for ${sha256}`);

        // Check if already moderated (duplicate prevention)
        console.log(`[MODERATION] Step 3: Checking for existing moderation result`);
        const existingResult = await env.MODERATION_KV.get(`moderation:${sha256}`);

        if (existingResult) {
          console.log(`[MODERATION] ⚠️ SKIPPED ${sha256} - already moderated`);
          const existing = JSON.parse(existingResult);
          console.log(`[MODERATION] Previous result: action=${existing.action}, processedAt=${new Date(existing.processedAt).toISOString()}`);
          message.ack();
          continue;
        }

        console.log(`[MODERATION] Step 4: No existing result found, starting analysis for ${sha256}`);
        console.log(`[MODERATION] Blossom blob URL: https://${env.CDN_DOMAIN}/blobs/${sha256}`);

        // Run moderation pipeline
        const result = await moderateVideo({
          sha256,
          uploadedBy,
          uploadedAt,
          metadata
        }, env);

        console.log(`[MODERATION] Step 5: Analysis complete for ${sha256}`);
        console.log(`[MODERATION] Result: action=${result.action}, severity=${result.severity}`);
        console.log(`[MODERATION] Scores: nudity=${result.scores.nudity}, violence=${result.scores.violence}, ai=${result.scores.ai_generated}`);

        console.log(`[MODERATION] Step 6: Storing result in KV`);
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
        console.log(`[MODERATION] Step 7: KV write successful`);

        // Handle based on severity
        console.log(`[MODERATION] Step 8: Handling result (action=${result.action})`);
        await handleModerationResult(result, env);
        console.log(`[MODERATION] Step 9: Result handled`);

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

    case 'AGE_RESTRICTED':
      // Age-restricted content - requires user consent but not banned
      console.log(`[MODERATION] ${sha256} age-restricted (${result.category}) - writing restriction to KV`);
      await env.MODERATION_KV.put(
        `age-restricted:${sha256}`,
        JSON.stringify({
          category: result.category,
          reason,
          scores,
          timestamp: Date.now(),
          severity
        })
      );
      console.log(`[MODERATION] ${sha256} - age restriction written`);

      // Notify via Nostr
      try {
        await publishToFaro({
          type: 'age-restricted',
          sha256,
          cdnUrl,
          category: result.category,
          scores,
          reason,
          severity
        }, env);
        console.log(`[MODERATION] ${sha256} - Nostr age-restricted event published`);
      } catch (error) {
        console.error(`[MODERATION] ${sha256} - Nostr publish failed:`, error);
      }
      break;

    case 'PERMANENT_BAN':
      // Permanent ban - never serve to anyone except admins
      console.log(`[MODERATION] ${sha256} PERMANENTLY BANNED (${result.category}) - writing to KV`);
      await env.MODERATION_KV.put(
        `permanent-ban:${sha256}`,
        JSON.stringify({
          category: result.category,
          reason,
          scores,
          timestamp: Date.now(),
          severity
        })
      );
      console.log(`[MODERATION] ${sha256} - permanent ban written`);

      // High-priority notification
      try {
        await publishToFaro({
          type: 'permanent-ban',
          sha256,
          cdnUrl,
          category: result.category,
          scores,
          reason,
          severity
        }, env);
        console.log(`[MODERATION] ${sha256} - Nostr permanent ban event published`);
      } catch (error) {
        console.error(`[MODERATION] ${sha256} - Nostr publish failed:`, error);
      }
      break;

    default:
      console.warn(`[MODERATION] Unknown action: ${action}`);
  }

  console.log(`[MODERATION] handleModerationResult finished for ${sha256}`);
}
