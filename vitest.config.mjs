// ABOUTME: Vitest configuration for testing Cloudflare Workers
// ABOUTME: Uses @cloudflare/vitest-pool-workers for Workers environment simulation

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
});
