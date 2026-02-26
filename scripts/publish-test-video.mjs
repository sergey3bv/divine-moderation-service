// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// ABOUTME: Test script to publish video files to a Nostr relay as kind 34236 events
// ABOUTME: Uploads via Blossom (BUD-02), optionally adds NIP-36 content-warning tag

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay';
import { npubEncode, nsecEncode, decode as nip19Decode } from 'nostr-tools/nip19';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

useWebSocketImplementation(WebSocket);

const NSEC_FILE = '.test-nsec';
const DEFAULT_RELAY = 'wss://relay.staging.divine.video';
const DEFAULT_BLOSSOM = 'https://media.divine.video';

// --- Key Management ---

function loadOrCreateKey() {
  if (fs.existsSync(NSEC_FILE)) {
    const nsec = fs.readFileSync(NSEC_FILE, 'utf8').trim();
    const { type, data } = nip19Decode(nsec);
    if (type !== 'nsec') throw new Error(`Expected nsec in ${NSEC_FILE}, got ${type}`);
    const sk = data;
    const pk = getPublicKey(sk);
    console.log(`[KEY] Loaded existing key from ${NSEC_FILE}`);
    console.log(`[KEY] npub: ${npubEncode(pk)}`);
    return sk;
  }

  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  fs.writeFileSync(NSEC_FILE, nsecEncode(sk) + '\n');
  console.log(`[KEY] Generated new keypair, saved to ${NSEC_FILE}`);
  console.log(`[KEY] npub: ${npubEncode(pk)}`);
  return sk;
}

// --- SHA256 ---

function hashFile(filePath) {
  const data = fs.readFileSync(filePath);
  return bytesToHex(sha256(data));
}

// --- Thumbnail Extraction ---

function extractThumbnail(videoPath) {
  const tmpPath = path.join(os.tmpdir(), `thumb-${Date.now()}.jpg`);
  execSync(
    `ffmpeg -y -i "${videoPath}" -ss 00:00:01 -vframes 1 -q:v 2 "${tmpPath}" 2>/dev/null`,
    { stdio: 'pipe' }
  );
  if (!fs.existsSync(tmpPath)) {
    // Fallback: try frame 0 for very short videos
    execSync(
      `ffmpeg -y -i "${videoPath}" -vframes 1 -q:v 2 "${tmpPath}" 2>/dev/null`,
      { stdio: 'pipe' }
    );
  }
  return tmpPath;
}

function getVideoDimensions(videoPath) {
  try {
    const out = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${videoPath}" 2>/dev/null`,
      { encoding: 'utf8' }
    ).trim();
    return out; // e.g. "1080x1920"
  } catch {
    return null;
  }
}

function getVideoDuration(videoPath) {
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}" 2>/dev/null`,
      { encoding: 'utf8' }
    ).trim();
    return Math.round(parseFloat(out));
  } catch {
    return null;
  }
}

// --- Blossom Upload (BUD-02) ---

async function uploadToBlossom(filePath, sha256hex, sk, blossomUrl) {
  const expiration = Math.floor(Date.now() / 1000) + 300;

  // Create kind 24242 authorization event
  const authEvent = finalizeEvent({
    kind: 24242,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['t', 'upload'],
      ['x', sha256hex],
      ['expiration', String(expiration)],
    ],
    content: '',
  }, sk);

  const authBase64 = btoa(JSON.stringify(authEvent));
  const fileData = fs.readFileSync(filePath);

  console.log(`[BLOSSOM] Uploading ${fileData.length} bytes to ${blossomUrl}/upload`);

  const res = await fetch(`${blossomUrl}/upload`, {
    method: 'PUT',
    headers: {
      'Authorization': `Nostr ${authBase64}`,
      'Content-Type': 'application/octet-stream',
    },
    body: fileData,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Blossom upload failed (${res.status}): ${body}`);
  }

  const result = await res.json();
  console.log(`[BLOSSOM] Upload successful: ${result.url || `${blossomUrl}/${sha256hex}`}`);
  return result;
}

// --- Build kind 34236 event ---

function buildVideoEvent(sha256hex, filePath, blossomUrl, contentWarning, thumbHash, metadata) {
  const filename = path.basename(filePath, path.extname(filePath));
  const title = filename.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const videoUrl = `${blossomUrl}/${sha256hex}`;
  const thumbUrl = `${blossomUrl}/${thumbHash}`;

  const imetaParts = [
    `url ${videoUrl}`,
    'm video/mp4',
    `image ${thumbUrl}`,
    `x ${sha256hex}`,
  ];
  if (metadata.dim) imetaParts.push(`dim ${metadata.dim}`);
  if (metadata.size) imetaParts.push(`size ${metadata.size}`);

  const tags = [
    ['d', sha256hex],
    ['imeta', ...imetaParts],
    ['title', title],
    ['alt', title],
  ];

  if (metadata.duration) tags.push(['duration', String(metadata.duration)]);
  if (contentWarning) tags.push(['content-warning', contentWarning]);

  return {
    kind: 34236,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  };
}

// --- Publish to relay ---

async function publishToRelay(event, relayUrl) {
  console.log(`[RELAY] Connecting to ${relayUrl}...`);
  const relay = await Relay.connect(relayUrl);
  console.log(`[RELAY] Connected`);

  try {
    await relay.publish(event);
    console.log(`[RELAY] Published successfully`);
  } finally {
    relay.close();
  }
}

// --- CLI ---

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    relay: DEFAULT_RELAY,
    blossom: DEFAULT_BLOSSOM,
    contentWarning: null,
    filePath: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--relay':
        opts.relay = args[++i];
        break;
      case '--blossom':
        opts.blossom = args[++i];
        break;
      case '--content-warning':
        opts.contentWarning = args[++i];
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
      default:
        if (args[i].startsWith('-')) {
          console.error(`Unknown option: ${args[i]}`);
          process.exit(1);
        }
        opts.filePath = args[i];
    }
  }

  return opts;
}

function printUsage() {
  console.log(`
Usage: node scripts/publish-test-video.mjs [OPTIONS] <video-file>

Publish a video file to a Nostr relay as a kind 34236 event via Blossom upload.

Options:
  --content-warning <reason>  Add NIP-36 content-warning tag (e.g. "nudity")
  --relay <url>               Relay URL (default: ${DEFAULT_RELAY})
  --blossom <url>             Blossom server URL (default: ${DEFAULT_BLOSSOM})
  --help, -h                  Show this help message

Examples:
  # Basic upload — no content warning
  node scripts/publish-test-video.mjs example_porn_videos/Xvideos_naked_twerk_on_vine_SD.mp4

  # With NIP-36 content warning
  node scripts/publish-test-video.mjs --content-warning "nudity" example_porn_videos/video_360p.mp4

  # Custom relay and blossom server
  node scripts/publish-test-video.mjs --relay wss://relay.staging.divine.video --blossom https://media.divine.video example_porn_videos/video_360p.mp4
`);
}

async function main() {
  const opts = parseArgs(process.argv);

  if (!opts.filePath) {
    console.error('Error: No video file specified\n');
    printUsage();
    process.exit(1);
  }

  if (!fs.existsSync(opts.filePath)) {
    console.error(`Error: File not found: ${opts.filePath}`);
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Publish Test Video to Nostr Relay');
  console.log('='.repeat(60));
  console.log(`  File:            ${opts.filePath}`);
  console.log(`  Relay:           ${opts.relay}`);
  console.log(`  Blossom:         ${opts.blossom}`);
  console.log(`  Content warning: ${opts.contentWarning || '(none)'}`);
  console.log('='.repeat(60));
  console.log('');

  // Step 1: Load or generate key
  const sk = loadOrCreateKey();
  console.log('');

  // Step 2: Hash file
  console.log(`[HASH] Computing SHA256 of ${opts.filePath}...`);
  const sha256hex = hashFile(opts.filePath);
  console.log(`[HASH] SHA256: ${sha256hex}`);
  console.log('');

  // Step 3: Extract thumbnail
  console.log('[THUMB] Extracting thumbnail with ffmpeg...');
  const thumbPath = extractThumbnail(opts.filePath);
  const thumbHash = hashFile(thumbPath);
  console.log(`[THUMB] Thumbnail SHA256: ${thumbHash}`);
  console.log('');

  // Step 4: Get video metadata
  const dim = getVideoDimensions(opts.filePath);
  const duration = getVideoDuration(opts.filePath);
  const size = fs.statSync(opts.filePath).size;
  console.log(`[META] Dimensions: ${dim || 'unknown'}, Duration: ${duration || 'unknown'}s, Size: ${size} bytes`);
  console.log('');

  // Step 5: Upload video and thumbnail to Blossom
  await uploadToBlossom(opts.filePath, sha256hex, sk, opts.blossom);
  await uploadToBlossom(thumbPath, thumbHash, sk, opts.blossom);
  fs.unlinkSync(thumbPath);
  console.log('');

  // Step 6: Build and sign kind 34236 event
  console.log('[EVENT] Building kind 34236 event...');
  const unsigned = buildVideoEvent(sha256hex, opts.filePath, opts.blossom, opts.contentWarning, thumbHash, { dim, duration, size });
  const event = finalizeEvent(unsigned, sk);
  console.log(`[EVENT] Event ID: ${event.id}`);
  console.log(`[EVENT] Kind: ${event.kind}`);
  console.log(`[EVENT] Tags: ${JSON.stringify(event.tags)}`);
  console.log('');

  // Step 7: Publish to relay
  await publishToRelay(event, opts.relay);

  console.log('');
  console.log('='.repeat(60));
  console.log('Done!');
  console.log(`  Event ID: ${event.id}`);
  console.log(`  npub:     ${npubEncode(getPublicKey(sk))}`);
  console.log(`  Video:    ${opts.blossom}/${sha256hex}`);
  if (opts.contentWarning) {
    console.log(`  Warning:  ${opts.contentWarning}`);
  }
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
