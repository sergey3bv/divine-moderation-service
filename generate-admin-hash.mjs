#!/usr/bin/env node
// ABOUTME: Generate SHA-256 hash for admin dashboard password
// ABOUTME: Usage: node generate-admin-hash.mjs [password]

import crypto from 'crypto';

const password = process.argv[2];

if (!password) {
  console.error('Usage: node generate-admin-hash.mjs <password>');
  console.error('Example: node generate-admin-hash.mjs "mySecurePassword123"');
  process.exit(1);
}

const hash = crypto.createHash('sha256').update(password).digest('hex');

console.log('\n✅ Password hash generated!\n');
console.log('Hash:', hash);
console.log('\nSet it with:');
console.log('  wrangler secret put ADMIN_PASSWORD_HASH');
console.log('\nThen paste the hash above when prompted.');
console.log('\n⚠️  IMPORTANT: Use the HASH, not the plain password!\n');
