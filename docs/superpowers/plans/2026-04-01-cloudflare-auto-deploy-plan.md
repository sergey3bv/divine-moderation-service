# Cloudflare Auto Deploy Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic Cloudflare deployment for pushes to `main` and manual workflow dispatch, and commit the already-restored CORS fix with its regression coverage.

**Architecture:** Extend the existing CI workflow with a deploy job that runs after lint and test, using the official Wrangler GitHub Action with repository secrets for auth. Keep the existing CORS fix as a separate code change in the same commit because it is already restored in the working tree and already has direct tests.

**Tech Stack:** GitHub Actions, Wrangler, Vitest

---

## Chunk 1: Workflow

### Task 1: Add deploy automation to CI

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Keep lint and test behavior intact**

Ensure pull requests still run validation without deploying.

- [ ] **Step 2: Add a gated deploy job**

Requirements:
- `needs: [lint, test]`
- runs only for `push` and `workflow_dispatch`
- authenticates with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
- deploys with Wrangler

## Chunk 2: Restored CORS Fix

### Task 2: Keep the restored public CORS fix in the same commit

**Files:**
- Modify: `src/index.mjs`
- Modify: `src/index.test.mjs`

- [ ] **Step 1: Preserve the restored CORS response wrapping for `/check-result/*`**

- [ ] **Step 2: Preserve the regression assertions for known and unknown public status responses**

## Chunk 3: Verification

### Task 3: Verify the repo state before committing

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `src/index.mjs`
- Modify: `src/index.test.mjs`

- [ ] **Step 1: Run focused webhook tests**

Run: `npx vitest run /Users/rabble/code/divine/divine-moderation-service/src/atproto/label-webhook.test.mjs`
Expected: pass

- [ ] **Step 2: Run focused CORS regression tests**

Run: `npx vitest run /Users/rabble/code/divine/divine-moderation-service/src/index.test.mjs -t "(serves public moderation status on moderation-api host|returns CORS headers for unknown public moderation status on moderation-api host)"`
Expected: pass

- [ ] **Step 3: Review the final diff**

Run: `git diff -- .github/workflows/ci.yml src/index.mjs src/index.test.mjs docs/superpowers/specs/2026-04-01-cloudflare-auto-deploy-design.md docs/superpowers/plans/2026-04-01-cloudflare-auto-deploy-plan.md`
Expected: deploy job plus restored CORS diff only
