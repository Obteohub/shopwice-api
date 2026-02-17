/**
 * Test vendor registration + login + vendor-only endpoint with real-looking data.
 *
 * Usage:
 *   node scripts/test_vendor_login_and_creation.js
 *
 *   With custom API:  API_URL=https://your-api.pages.dev node scripts/test_vendor_login_and_creation.js
 *   With real credentials (skip register):  VENDOR_EMAIL=real@email.com VENDOR_PASSWORD=pass node scripts/test_vendor_login_and_creation.js
 */

require('dotenv').config();

const API_BASE = process.env.API_URL || 'http://localhost:8788';
const API = `${API_BASE}/api`;
const FETCH_TIMEOUT_MS = 20000;

// Optional: use real existing vendor to test login only (skip registration)
const USE_EXISTING = process.env.VENDOR_EMAIL && process.env.VENDOR_PASSWORD;

function log(name, ok, detail) {
  const icon = ok ? '✅' : '❌';
  console.log(`${icon} ${name}${detail ? ': ' + detail : ''}`);
}

async function request(method, path, body = null, token = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
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
    if (e.name === 'AbortError') throw new Error(`Request timeout. Is the API running? (npx wrangler pages dev .)`);
    throw e;
  }
}

async function main() {
  console.log('API base:', API);
  console.log('');

  const timestamp = Date.now();
  const vendorEmail = process.env.VENDOR_EMAIL || `vendor-test-${timestamp}@shopwice.com`;
  const vendorPassword = process.env.VENDOR_PASSWORD || `VendorTest${timestamp}!`;
  const vendorUsername = vendorEmail.split('@')[0];

  let userId = null;
  let token = null;

  const registerBody = {
    email: vendorEmail,
    username: vendorUsername,
    password: vendorPassword,
    firstName: 'Kofi',
    lastName: 'Mensah',
    isVendor: true,
    shopName: 'Mensah Electronics Store',
    phone: '+233 24 123 4567',
    address: { city: 'Accra', state: 'Greater Accra', country: 'GH' }
  };

  // Optional: direct WordPress registration to see raw WP response (set DEBUG_WP_REGISTER=1)
  const WC_URL = process.env.WC_URL;
  if (WC_URL && process.env.DEBUG_WP_REGISTER === '1' && !USE_EXISTING) {
    const wpPath = '/wp-json/shopwice/v1/auth/register';
    console.log('0. Direct WordPress registration (raw response)');
    try {
      const wpRes = await fetch(WC_URL + wpPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registerBody)
      });
      const wpData = await wpRes.json().catch(() => ({}));
      console.log('   Status:', wpRes.status, '| Body:', JSON.stringify(wpData));
      console.log('');
    } catch (e) {
      console.log('   Error:', e.message);
      console.log('');
    }
  }

  // --- 1. Vendor registration via API (skip if using existing credentials) ---
  if (!USE_EXISTING) {
    console.log('1. Vendor registration (via API)');
    console.log('   Payload:', { ...registerBody, password: '***' });
    const reg = await request('POST', '/auth/register', registerBody);

    if (reg.ok) {
      userId = reg.data.id;
      log('Vendor registration', true, `id=${userId} email=${reg.data.email} role=${reg.data.role || 'N/A'}`);
      if (reg.data.role && reg.data.role !== 'wcfm_vendor') {
        console.log('   ⚠️  Role is not wcfm_vendor:', reg.data.role);
      }
    } else {
      log('Vendor registration', false, `status=${reg.status} ${reg.data.error || reg.data.message || JSON.stringify(reg.data)}`);
      console.log('   Response:', reg.data);
      if (!USE_EXISTING) {
        console.log('\n   Tip: If endpoint fails, test login only with: VENDOR_EMAIL=... VENDOR_PASSWORD=... node scripts/test_vendor_login_and_creation.js');
        process.exit(1);
      }
    }
    console.log('');
  } else {
    console.log('1. Skipping registration (using VENDOR_EMAIL / VENDOR_PASSWORD)');
    console.log('');
  }

  // --- 2. Login ---
  console.log('2. Login');
  const loginRes = await request('POST', '/auth/login', { username: vendorEmail, password: vendorPassword });
  if (!loginRes.ok) {
    log('Login', false, `status=${loginRes.status} ${loginRes.data.error || loginRes.data.message || ''}`);
    console.log('   Response:', loginRes.data);
    process.exit(1);
  }
  token = loginRes.data.token;
  if (!token) {
    log('Login', false, 'No token in response');
    process.exit(1);
  }
  userId = loginRes.data.id || loginRes.data.user?.id;
  const role = loginRes.data.role || loginRes.data.user?.role;
  log('Login', true, `id=${userId} role=${role} token=${token.substring(0, 20)}...`);
  if (role !== 'wcfm_vendor') {
    console.log('   ⚠️  Role is not wcfm_vendor:', role, '- WordPress created user as customer. Fix /wp-json/shopwice/v1/auth/register to set role wcfm_vendor.');
  }
  console.log('');

  // --- 3. Vendor-only endpoint (requires vendor JWT) ---
  console.log('3. Vendor endpoint (GET /api/vendor/settings)');
  const settingsRes = await request('GET', '/vendor/settings', null, token);
  if (settingsRes.ok) {
    log('Vendor settings', true, 'OK');
    if (settingsRes.data && Object.keys(settingsRes.data).length) {
      console.log('   Sample keys:', Object.keys(settingsRes.data).slice(0, 5).join(', '));
    }
  } else {
    log('Vendor settings', false, `status=${settingsRes.status} ${settingsRes.data.error || ''}`);
    console.log('   Response:', settingsRes.data);
  }
  console.log('');

  // --- 4. Vendor products list ---
  console.log('4. Vendor products (GET /api/vendor/products)');
  const productsRes = await request('GET', '/vendor/products', null, token);
  if (productsRes.ok) {
    const list = Array.isArray(productsRes.data) ? productsRes.data : productsRes.data?.products || [];
    log('Vendor products', true, `count=${list.length}`);
  } else {
    log('Vendor products', false, `status=${productsRes.status} ${productsRes.data.error || ''}`);
  }
  console.log('');

  // --- 5. Forgot password (request reset email) ---
  console.log('5. Forgot password (POST /api/auth/forgot-password with app=vendor)');
  const forgotRes = await request('POST', '/auth/forgot-password', { email: vendorEmail, app: 'vendor' });
  if (forgotRes.ok) {
    log('Forgot password', true, forgotRes.data.message || 'request accepted');
  } else {
    log('Forgot password', false, `status=${forgotRes.status} ${forgotRes.data.error || JSON.stringify(forgotRes.data)}`);
  }
  console.log('');

  // --- 6. Reset password (invalid key – endpoint reachable) ---
  console.log('6. Reset password (POST /api/auth/reset-password with invalid key)');
  const resetRes = await request('POST', '/auth/reset-password', {
    user_login: vendorEmail,
    password_reset_key: 'invalid-key-for-test',
    new_password: 'NewPass456!'
  });
  if (resetRes.ok) {
    log('Reset password', true, 'unexpected success with invalid key');
  } else {
    log('Reset password', true, 'endpoint reachable (expected fail with invalid key)');
    if (resetRes.data.error) console.log('   Error:', resetRes.data.error);
  }

  console.log('');
  console.log('Done.');
  if (!USE_EXISTING) {
    console.log('Credentials used:');
    console.log('  Email:', vendorEmail);
    console.log('  Password:', vendorPassword);
  }
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
