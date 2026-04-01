# Cloudflare Auto Deploy Design

## Goal

Automatically deploy the moderation worker to Cloudflare when `main` is updated, while preserving the current PR and push quality gates.

## Current State

- GitHub Actions runs `lint` and `test` on pull requests to `main`, pushes to `main`, and manual dispatch.
- Deployment is manual via `npm run deploy`.
- Production deployment uses Wrangler and the checked-in `wrangler.toml`.

## Decision

Add a `deploy` job to the existing CI workflow instead of creating a separate deploy workflow.

## Design

- Keep the `lint` and `test` jobs unchanged.
- Add a `deploy` job that depends on both jobs.
- Run the deploy job only for:
  - `push` events on `main`
  - `workflow_dispatch`
- Use Cloudflare's official Wrangler GitHub Action:
  - `cloudflare/wrangler-action@v3`
- Authenticate with repository secrets:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
- Run `npm ci` in the deploy job before deployment so the worker's package dependencies are present explicitly, rather than depending on action internals.

## Why This Approach

- It keeps the deploy gate aligned with the existing CI checks.
- It avoids duplicating workflow triggers and setup logic across files.
- It uses the official Cloudflare-supported Wrangler path rather than dashboard-only Git integration.
- Manual dispatch remains useful for redeploying the current `main` state without creating an empty commit.

## Non-Goals

- No preview deployments for non-`main` branches.
- No dashboard Git integration setup in this repo.
- No environment split beyond the current production Wrangler configuration.

## Required Repository Secrets

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Verification

- Existing focused Vitest coverage for the restored CORS fix must still pass.
- The workflow file must show a deploy job gated by `lint` and `test`.
