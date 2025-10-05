# Changelog

All notable changes to the Divine Moderation Service will be documented in this file.

## [1.0.0] - 2025-10-05

### Added
- **Complete video moderation pipeline** using Sightengine API
  - NSFW content detection (nudity, sexual content)
  - Violence detection (physical violence, weapons, gore)
  - AI-generated content detection
- **Three-tier classification system**
  - SAFE: Content approved for all audiences (scores < 0.6)
  - REVIEW: Borderline content flagged for human review (scores 0.6-0.8)
  - QUARANTINE: Harmful content immediately blocked (scores > 0.8)
- **Cloudflare Workers integration**
  - Queue-based asynchronous processing
  - KV storage for moderation results (90-day retention)
  - R2 bucket access for video retrieval
  - CDN integration with automatic quarantine blocking (HTTP 451)
- **Nostr event publishing** (NIP-56 kind 1984)
  - REVIEW cases flagged to human moderators
  - QUARANTINE cases logged for audit trail
  - Supports relay configuration via env var
- **Comprehensive test suite** (40 tests, 100% passing)
  - Unit tests for all components
  - Integration tests for full pipeline
  - TDD approach throughout development
- **Error handling and retry logic**
  - Automatic retry with exponential backoff (3 attempts)
  - Graceful degradation when Nostr publishing fails
  - Failed moderation logging to KV

### API Endpoints
- `POST /test-moderate` - Manually trigger moderation for a video
- `GET /check-result/{sha256}` - Check moderation result and quarantine status
- `GET /test-kv` - Test KV write capability

### Configuration
- Configurable thresholds for NSFW, violence, and AI-generated content
- CDN domain configuration
- Sightengine API credentials via secrets
- Nostr private key and relay URL via secrets

### Known Issues
- Nostr kind 1984 events currently blocked by relay3.openvine.co
  - Core moderation continues to work
  - Human review notifications temporarily unavailable
  - To be resolved with relay configuration update

### Performance
- Average processing time: ~10 seconds per 6-second video
- Sightengine analyzes 3-4 frames per video
- Queue supports batch processing (up to 10 videos)

### Security
- All moderation results stored in KV with hash-based keys
- Quarantine flags prevent CDN access to harmful content
- No sensitive data logged or exposed

### Deployment
- Deployed to Cloudflare Workers as `divine-moderation-service`
- Queue: `video-moderation-queue`
- KV Namespace: `eee0689974834390acd39d543002cac3`
- R2 Bucket: `nostrvine-media`
- CDN: `cdn.divine.video`
