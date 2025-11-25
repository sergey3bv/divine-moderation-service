// ABOUTME: Main entry point for Divine video moderation worker
// ABOUTME: Consumes queue messages and processes videos for harmful content

import { validateQueueMessage } from './schemas/queue-message.mjs';
import { moderateVideo } from './moderation/pipeline.mjs';
import { publishToFaro, publishLabelEvent } from './nostr/publisher.mjs';
import { verifyPassword, createSession, requireAuth, getTokenFromCookie, deleteSession } from './admin/auth.mjs';
import { fetchNostrEventBySha256, parseVideoEventMetadata } from './nostr/relay-client.mjs';
import dashboardHTML from './admin/dashboard.html';
import loginHTML from './admin/login.html';
import swipeReviewHTML from './admin/swipe-review.html';

/**
 * NIP-32 label mapping for content categories
 * Maps internal category names to NIP-32/NIP-56 compatible labels
 */
const CATEGORY_TO_LABEL = {
  'nudity': { label: 'nudity', namespace: 'content-warning' },
  'violence': { label: 'violence', namespace: 'content-warning' },
  'gore': { label: 'gore', namespace: 'content-warning' },
  'offensive': { label: 'profanity', namespace: 'content-warning' },  // NIP-56 term
  'weapon': { label: 'weapons', namespace: 'content-warning' },
  'self_harm': { label: 'self-harm', namespace: 'content-warning' },
  'recreational_drug': { label: 'drugs', namespace: 'content-warning' },
  'alcohol': { label: 'alcohol', namespace: 'content-warning' },
  'tobacco': { label: 'tobacco', namespace: 'content-warning' },
  'ai_generated': { label: 'ai-generated', namespace: 'content-warning' },
  'deepfake': { label: 'deepfake', namespace: 'content-warning' },
  'medical': { label: 'medical', namespace: 'content-warning' },
  'gambling': { label: 'gambling', namespace: 'content-warning' }
};

/**
 * Generate NIP-32 style label tags based on scores and human verifications
 * @param {Object} scores - AI-generated scores for each category
 * @param {Object} categoryVerifications - Human verification status for each category
 * @returns {Array} Array of NIP-32 label tag arrays
 */
function generateNIP85Tags(scores, categoryVerifications = {}) {
  const tags = [];
  const namespaces = new Set();

  for (const [category, score] of Object.entries(scores || {})) {
    if (typeof score !== 'number' || score < 0.3) continue;

    const labelInfo = CATEGORY_TO_LABEL[category];
    if (!labelInfo) continue;

    const verification = categoryVerifications[category];

    // Only include tags that are:
    // 1. Confirmed by human, OR
    // 2. High confidence AI detection (>=0.7) and NOT rejected by human
    const isConfirmed = verification === 'confirmed';
    const isRejected = verification === 'rejected';
    const isHighConfidence = score >= 0.7;

    if (isRejected) continue;  // Human said "no, this is NOT this category"
    if (!isConfirmed && !isHighConfidence) continue;  // Low confidence and not verified

    namespaces.add(labelInfo.namespace);

    // NIP-32 format: ["l", "label", "namespace", {metadata}]
    const metadata = {
      confidence: score,
      verified: isConfirmed,
      source: isConfirmed ? 'human' : 'ai'
    };

    tags.push(['l', labelInfo.label, labelInfo.namespace, JSON.stringify(metadata)]);
  }

  // Add namespace declaration tags (L tags)
  for (const ns of namespaces) {
    tags.unshift(['L', ns]);
  }

  return tags;
}

export default {
  /**
   * HTTP handler for testing and admin dashboard
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const startTime = Date.now();
    const requestId = crypto.randomUUID().substring(0, 8);

    // Log all incoming requests
    console.log(`[${requestId}] ${request.method} ${url.pathname}${url.search ? '?' + url.search.substring(0, 100) : ''}`);

    // Admin dashboard routes
    if (url.pathname === '/admin' || url.pathname === '/admin/') {
      console.log(`[${requestId}] Redirecting to dashboard`);
      return Response.redirect(`${url.origin}/admin/dashboard`, 302);
    }

    if (url.pathname === '/admin/login') {
      if (request.method === 'POST') {
        console.log(`[${requestId}] Login attempt`);
        // Handle login
        const { password } = await request.json();
        const isValid = await verifyPassword(password, env);

        if (!isValid) {
          console.log(`[${requestId}] Login failed - invalid password`);
          return new Response(JSON.stringify({ success: false, error: 'Invalid password' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // Create session
        const token = await createSession(env);
        console.log(`[${requestId}] Login successful, session created`);

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
      console.log(`[${requestId}] Logout request`);
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

    if (url.pathname === '/admin/review') {
      // Check authentication
      const authError = await requireAuth(request, env);
      if (authError) {
        return Response.redirect(`${url.origin}/admin/login`, 302);
      }

      return new Response(swipeReviewHTML, {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    if (url.pathname === '/admin/api/videos') {
      // Check authentication
      const authError = await requireAuth(request, env);
      if (authError) {
        console.log(`[${requestId}] Unauthorized access to /admin/api/videos`);
        return authError;
      }

      // Parse pagination parameters
      const cursor = url.searchParams.get('cursor') || undefined;
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100); // Max 100 per page
      const actionFilter = url.searchParams.get('action') || 'all';
      console.log(`[${requestId}] Fetching videos: filter=${actionFilter}, limit=${limit}, cursor=${cursor ? 'yes' : 'no'}`);

      // Determine which prefixes to query based on action filter
      let prefixes = ['moderation:'];
      let filterActions = null;

      if (actionFilter === 'FLAGGED') {
        // Load from action-specific keys for flagged content
        prefixes = ['review:', 'age-restricted:', 'permanent-ban:'];
        filterActions = ['REVIEW', 'AGE_RESTRICTED', 'PERMANENT_BAN'];
      } else if (actionFilter === 'QUARANTINE') {
        prefixes = ['age-restricted:', 'permanent-ban:'];
        filterActions = ['AGE_RESTRICTED', 'PERMANENT_BAN'];
      } else if (actionFilter === 'REVIEW') {
        prefixes = ['review:'];
        filterActions = ['REVIEW'];
      } else if (actionFilter === 'SAFE') {
        // For SAFE, we need to load all and filter
        filterActions = ['SAFE'];
      }

      let allVideos = [];
      let nextCursor = undefined;
      let listComplete = true;

      if (actionFilter === 'all' || actionFilter === 'SAFE') {
        // Load from moderation: prefix with pagination
        const listResult = await env.MODERATION_KV.list({
          prefix: 'moderation:',
          cursor,
          limit: actionFilter === 'SAFE' ? limit * 3 : limit // Fetch more for SAFE since we filter
        });

        const videoPromises = listResult.keys.map(async (key) => {
          const data = await env.MODERATION_KV.get(key.name);
          if (data) {
            try {
              return JSON.parse(data);
            } catch (error) {
              console.error(`Failed to parse moderation data for ${key.name}:`, error);
              return null;
            }
          }
          return null;
        });

        const videoResults = await Promise.all(videoPromises);
        allVideos = videoResults.filter(v => v !== null);

        // Filter by action if needed
        if (filterActions) {
          allVideos = allVideos.filter(v => filterActions.includes(v.action));
        }

        // Trim to limit
        if (allVideos.length > limit) {
          allVideos = allVideos.slice(0, limit);
        }

        nextCursor = listResult.cursor;
        listComplete = listResult.list_complete;
      } else {
        // Load from action-specific prefixes and get full moderation data
        const allKeys = [];

        for (const prefix of prefixes) {
          const listResult = await env.MODERATION_KV.list({
            prefix,
            limit: 500 // Get more keys since we'll merge
          });

          for (const key of listResult.keys) {
            // Extract sha256 from key (e.g., "review:abc123" -> "abc123")
            const sha256 = key.name.split(':')[1];
            if (sha256) {
              allKeys.push(sha256);
            }
          }
        }

        // Deduplicate and get full moderation data
        const uniqueSha256s = [...new Set(allKeys)];

        // Fetch moderation data for each sha256
        const videoPromises = uniqueSha256s.slice(0, limit).map(async (sha256) => {
          const data = await env.MODERATION_KV.get(`moderation:${sha256}`);
          if (data) {
            try {
              return JSON.parse(data);
            } catch (error) {
              console.error(`Failed to parse moderation data for ${sha256}:`, error);
              return null;
            }
          }
          return null;
        });

        const videoResults = await Promise.all(videoPromises);
        allVideos = videoResults.filter(v => v !== null);

        // Sort by processedAt descending
        allVideos.sort((a, b) => (b.processedAt || 0) - (a.processedAt || 0));

        listComplete = uniqueSha256s.length <= limit;
      }

      console.log(`[${requestId}] Returning ${allVideos.length} videos in ${Date.now() - startTime}ms`);
      return new Response(JSON.stringify({
        videos: allVideos,
        cursor: nextCursor,
        list_complete: listComplete
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get real stats for dashboard
    if (url.pathname === '/admin/api/stats') {
      const authError = await requireAuth(request, env);
      if (authError) {
        console.log(`[${requestId}] Unauthorized access to /admin/api/stats`);
        return authError;
      }
      console.log(`[${requestId}] Fetching stats`);

      try {
        // Get total videos from D1 (excluding deleted/error status)
        const d1Count = await env.BLOSSOM_DB.prepare(`
          SELECT COUNT(*) as total FROM (
            SELECT sha256
            FROM bunny_webhook_events e1
            WHERE sha256 IS NOT NULL
              AND received_at = (
                SELECT MAX(received_at) FROM bunny_webhook_events e2 WHERE e2.sha256 = e1.sha256
              )
              AND status_name NOT IN ('error', 'deleted')
          )
        `).first();
        const totalInD1 = d1Count?.total || 0;

        // Count moderation results in KV (iterate through all keys)
        let totalModerated = 0;
        let safeCount = 0;
        let reviewCount = 0;
        let ageRestrictedCount = 0;
        let permanentBanCount = 0;

        let cursor = undefined;
        do {
          const listResult = await env.MODERATION_KV.list({
            prefix: 'moderation:',
            cursor,
            limit: 1000
          });

          // Count this batch
          for (const key of listResult.keys) {
            totalModerated++;
            // We can't efficiently get the action without reading each value
            // So we'll estimate based on action-specific keys
          }

          cursor = listResult.cursor;
          if (listResult.list_complete) break;
        } while (cursor);

        // Count action-specific keys for accurate breakdown
        const [reviewList, ageRestrictedList, permanentBanList] = await Promise.all([
          env.MODERATION_KV.list({ prefix: 'review:', limit: 1000 }),
          env.MODERATION_KV.list({ prefix: 'age-restricted:', limit: 1000 }),
          env.MODERATION_KV.list({ prefix: 'permanent-ban:', limit: 1000 })
        ]);

        reviewCount = reviewList.keys.length;
        ageRestrictedCount = ageRestrictedList.keys.length;
        permanentBanCount = permanentBanList.keys.length;

        // SAFE = total moderated minus all flagged categories
        const flaggedCount = reviewCount + ageRestrictedCount + permanentBanCount;
        safeCount = Math.max(0, totalModerated - flaggedCount);

        const untriaged = Math.max(0, totalInD1 - totalModerated);

        console.log(`[${requestId}] Stats: total=${totalInD1}, moderated=${totalModerated}, untriaged=${untriaged}, safe=${safeCount}, review=${reviewCount} in ${Date.now() - startTime}ms`);
        return new Response(JSON.stringify({
          totalInD1,
          totalModerated,
          untriaged,
          breakdown: {
            safe: safeCount,
            review: reviewCount,
            ageRestricted: ageRestrictedCount,
            permanentBan: permanentBanCount
          }
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error(`[${requestId}] Failed to get stats:`, error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Get untriaged (unmoderated) videos from D1
    if (url.pathname === '/admin/api/untriaged') {
      const authError = await requireAuth(request, env);
      if (authError) {
        console.log(`[${requestId}] Unauthorized access to /admin/api/untriaged`);
        return authError;
      }

      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);
      console.log(`[${requestId}] Fetching untriaged videos: limit=${limit}, offset=${offset}`);

      try {
        // Get recent finished videos from D1, excluding those with later deleted/error status
        // Uses subquery to get only the LATEST status for each sha256
        const result = await env.BLOSSOM_DB.prepare(`
          SELECT sha256, video_guid, hls_url, mp4_url, thumbnail_url, received_at
          FROM bunny_webhook_events e1
          WHERE sha256 IS NOT NULL
            AND received_at = (
              SELECT MAX(received_at) FROM bunny_webhook_events e2 WHERE e2.sha256 = e1.sha256
            )
            AND status_name NOT IN ('error', 'deleted')
          ORDER BY received_at DESC
          LIMIT ? OFFSET ?
        `).bind(limit, offset).all();

        // Check which ones are already moderated
        const unmoderatedRows = [];
        for (const row of result.results) {
          const existingResult = await env.MODERATION_KV.get(`moderation:${row.sha256}`);
          if (!existingResult) {
            unmoderatedRows.push(row);
          }
        }

        // Fetch Nostr context in parallel for all unmoderated videos
        const nostrPromises = unmoderatedRows.map(async (row) => {
          try {
            const event = await fetchNostrEventBySha256(row.sha256, ['wss://relay.divine.video'], env);
            if (event) {
              const metadata = parseVideoEventMetadata(event);
              return {
                sha256: row.sha256,
                title: metadata?.title || null,
                author: metadata?.author || null,
                client: metadata?.client || null,
                content: metadata?.content || event.content || null,
                pubkey: event.pubkey || null
              };
            }
          } catch (e) {
            console.error(`[ADMIN] Failed to fetch Nostr context for ${row.sha256}:`, e.message);
          }
          return { sha256: row.sha256 };
        });

        const nostrResults = await Promise.all(nostrPromises);
        const nostrMap = new Map(nostrResults.map(r => [r.sha256, r]));

        // Build videos with Nostr context
        const videos = unmoderatedRows.map(row => {
          const nostr = nostrMap.get(row.sha256) || {};
          return {
            sha256: row.sha256,
            videoGuid: row.video_guid,
            hlsUrl: row.hls_url,
            mp4Url: row.mp4_url,
            thumbnailUrl: row.thumbnail_url,
            receivedAt: row.received_at,
            status: 'UNTRIAGED',
            cdnUrl: `https://${env.CDN_DOMAIN}/${row.sha256}.mp4`,
            nostrContext: {
              title: nostr.title,
              author: nostr.author,
              client: nostr.client,
              content: nostr.content,
              pubkey: nostr.pubkey ? nostr.pubkey.substring(0, 16) + '...' : null
            }
          };
        });

        // Get total count of untriaged (same logic - latest status not deleted/error)
        const countResult = await env.BLOSSOM_DB.prepare(`
          SELECT COUNT(*) as total FROM (
            SELECT sha256
            FROM bunny_webhook_events e1
            WHERE sha256 IS NOT NULL
              AND received_at = (
                SELECT MAX(received_at) FROM bunny_webhook_events e2 WHERE e2.sha256 = e1.sha256
              )
              AND status_name NOT IN ('error', 'deleted')
          )
        `).first();

        return new Response(JSON.stringify({
          videos,
          total: countResult?.total || 0,
          offset,
          limit,
          hasMore: offset + limit < (countResult?.total || 0)
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('[ADMIN] Failed to fetch untriaged videos:', error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Queue an untriaged video for moderation
    if (url.pathname === '/admin/api/queue-moderation' && request.method === 'POST') {
      const authError = await requireAuth(request, env);
      if (authError) {
        return authError;
      }

      const { sha256 } = await request.json();
      if (!sha256) {
        return new Response(JSON.stringify({ error: 'sha256 required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Queue for moderation
      await env.MODERATION_QUEUE.send({
        sha256,
        r2Key: `videos/${sha256}.mp4`,
        uploadedAt: Date.now(),
        metadata: { source: 'admin-dashboard' }
      });

      return new Response(JSON.stringify({ success: true, sha256, message: 'Queued for moderation' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Update moderation action (take down, change classification, etc.)
    if (url.pathname.startsWith('/admin/api/moderate/') && request.method === 'POST') {
      const authError = await requireAuth(request, env);
      if (authError) {
        return authError;
      }

      const sha256 = url.pathname.split('/')[4];
      const { action, reason, scores } = await request.json();

      // Validate action
      if (!['SAFE', 'REVIEW', 'AGE_RESTRICTED', 'PERMANENT_BAN'].includes(action)) {
        return new Response(JSON.stringify({ error: 'Invalid action. Must be SAFE, REVIEW, AGE_RESTRICTED, or PERMANENT_BAN' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Get existing moderation result
      const existingData = await env.MODERATION_KV.get(`moderation:${sha256}`);
      if (!existingData) {
        return new Response(JSON.stringify({ error: 'Moderation result not found for this video' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const existing = JSON.parse(existingData);

      // Update moderation result
      const updated = {
        ...existing,
        action,
        reason: reason || `Manual override by moderator`,
        manualOverride: true,
        overriddenBy: 'admin',
        overriddenAt: Date.now(),
        previousAction: existing.action
      };

      // If scores provided, override them
      if (scores) {
        updated.scores = {
          ...existing.scores,
          ...scores
        };
        console.log(`[ADMIN] Score override applied for ${sha256}`);
      }

      // Write updated result
      await env.MODERATION_KV.put(
        `moderation:${sha256}`,
        JSON.stringify(updated),
        {
          expirationTtl: 60 * 60 * 24 * 90 // 90 days
        }
      );

      // Update action-specific keys
      await Promise.all([
        // Clear old keys
        env.MODERATION_KV.delete(`review:${sha256}`),
        env.MODERATION_KV.delete(`age-restricted:${sha256}`),
        env.MODERATION_KV.delete(`permanent-ban:${sha256}`),
        env.MODERATION_KV.delete(`quarantine:${sha256}`)  // Legacy
      ]);

      // Set new key based on action
      if (action === 'REVIEW') {
        await env.MODERATION_KV.put(
          `review:${sha256}`,
          JSON.stringify({
            category: updated.category,
            reason: updated.reason,
            timestamp: Date.now(),
            manualOverride: true
          })
        );
      } else if (action === 'AGE_RESTRICTED') {
        await env.MODERATION_KV.put(
          `age-restricted:${sha256}`,
          JSON.stringify({
            category: updated.category,
            reason: updated.reason,
            timestamp: Date.now(),
            manualOverride: true
          })
        );
      } else if (action === 'PERMANENT_BAN') {
        await env.MODERATION_KV.put(
          `permanent-ban:${sha256}`,
          JSON.stringify({
            category: updated.category,
            reason: updated.reason,
            timestamp: Date.now(),
            manualOverride: true
          })
        );
      }

      console.log(`[ADMIN] Updated ${sha256} from ${existing.action} to ${action}`);

      return new Response(JSON.stringify({
        success: true,
        sha256,
        action,
        previousAction: existing.action,
        message: `Content updated to ${action}`
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Verify/reject individual category detection (for NIP-85 tagging)
    if (url.pathname.startsWith('/admin/api/verify-category/') && request.method === 'POST') {
      const authError = await requireAuth(request, env);
      if (authError) {
        console.log(`[${requestId}] Unauthorized verify-category request`);
        return authError;
      }

      const sha256 = url.pathname.split('/')[4];
      const { category, status } = await request.json();
      console.log(`[${requestId}] Verify category: ${sha256.substring(0, 16)}... ${category} = ${status}`);

      // Validate inputs
      const validCategories = [
        'nudity', 'violence', 'gore', 'offensive', 'weapon', 'self_harm',
        'recreational_drug', 'alcohol', 'tobacco', 'ai_generated', 'deepfake',
        'medical', 'gambling', 'money', 'destruction', 'military',
        'text_profanity', 'qr_unsafe'
      ];

      // Major flags that affect overall content action
      const majorFlags = ['nudity', 'violence', 'gore', 'ai_generated', 'deepfake', 'self_harm'];

      if (!validCategories.includes(category)) {
        return new Response(JSON.stringify({ error: `Invalid category: ${category}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (status !== null && status !== 'confirmed' && status !== 'rejected') {
        return new Response(JSON.stringify({ error: 'Status must be "confirmed", "rejected", or null' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Get existing moderation result
      const existingData = await env.MODERATION_KV.get(`moderation:${sha256}`);
      if (!existingData) {
        return new Response(JSON.stringify({ error: 'Moderation result not found for this video' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const existing = JSON.parse(existingData);
      const previousAction = existing.action;

      // Update category verifications
      if (!existing.categoryVerifications) {
        existing.categoryVerifications = {};
      }

      if (status === null) {
        delete existing.categoryVerifications[category];
      } else {
        existing.categoryVerifications[category] = status;
      }

      // Generate NIP-85 tags based on verifications
      existing.nip85Tags = generateNIP85Tags(existing.scores, existing.categoryVerifications);

      // Track who verified and when
      existing.lastVerifiedAt = Date.now();
      existing.lastVerifiedBy = 'admin';

      // AUTO-APPROVE LOGIC: Check if rejecting a major flag should auto-approve
      let autoApproved = false;
      if (status === 'rejected' && majorFlags.includes(category) && existing.action !== 'SAFE') {
        // Check if there are any remaining unrejected major flags with high scores
        const remainingMajorFlags = majorFlags.filter(flag => {
          const score = existing.scores?.[flag] || 0;
          const verification = existing.categoryVerifications[flag];
          // Flag is still active if: score >= 0.6 AND NOT rejected
          return score >= 0.6 && verification !== 'rejected';
        });

        console.log(`[${requestId}] Remaining major flags after rejecting ${category}:`, remainingMajorFlags);

        if (remainingMajorFlags.length === 0) {
          // No more major flags - auto-approve!
          console.log(`[${requestId}] Auto-approving ${sha256.substring(0, 16)}... - all major flags rejected`);
          existing.action = 'SAFE';
          existing.autoApprovedAt = Date.now();
          existing.autoApprovedReason = `All major flags rejected by human moderator (last: ${category})`;
          autoApproved = true;

          // Clear action-specific keys
          await Promise.all([
            env.MODERATION_KV.delete(`review:${sha256}`),
            env.MODERATION_KV.delete(`age-restricted:${sha256}`),
            env.MODERATION_KV.delete(`permanent-ban:${sha256}`)
          ]);
        }
      }

      // Write updated result
      await env.MODERATION_KV.put(
        `moderation:${sha256}`,
        JSON.stringify(existing),
        {
          expirationTtl: 60 * 60 * 24 * 90 // 90 days
        }
      );

      // PUBLISH NIP-32 LABEL EVENT (if status is confirmed or rejected)
      let labelResult = null;
      if (status === 'confirmed' || status === 'rejected') {
        const score = existing.scores?.[category] || 0;
        labelResult = await publishLabelEvent({
          sha256,
          category,
          status,
          score,
          cdnUrl: existing.cdnUrl
        }, env);
        console.log(`[${requestId}] Label publish result:`, labelResult);
      }

      console.log(`[${requestId}] Category verification complete: ${category} = ${status}, autoApproved=${autoApproved}`);

      return new Response(JSON.stringify({
        success: true,
        sha256,
        category,
        status,
        categoryVerifications: existing.categoryVerifications,
        nip85Tags: existing.nip85Tags,
        autoApproved,
        previousAction: autoApproved ? previousAction : undefined,
        newAction: autoApproved ? 'SAFE' : undefined,
        labelEvent: labelResult
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
        const event = await fetchNostrEventBySha256(sha256, ['wss://relay.divine.video'], env);

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
      const review = await env.MODERATION_KV.get(`review:${sha256}`);
      const ageRestricted = await env.MODERATION_KV.get(`age-restricted:${sha256}`);
      const permanentBan = await env.MODERATION_KV.get(`permanent-ban:${sha256}`);
      // Keep old quarantine key for backward compatibility
      const quarantine = await env.MODERATION_KV.get(`quarantine:${sha256}`);

      return new Response(JSON.stringify({
        sha256,
        moderation: result ? JSON.parse(result) : null,
        review: review ? JSON.parse(review) : null,
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
      // Flag for human review - store in KV for tracking
      console.log(`[MODERATION] ${sha256} flagged for review - writing to KV`);
      await env.MODERATION_KV.put(
        `review:${sha256}`,
        JSON.stringify({
          category: result.category,
          reason,
          scores,
          timestamp: Date.now(),
          severity
        })
      );
      console.log(`[MODERATION] ${sha256} - review flag written`);

      // Also publish to Nostr for notifications
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
