# Registration and Login in Your App

Use your **Shopwice API** base URL (e.g. `https://your-api.pages.dev` or `http://localhost:8788`). All auth endpoints live under `/api`.

You have **3 apps**: (1) **Vendor PWA** (React), (2) **Headless storefront**, (3) **Android/iOS mobile**. Registration and login are the same for all; **forgot-password** should send an `app` value so the reset link in the email opens the correct app (see §4).

---

## 1. Registration

**Endpoint:** `POST /api/auth/register`

### Customer registration

```json
{
  "email": "customer@example.com",
  "username": "customer1",
  "password": "YourSecurePass123",
  "firstName": "Jane",
  "lastName": "Doe"
}
```

- **Success:** `201` → `{ "id", "email", "username", "role": "customer", "message": "Registration successful" }`
- **Error:** `400` → `{ "error": "..." }` (e.g. email already registered)

### Vendor registration

Send the same fields plus **`isVendor: true`** (and optional vendor fields):

```json
{
  "email": "vendor@example.com",
  "username": "vendor1",
  "password": "YourSecurePass123",
  "firstName": "Kofi",
  "lastName": "Mensah",
  "isVendor": true,
  "shopName": "My Store Name",
  "phone": "+233 24 123 4567",
  "address": { "city": "Accra", "state": "Greater Accra", "country": "GH" }
}
```

- **Success:** `201` → `{ "id", "email", "username", "role": "wcfm_vendor", "message": "Vendor registration successful" }`
- **Error:** `400` → `{ "error": "..." }`

### Example (fetch)

```javascript
const API_BASE = 'https://your-api.pages.dev'; // or env

async function register(isVendor, data) {
  const body = {
    email: data.email,
    username: data.username || data.email,
    password: data.password,
    firstName: data.firstName,
    lastName: data.lastName,
  };
  if (isVendor) {
    body.isVendor = true;
    body.shopName = data.shopName;
    body.phone = data.phone;
    body.address = data.address;
  }

  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Registration failed');
  return json; // { id, email, username, role, message }
}
```

---

## 2. Login

**Endpoint:** `POST /api/auth/login`

**Body:**

```json
{
  "username": "vendor@example.com",
  "password": "YourSecurePass123"
}
```

- `username` can be email or WordPress username.

**Success (`200`):**

```json
{
  "token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "id": 16907,
  "user_email": "vendor@example.com",
  "user_nicename": "vendor1",
  "user_display_name": "My Store Name",
  "roles": ["wcfm_vendor"],
  "role": "wcfm_vendor",
  "user": {
    "id": 16907,
    "username": "vendor1",
    "email": "vendor@example.com",
    "role": "wcfm_vendor",
    "firstName": "Kofi",
    "lastName": "Mensah"
  }
}
```

**Error:** `401` → `{ "error": "..." }`

### Example (fetch)

```javascript
async function login(emailOrUsername, password) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: emailOrUsername, password }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Login failed');
  return json; // { token, id, role, user, ... }
}
```

### Login in React

The API expects **`username`** and **`password`** in the body (not `email`). `username` can be the user’s email or WordPress username.

**1. Environment**

Set your API base URL (no trailing slash), e.g. in `.env`:

```env
VITE_API_URL=https://api.shopwice.com
# or for Create React App:
# REACT_APP_API_URL=https://api.shopwice.com
```

**2. Login request**

```javascript
const API_BASE = import.meta.env?.VITE_API_URL ?? process.env.REACT_APP_API_URL ?? '';

async function login(username, password) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  const data = await res.json();

  if (!res.ok) {
    // 401 or other error
    throw new Error(data.error || data.message || 'Login failed');
  }

  if (!data.token) {
    throw new Error('No token in response');
  }

  return data; // { token, id, role, user, user_email, ... }
}
```

**3. Use in a React component (e.g. login form)**

```jsx
import { useState } from 'react';

const API_BASE = import.meta.env?.VITE_API_URL ?? process.env.REACT_APP_API_URL ?? '';

export default function LoginForm({ onSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || data.message || 'Login failed');
        return;
      }
      if (!data.token) {
        setError('No token received');
        return;
      }

      // Store token and user (e.g. in state, context, or localStorage)
      localStorage.setItem('token', data.token);
      if (data.user) {
        localStorage.setItem('user', JSON.stringify(data.user));
      }
      onSuccess?.(data);
    } catch (err) {
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <input
        type="text"
        placeholder="Email or username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <button type="submit" disabled={loading}>
        {loading ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  );
}
```

**4. Authenticated requests after login**

Send the token in the `Authorization` header:

```javascript
const token = localStorage.getItem('token');
const res = await fetch(`${API_BASE}/api/vendor/products`, {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
});
```

**Common reasons login “fails” in React:**

- **Wrong body key:** The API expects `username` and `password`, not `email`. Use `body: JSON.stringify({ username: emailOrUsername, password })`.
- **Wrong URL:** Must be `POST ${API_BASE}/api/auth/login` with no trailing slash on `API_BASE` (e.g. `https://api.shopwice.com` not `https://api.shopwice.com/`).
- **CORS:** The API sends `Access-Control-Allow-Origin: *`; if you still get CORS errors, the request may be going to the wrong origin or the server may be down.
- **Reading the response:** Always `await res.json()` and check `res.ok`; on 401 the body is `{ error: "..." }`.
- **Network:** Check the browser Network tab: status code, request payload, and response body.

---

## 3. Using the token (authenticated requests)

After login, send the JWT on every request that requires auth (e.g. vendor dashboard, cart, checkout):

```javascript
const token = loginResponse.token;

// Example: get vendor products
const res = await fetch(`${API_BASE}/api/vendor/products`, {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
});
```

- **Vendor endpoints:** `/api/vendor/products`, `/api/vendor/orders`, `/api/vendor/settings`, etc. all need `Authorization: Bearer <token>`.
- **GraphQL:** send the same header when calling your GraphQL endpoint if it uses this JWT for auth.

---

## 4. Password reset (via API only)

The whole flow goes through your API. You have **3 apps**; the reset link in the email must point to the **same app** where the user requested the reset (Vendor PWA, headless storefront, or mobile). The API and WordPress plugin support this. You can use either **REST** or **GraphQL**; both use the same backend and app URLs.

### Step 1: Request reset email (REST)

**Endpoint:** `POST /api/auth/forgot-password`

**Body:**

```json
{
  "email": "user@example.com",
  "app": "vendor"
}
```

- **`app`** (optional): `"vendor"` | `"storefront"` | `"mobile"`. Tells the backend which app URL to put in the reset link.
  - **Vendor PWA** (React) → send `"app": "vendor"`.
  - **Headless / storefront app** → send `"app": "storefront"` (or omit; default is storefront).
  - **Android / iOS mobile app** → send `"app": "mobile"`.
- If you omit `app`, the link uses the **storefront** URL.

- **Success:** `200` → message like “If that email exists, we sent a reset link.”
- **Error:** `400` → `{ "error": "..." }`

Install the **Shopwice Password Reset Link** WordPress plugin and set **all 3 app URLs** in Settings → Shopwice Reset Link (Vendor PWA URL, Headless/storefront URL, Mobile app URL). The email link will be `{URL for that app}/reset-password?key=xxx&login=user@example.com`. Each app must have a `/reset-password` page that reads `key` and `login` from the URL and calls the confirm endpoint.

### Step 2: Confirm new password (REST)

**Endpoint:** `POST /api/auth/reset-password`

**Body:** (field names may depend on your WordPress endpoint; typical pattern):

```json
{
  "user_login": "user@example.com",
  "password_reset_key": "key-from-email-link",
  "new_password": "NewSecurePass123!"
}
```

- **Success:** `200` → password updated; user can log in with the new password.
- **Error:** `400` → `{ "error": "..." }` (e.g. invalid or expired key).

### Three apps: always send `app` on forgot-password

| App | Use `app` value | Example base URL (plugin setting) |
|-----|------------------|-----------------------------------|
| **Vendor PWA** (React) | `"vendor"` | https://vendor.shopwice.com |
| **Headless storefront** | `"storefront"` (or omit) | https://shopwice.com |
| **Android / iOS mobile** | `"mobile"` | https://app.shopwice.com or custom scheme |

Each app calls `POST /api/auth/forgot-password` with its own `app` so the email link opens the same app’s reset page.

### Reset password page in each app

When the user clicks the link in the email, they should land on a route like **`/reset-password`** with query params:

- **`key`** – password reset key (from the link).
- **`login`** – user login (email or username).

Your page should:

1. Read `key` and `login` from the URL (e.g. from the query string or your router).
2. Show a form: “Enter new password” (and confirm password if you want).
3. On submit, call **POST /api/auth/reset-password** with body:
   - `user_login`: value of `login` from the URL.
   - `password_reset_key`: value of `key` from the URL.
   - `new_password`: the new password they entered.

Send `password_reset_key` and `user_login` in the request body; their values come from the reset link URL on this page.

### Password reset in React

**Step 1 – Forgot-password (request reset email)**  
Send **`email`** and **`app: "vendor"`** so the link in the email opens your app’s `/reset-password` page.

```jsx
const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: email.trim(), app: 'vendor' }),
});
const data = await res.json();
if (!res.ok) throw new Error(data.error || 'Request failed');
```

**Step 2 – Reset-password page**  
The email link is: **`/reset-password?key=XXX&login=user@example.com`**. Read **`key`** and **`login`** from the URL and send them as **`password_reset_key`** and **`user_login`** (exact names).

```jsx
// With React Router: useSearchParams().get('key'), .get('login')
// Without: new URLSearchParams(window.location.search).get('key'), .get('login')

const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    user_login: userLogin,
    password_reset_key: resetKey,
    new_password: newPassword,
  }),
});
const data = await res.json();
if (!res.ok) throw new Error(data.error || 'Reset failed');
```

**Body keys (must match exactly):** URL `?key=...` → **`password_reset_key`**; URL `?login=...` → **`user_login`**; form field → **`new_password`**.

**Why it often fails in React:** (1) Wrong body keys – use `user_login` and `password_reset_key`, not `login` or `key`. (2) Missing `app: "vendor"` on forgot-password so the email link goes to the wrong app. (3) Not reading `key`/`login` from the URL. (4) Expired link – request a new one. (5) Wrong `API_BASE` or paths.

### Example (fetch)

```javascript
// 1. User enters email; you call:
const forgotRes = await fetch(`${API_BASE}/api/auth/forgot-password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: userEmail, app: 'vendor' }),
});
const forgotData = await forgotRes.json();
if (!forgotRes.ok) throw new Error(forgotData.error);

// 2. User gets email, clicks link; your app reads key + login from URL and shows “New password” form. On submit:
const resetRes = await fetch(`${API_BASE}/api/auth/reset-password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    user_login: userLogin,         // from URL ?login=...
    password_reset_key: resetKey,  // from URL ?key=...
    new_password: newPassword,
  }),
});
const resetData = await resetRes.json();
if (!resetRes.ok) throw new Error(resetData.error);
```

### Password reset via GraphQL

The same flow is available over GraphQL so you can use either REST or GraphQL.

**Step 1 – Request reset email**

Mutation: `sendPasswordResetEmail`

```graphql
mutation ForgotPassword($input: SendPasswordResetEmailInput!) {
  sendPasswordResetEmail(input: $input) {
    success
    message
  }
}
```

Variables (same semantics as REST; use `app` so the link opens in the right app):

```json
{
  "input": {
    "email": "user@example.com",
    "app": "vendor"
  }
}
```

- **`app`** (optional): `"vendor"` | `"storefront"` | `"mobile"` — same as REST.

**Step 2 – Confirm new password**

Mutation: `resetPassword`

```graphql
mutation ResetPassword($input: ResetPasswordInput!) {
  resetPassword(input: $input) {
    success
    message
  }
}
```

Variables (values from the reset link: `key` → `password_reset_key`, `login` → `user_login`):

```json
{
  "input": {
    "user_login": "user@example.com",
    "password_reset_key": "key-from-email-link",
    "new_password": "NewSecurePass123!"
  }
}
```

Use your API's GraphQL endpoint (e.g. `POST /api/graphql`). The mutations call the same WordPress endpoints as the REST routes, so behavior and app URLs are identical.

### Can reset happen “inside the API” instead of WooCommerce?

- **Yes, from the app’s perspective:** All requests go to your API base (`/api/auth/forgot-password` and `/api/auth/reset-password`). You don’t need to point the app at WooCommerce or WordPress.
- **Backend still WordPress:** The API proxies to WordPress (shopwice.com) to send the email and update the password. User accounts and passwords live in WordPress; the API does not store them. So the “logic” (sending mail, updating password) stays on WordPress, but the **entry point** for your app is 100% your API.

To test the endpoints from the repo:  
`node scripts/test_password_reset.js`  
(use `RESET_EMAIL=your@email.com` to hit a real account).

---

## 5. Verify token (optional)

**Endpoint:** `GET /api/auth/verify`

**Headers:** `Authorization: Bearer <token>`

- **Valid:** `200` with user/token info.
- **Invalid:** `401`.

Use this to check on app load if the stored token is still valid and to restore the user session.

---

## 6. Flow in your app

1. **Registration**
   - Customer: form → `POST /api/auth/register` (no `isVendor`) → show success or error.
   - Vendor: form with shop name, phone, etc. → `POST /api/auth/register` with `isVendor: true` → show success or error.

2. **Login**
   - Form (email/username + password) → `POST /api/auth/login` → receive `token` and `user` (with `role`).

3. **After login**
   - Store `token` (e.g. in memory, or in `localStorage` / secure storage if you accept the trade-offs).
   - Store `user` (id, email, role) for UI (e.g. “Logged in as …”, show vendor vs customer menu).
   - Attach `Authorization: Bearer <token>` to all requests that require auth.

4. **Optional**
   - On app load, if you have a stored token, call `GET /api/auth/verify` to validate and refresh user state; if 401, clear token and show login.

---

## 7. Role-based UI

- **`role === 'wcfm_vendor'`** → show vendor dashboard, “My products”, “My orders”, vendor settings.
- **`role === 'customer'`** (or no role) → show normal shop, cart, account (no vendor-only links).

Use `loginResponse.user.role` or `loginResponse.role` to branch your routes and menus.
