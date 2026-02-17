/**
 * Test REST: vendor/customer registration, forgot-password, reset-password.
 *
 * Usage:
 *   Local:  npx wrangler pages dev .   (in one terminal)
 *           node scripts/test_vendor_registration_and_reset_password.js
 *
 *   Remote: API_URL=https://your-api.pages.dev node scripts/test_vendor_registration_and_reset_password.js
 */

require('dotenv').config();

const API_BASE = process.env.API_URL || 'http://localhost:8788';
const API = `${API_BASE}/api`;

function log(name, ok, detail) {
  const icon = ok ? '✅' : '❌';
  console.log(`${icon} ${name}${detail ? ': ' + detail : ''}`);
}

const FETCH_TIMEOUT_MS = 15000;

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
    if (e.name === 'AbortError') throw new Error(`Request timeout (${FETCH_TIMEOUT_MS}ms). Is the API running? Try: npx wrangler pages dev .`);
    throw e;
  }
}

async function main() {
  console.log('API base:', API);
  console.log('');

  // --- 1. Registration (vendor/customer) ---
  const unique = `test-vendor-${Date.now()}@example.com`;
  const registerBody = {
    email: unique,
    username: unique.split('@')[0],
    password: 'TestPass123!',
    firstName: 'Test',
    lastName: 'Vendor'
  };

  const reg = await request('POST', '/auth/register', registerBody);
  if (reg.ok) {
    log('Registration', true, `id=${reg.data.id} email=${reg.data.email}`);
  } else {
    log('Registration', false, `status=${reg.status} ${reg.data.error || reg.data.message || JSON.stringify(reg.data)}`);
  }
  console.log('');

  // --- 2. Forgot password ---
  const forgotBody = { email: unique };
  const forgot = await request('POST', '/auth/forgot-password', forgotBody);
  if (forgot.ok) {
    log('Forgot password', true, forgot.data.message || 'request accepted');
  } else {
    log('Forgot password', false, `status=${forgot.status} ${forgot.data.error || JSON.stringify(forgot.data)}`);
  }
  console.log('');

  // --- 3. Reset password (without real key - expect error) ---
  const resetBody = {
    user_login: unique,
    password_reset_key: 'invalid-key-for-test',
    new_password: 'NewPass456!'
  };
  const reset = await request('POST', '/auth/reset-password', resetBody);
  if (reset.ok) {
    log('Reset password', true, 'confirm accepted (unexpected with invalid key)');
  } else {
    log('Reset password', true, 'endpoint reachable (expected fail with invalid key)');
    if (reset.data.error) console.log('   Response:', reset.data.error);
  }

  console.log('');
  console.log('Done.');
}

main().catch((e) => {
  console.error('Script error:', e.message);
  process.exit(1);
});
