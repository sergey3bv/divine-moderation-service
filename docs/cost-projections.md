# divine.video — Cost Projections & Financial Planning

**Date:** 2026-02-27
**Context:** Post-launch planning. 150K day-1 visitors, 1400 news articles, hundreds of millions of organic impressions. Grant-funded via andotherstuff.org (Jack Dorsey). Open source, open protocol (Nostr).

---

## TL;DR

At current architecture (Fastly CDN + GCS origin + aggressive edge caching), divine.video can serve **50K MAU for ~$2K/month** and **500K MAU for ~$20-25K/month**. The two biggest cost lines are **Fastly delivery** and **Hive AI moderation**, both of which have volume pricing levers. Your 6-second video format is a massive structural cost advantage — roughly 1000x cheaper per view than YouTube/TikTok-length content.

---

## Infrastructure Architecture

```
User watches video
    → Fastly CDN edge (aggressive caching, 90-95%+ hit rate)
    → cache miss → GCS origin (media.divine.video)

Creator uploads video
    → Blossom server → GCS
    → Nostr event (kind 34236) → relay.divine.video
    → Relay poller (every 5 min) → moderation queue
    → Hive AI V2 (moderation + AI detection) ← runs in parallel
    → Hive AI V3 VLM (topic classification)  ← runs in parallel
    → VTT transcript analysis (local)        ← runs in parallel
    → Store results → KV + D1
    → Publish NIP-56 reports (if flagged)
```

---

## Cost Per Video: Upload vs View

### Per Upload (one-time moderation cost)

| Service                       | Cost       | Notes                                            |
|-------------------------------|------------|--------------------------------------------------|
| Hive V2 Moderation            | $0.018     | ~6 frames at 1fps for a 6-sec clip              |
| Hive V2 AI/Deepfake           | $0.018     | Skipped for original Vine content (pre-2018)     |
| Hive V3 VLM Classification    | $0.001     | Token-based, very cheap for short video          |
| VTT Topic Extraction          | $0.000     | Local computation, no API                        |
| Cloudflare Workers/KV/D1      | ~$0.0001   | Queue + storage + compute                        |
| GCS Storage                   | ~$0.00004  | ~2MB file at $0.020/GB/month                     |
| **Total per new video upload** | **~$0.037** | **$0.019 for original Vines (skip AI detection)** |

### Per View (Fastly delivery)

| Scenario                      | Cost per view  | Notes                              |
|-------------------------------|----------------|------------------------------------|
| Cache HIT (95% of views)      | ~$0.00016      | ~2MB x $0.08/GB Fastly delivery    |
| Cache MISS (5% of views)      | ~$0.00032      | + GCS egress to Fastly             |
| **Blended per view**          | **~$0.00017**  | Assuming 95% cache hit rate        |

A 6-second clip is ~2MB. A TikTok video is 20-50MB. A YouTube video is 100-500MB.
**Your per-view cost is 10-250x lower than competitors.**

---

## Growth Scenarios

### Scenario 1: Slow Growth (Niche Community)

Building the core community. Vine nostalgia crowd, early Nostr adopters, creators experimenting.

**Traffic projections:**

| Metric                  | Month 1-3  | Month 6    | Month 12   |
|-------------------------|------------|------------|------------|
| Monthly Active Users    | 10K        | 25K        | 50K        |
| Videos uploaded/month   | 2K         | 5K         | 10K        |
| Video views/month       | 500K       | 2M         | 8M         |
| Bandwidth delivered     | 1 TB       | 4 TB       | 16 TB      |

**Cost breakdown:**

| Cost Line Item                    | Month 1-3  | Month 6    | Month 12   |
|-----------------------------------|------------|------------|------------|
| Fastly CDN delivery               | $80        | $320       | $1,280     |
| Moderation (Hive V2)              | $74        | $185       | $370       |
| VLM Classification                | $2         | $5         | $10        |
| GCS origin egress (5% miss)       | $4         | $16        | $64        |
| GCS Storage (cumulative)          | $10        | $40        | $120       |
| Cloudflare (Workers/KV/D1)        | $10        | $15        | $25        |
| Relay hosting                     | $50        | $50        | $100       |
| **Total**                         | **~$230**  | **~$630**  | **~$1,970** |
| Cost per MAU                      | $0.02      | $0.03      | $0.04      |

**Comfortable on a small grant. $24K/year covers this easily.**

---

### Scenario 2: Moderate Growth (Breakout)

Press buzz converts to retention, creator tools improve, word of mouth kicks in.

**Traffic projections:**

| Metric                  | Month 1-3  | Month 6    | Month 12   |
|-------------------------|------------|------------|------------|
| Monthly Active Users    | 50K        | 200K       | 500K       |
| Videos uploaded/month   | 10K        | 50K        | 150K       |
| Video views/month       | 5M         | 40M        | 200M       |
| Bandwidth delivered     | 10 TB      | 80 TB      | 400 TB     |

**Cost breakdown (list pricing):**

| Cost Line Item                    | Month 1-3   | Month 6     | Month 12    |
|-----------------------------------|-------------|-------------|-------------|
| Fastly CDN delivery               | $800        | $6,400      | $32,000     |
| Moderation (Hive V2)              | $370        | $1,850      | $5,550      |
| VLM Classification                | $10         | $50         | $150        |
| GCS origin egress (5% miss)       | $40         | $320        | $1,600      |
| GCS Storage (cumulative)          | $20         | $200        | $1,000      |
| Cloudflare (Workers/KV/D1)        | $25         | $100        | $300        |
| Relay hosting                     | $100        | $200        | $500        |
| **Total**                         | **~$1,365** | **~$9,120** | **~$41,100** |
| Cost per MAU                      | $0.03       | $0.05       | $0.08       |

**At this level, negotiate Fastly volume pricing and Hive enterprise rates.**

---

### Scenario 2b: Moderate Growth with Volume Deals

Fastly at $0.04/GB (committed use), Hive at 40% discount.

| Cost Line Item                    | Month 1-3  | Month 6     | Month 12    |
|-----------------------------------|------------|-------------|-------------|
| Fastly CDN (negotiated)           | $400       | $3,200      | $16,000     |
| Moderation (Hive, 40% off)        | $222       | $1,110      | $3,330      |
| VLM Classification                | $10        | $50         | $150        |
| GCS origin egress (5% miss)       | $40        | $320        | $1,600      |
| GCS Storage                       | $20        | $200        | $1,000      |
| Cloudflare                        | $25        | $100        | $300        |
| Relay hosting                     | $100       | $200        | $500        |
| **Total**                         | **~$817**  | **~$5,180** | **~$22,880** |
| Cost per MAU                      | $0.02      | $0.03       | $0.05       |
| **Savings vs list price**         | **40%**    | **43%**     | **44%**     |

---

### Scenario 3: Viral Growth (Next Vine)

Lightning in a bottle. Cultural moment, celebrity adoption, mainstream press cycle.

**Traffic projections:**

| Metric                  | Month 1-3   | Month 6     | Month 12    |
|-------------------------|-------------|-------------|-------------|
| Monthly Active Users    | 200K        | 2M          | 10M         |
| Videos uploaded/month   | 50K         | 500K        | 2M          |
| Video views/month       | 50M         | 1B          | 10B         |
| Bandwidth delivered     | 100 TB      | 2 PB        | 20 PB       |

**Cost breakdown (list pricing):**

| Cost Line Item                    | Month 1-3    | Month 6       | Month 12       |
|-----------------------------------|--------------|---------------|----------------|
| Fastly CDN delivery               | $8,000       | $160,000      | $1,600,000     |
| Moderation (Hive V2)              | $1,850       | $18,500       | $74,000        |
| Everything else                   | $1,000       | $16,500       | $105,000       |
| **Total (list price)**            | **~$10,850** | **~$195,000** | **~$1,779,000** |

**Cost breakdown (negotiated deals):**

| Cost Line Item                    | Month 1-3   | Month 6      | Month 12     |
|-----------------------------------|-------------|--------------|--------------|
| Fastly (committed)                | $4,000      | $60,000      | $400,000     |
| Moderation (enterprise)           | $925        | $9,250       | $37,000      |
| Everything else                   | $800        | $12,000      | $80,000      |
| **Total (negotiated)**            | **~$5,725** | **~$81,250** | **~$517,000** |
| Cost per MAU                      | $0.03       | $0.04        | $0.05        |

At 20 PB/month with Fastly, this becomes a strategic partnership conversation, not just a pricing negotiation. You'd be one of their notable customers. Startup credits, co-marketing, custom pricing — all on the table.

---

## Cost Breakdown by Category

At moderate growth, month 12 (500K MAU, list pricing):

```
Fastly CDN delivery    ████████████████████████████████  78%  ($32,000)
Hive AI moderation     █████                            14%  ($5,700)
GCS origin egress      ██                                4%  ($1,600)
GCS storage            █                                 2%  ($1,000)
Relay hosting          █                                 1%  ($500)
Cloudflare + VLM       ░                                <1%  ($450)
```

At moderate growth, month 12 (500K MAU, negotiated deals):

```
Fastly CDN delivery    ████████████████████████████████  70%  ($16,000)
Hive AI moderation     ██████                           15%  ($3,480)
GCS origin egress      ███                               7%  ($1,600)
GCS storage            ██                                4%  ($1,000)
Relay hosting          █                                 2%  ($500)
Cloudflare + VLM       ░                                 2%  ($450)
```

**Two costs dominate: Fastly and Hive. Both have volume pricing levers.**

---

## Bandwidth: Why Fastly + Aggressive Caching Works

### Your caching advantage

Videos on divine.video are **content-addressed** (filename = SHA256 hash). They are literally immutable. With proper `Cache-Control: public, max-age=31536000, immutable` headers:

- Fastly caches each video at the edge **permanently** (or until evicted)
- Cache hit rate should be **95%+** for popular content, **90%+** overall
- Origin fetches only happen once per PoP per video
- GCS egress is only 5-10% of total views

### Origin cost optimization: R2 as GCS backup

Keep GCS as primary (Blossom integration stays as-is), add R2 as a backup copy. If you ever want to reduce GCS egress further, point Fastly origin at R2 (zero egress). Dual-store is cheap — $0.035/GB/month total for both copies, and the 2MB Vine files mean total storage is measured in hundreds of GB, not TB.

| Configuration               | GCS only   | GCS + R2 dual-store          |
|-----------------------------|------------|------------------------------|
| Storage (1TB cumulative)    | $20/mo     | $35/mo                       |
| Origin egress (5% miss, 200M views) | $1,600/mo  | $0/mo (if R2 origin) |
| Net savings                 | —          | $1,585/mo                    |

Not a huge savings because caching already handles most of it, but it's a free option to have in your pocket if GCS egress becomes meaningful.

---

## Moderation Cost Optimization

### Current: $0.037/video (all three Hive calls)

### Already implemented

- **Skip AI detection for original Vines** — pre-2018 content predates AI generation. Saves $0.018/video for archive backfill (~500K Vine videos = ~$9,000 saved).

### Future optimizations

1. **Hive volume pricing** — At 100K+ videos/month, negotiate enterprise rates. Expect 30-50% discount.

2. **VLM pre-filter** — VLM costs $0.001/video. If it can identify obviously-safe content, skip the $0.036 full Hive moderation for clearly safe videos. At 80% safe rate with 150K uploads: saves ~$4,300/month.

3. **Batch backfill rates** — For processing the Vine archive, negotiate a bulk rate with Hive for off-peak processing.

4. **Self-hosted models** (long-term) — At 1M+ videos/month ($37K/month in Hive costs), running your own fine-tuned safety classifier could cut moderation costs by 80-90%.

---

## Grant Budget Planning

For andotherstuff.org grant proposals:

### Conservative ask (covers slow + early moderate growth)

| Item                            | Year 1     | Notes                        |
|---------------------------------|------------|------------------------------|
| Fastly CDN                      | $30,000    | Covers up to ~375 TB         |
| Hive AI moderation              | $15,000    | Covers up to ~400K videos    |
| GCS (storage + egress)          | $10,000    | Growing archive              |
| Cloudflare (Workers/KV/D1)      | $2,000     | Moderation service infra     |
| Relay hosting                   | $3,000     | Nostr relay infrastructure   |
| Domain + misc                   | $500       |                              |
| **Total**                       | **$60,500** |                             |
| **Covers up to**                | **~200K MAU** |                           |

### Moderate ask (covers breakout growth)

| Item                            | Year 1      | Notes                       |
|---------------------------------|-------------|-----------------------------|
| Fastly CDN (volume deal)        | $100,000    | Covers up to ~2.5 PB        |
| Hive AI moderation (enterprise) | $40,000     | Covers up to ~1.5M videos   |
| GCS (storage + egress)          | $20,000     |                             |
| Cloudflare                      | $5,000      |                             |
| Relay hosting                   | $6,000      |                             |
| **Total**                       | **$171,000** |                            |
| **Covers up to**                | **~500K MAU** |                           |

### Aggressive ask (covers viral scenario Year 1)

| Item                            | Year 1      | Notes                       |
|---------------------------------|-------------|-----------------------------|
| Fastly CDN (strategic deal)     | $500,000    | Petabyte-scale delivery      |
| Hive AI moderation (enterprise) | $150,000    | Millions of videos           |
| GCS + infrastructure            | $100,000    |                             |
| **Total**                       | **$750,000** |                            |
| **Covers up to**                | **~5M MAU** |                             |

---

## Structural Cost Advantages

divine.video has unusually low unit economics for a video social platform:

1. **6-second clips are ~2MB** — vs 50MB for TikTok, 200MB+ for YouTube. Per-view bandwidth cost is 25-100x lower.

2. **Content-addressed storage (SHA256)** — Natural deduplication. No wasted storage on re-uploads.

3. **Aggressive Fastly edge caching on immutable content** — 95%+ cache hit rate means origin costs are a rounding error.

4. **Moderation scales with uploads, not views** — A video watched 1M times costs the same to moderate as one watched once. Your biggest variable cost (Hive AI) is bounded by creator activity, not audience size.

5. **Nostr protocol = no centralized user DB** — Authentication, social graph, and messaging are decentralized. No database scaling costs for user growth.

6. **Cloudflare Workers = serverless** — No servers to manage or overprovision. Scales to zero when idle, scales up instantly under load.

### Per-MAU cost comparison (rough)

| Platform                              | Est. cost per MAU/month | Notes                                       |
|---------------------------------------|-------------------------|---------------------------------------------|
| YouTube                               | $1-3                    | Long-form video, massive transcoding        |
| TikTok                                | $0.20-0.50              | Short-form but larger files, extensive ML   |
| Instagram Reels                       | $0.10-0.30              | Meta's infrastructure                       |
| **divine.video (moderate growth)**    | **$0.05-0.08**          | **6-sec clips, Fastly caching, grant-funded** |
| **divine.video (with volume deals)**  | **$0.03-0.05**          | **Negotiated Fastly + Hive rates**          |

Your cost structure is 3-60x more efficient per user than comparable platforms. This is the right story for grant funding — capital efficiency means grant dollars go further, and the project can sustain itself at much lower scale than VC-funded competitors.
