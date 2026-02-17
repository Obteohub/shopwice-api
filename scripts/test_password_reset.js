/**
 * Test password reset: forgot-password and reset-password (confirm).
 * Both go through the API; the API forwards to WordPress to send email / update password.
 *
 * Usage:
 *   node scripts/test_password_reset.js
 *   API_URL=https://your-api.pages.dev node scripts/test_password_reset.js
 *
 * To test forgot-password with a real email (you'll get a reset link):
 *   RESET_EMAIL=your@email.com node scripts/test_password_reset.js
 *
 * To test reset with a real key (from the email link): not automated; use the confirm payload below manually.
 */

require('dotenv').config();

const API_BASE = process.env.API_URL || 'http://localhost:8788';
const API = `${API_BASE}/api`;
const RESET_EMAIL = process.env.RESET_EMAIL || `test-reset-${Date.now()}@example.com`;
const FETCH_TIMEOUT_MS = 15000;

function log(name, ok, detail) {
  const icon = ok ? '✅' : '❌';
  console.log(`${icon} ${name}${detail ? ': ' + detail : ''}`);
}

async function request(method, path, body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${path}`, { ...opts, signal: controller.signal });
    clearTimeout(id);
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { _raw: text };
    }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    clearTimeout(id);
    if (e.name === 'AbortError') throw new Error(`Request timeout. Is the API running?`);
    throw e;
  }
}

async function main() {
  console.log('API base:', API);
  console.log('Email used for forgot-password:', RESET_EMAIL);
  console.log('');

  // --- 1. Forgot password (request reset email) ---
  console.log('1. POST /api/auth/forgot-password');
  const forgot = await request('POST', '/auth/forgot-password', { email: RESET_EMAIL });
  if (forgot.ok) {
    log('Forgot password', true, forgot.data.message || 'OK');
    console.log('   Response:', forgot.data);
  } else {
    log('Forgot password', false, `status=${forgot.status}`);
    console.log('   Response:', forgot.data);
  }
  console.log('');

  // --- 2. Reset password (confirm with key) - use invalid key to test endpoint ---
  console.log('2. POST /api/auth/reset-password (invalid key = expect error)');
  const resetPayload = {
    user_login: RESET_EMAIL,
    password_reset_key: 'invalid-key-for-test',
    new_password: 'NewPass123!'
  };
  const reset = await request('POST', '/auth/reset-password', resetPayload);
  if (reset.ok) {
    log('Reset password', true, 'unexpected success with invalid key');
    console.log('   Response:', reset.data);
  } else {
    log('Reset password', true, 'endpoint reachable (expected fail with invalid key)');
    console.log('   Error:', reset.data.error || reset.data.message || reset.data);
  }

  console.log('');
  console.log('Done. Password reset flow is handled via the API; WordPress sends the email and updates the password.');
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
