// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// ABOUTME: Admin authentication middleware for moderation dashboard
// ABOUTME: Provides password-based login with session token management

import crypto from 'crypto';

/**
 * Generate a secure session token
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash password with SHA-256 for comparison
 */
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify password against configured hash
 */
export async function verifyPassword(password, env) {
  const hashedInput = await hashPassword(password);
  const storedHash = env.ADMIN_PASSWORD_HASH;

  if (!storedHash) {
    console.error('[AUTH] ADMIN_PASSWORD_HASH not configured');
    return false;
  }

  return hashedInput === storedHash;
}

/**
 * Create a session token and store in KV
 * @returns {string} Session token
 */
export async function createSession(env) {
  const token = generateToken();
  const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours

  await env.MODERATION_KV.put(
    `session:${token}`,
    JSON.stringify({
      createdAt: Date.now(),
      expiresAt
    }),
    {
      expirationTtl: 60 * 60 * 24 // 24 hours
    }
  );

  return token;
}

/**
 * Verify a session token
 */
export async function verifySession(token, env) {
  if (!token) {
    return false;
  }

  const sessionData = await env.MODERATION_KV.get(`session:${token}`);

  if (!sessionData) {
    return false;
  }

  const session = JSON.parse(sessionData);

  if (session.expiresAt < Date.now()) {
    // Session expired
    await env.MODERATION_KV.delete(`session:${token}`);
    return false;
  }

  return true;
}

/**
 * Delete a session (logout)
 */
export async function deleteSession(token, env) {
  if (token) {
    await env.MODERATION_KV.delete(`session:${token}`);
  }
}

/**
 * Extract token from cookie header
 */
export function getTokenFromCookie(cookieHeader) {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(';').map(c => c.trim());
  const adminCookie = cookies.find(c => c.startsWith('admin_token='));

  if (!adminCookie) {
    return null;
  }

  return adminCookie.split('=')[1];
}

/**
 * Middleware to check authentication
 * Returns null if authenticated, Response if not authenticated
 */
export async function requireAuth(request, env) {
  const cookieHeader = request.headers.get('Cookie');
  const token = getTokenFromCookie(cookieHeader);

  const isValid = await verifySession(token, env);

  if (!isValid) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return null; // Authenticated
}
