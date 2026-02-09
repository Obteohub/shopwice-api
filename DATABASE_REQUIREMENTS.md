# Database Requirements for Shopwice Middleware API

## 1. Persistent Storage Requirements
**Yes, persistent storage is required.**
Although the service acts as a middleware between the frontend and the backend, it maintains a **read-only replica** of the product catalog and vendor data to ensure high performance and low latency at the edge.

- **Primary Storage**: Cloudflare D1 (SQLite-compatible).
- **Purpose**: Stores a synchronized copy of WordPress tables (`wp_posts`, `wp_postmeta`, `wp_terms`, etc.) to allow complex GraphQL queries without hitting the upstream WordPress REST API for every read request.

## 2. External Database Connections
The middleware does **not** connect directly to the upstream MySQL database. Instead, it interacts with two data sources:

### A. Internal Edge Database (Cloudflare D1)
- **Host/Type**: Cloudflare D1 (Serverless SQLite).
- **Binding Name**: `DB` (configured in `wrangler.toml`).
- **Schema**: Replicates the WordPress schema structure (see `schema.sql`).
- **Credentials**: Managed via Cloudflare Platform (IAM), no explicit username/password required in code.

### B. Upstream Backend (WordPress/WooCommerce)
- **Type**: REST API (Over HTTP).
- **Host**: `https://shopwice.com` (configurable via `WC_URL`).
- **Port**: 443 (HTTPS).
- **Credentials**:
    - `WC_CONSUMER_KEY`: Read/Write access key.
    - `WC_CONSUMER_SECRET`: Secret key.
    - **Storage**: Stored as encrypted environment variables in Cloudflare Pages.

## 3. Caching and Logging

### Caching (Local/Edge)
- **Mechanism**: Cloudflare KV (Key-Value Store).
- **Namespace**: `shopwice-cache`.
- **Data Cached**:
    - **Products**: Full JSON objects (TTL: 1 hour).
    - **Categories/Menus**: Tree structures (TTL: 1 hour).
    - **Search Results**: Product lists (TTL: 15 minutes).
- **Strategy**: Cache-aside. Resolvers check KV first; on miss, query D1, then populate KV.

### Logging
- **Mechanism**: Cloudflare Pages Functions Logs (stdout/stderr).
- **Retention**: Ephemeral (real-time tailing) unless integrated with a Logpush destination (e.g., Datadog, Splunk).

## 4. Data Export/Import Expectations
The backend team must provide data in one of the following formats to populate the D1 replica:

### Option A: JSON Export (Preferred)
- **Format**: A single JSON file or multiple JSON files.
- **Structure**:
  ```json
  {
    "wp_posts": [ { "ID": 1, "post_title": "..." }, ... ],
    "wp_postmeta": [ ... ]
  }
  ```
- **Import Command**:
  ```bash
  node scripts/import_from_json.js ./path/to/data.json
  ```

### Option B: SQL Dump
- **Format**: MySQL dump file.
- **Conversion**: Must be converted to SQLite-compatible syntax (remove `ENGINE=InnoDB`, `AUTO_INCREMENT` tweaks, etc.).
- **Import Command**:
  ```bash
  npx wrangler d1 execute shopwice-db --remote --file=./data.sql
  ```

### Anonymization Rules
For compliance and security, the export **must** be sanitized before being shared with the middleware team:
- **wp_users**: Obfuscate `user_email`, `user_pass` (set to dummy hash), `user_activation_key`.
- **wp_usermeta**: Remove sensitive keys like `session_tokens`, `billing_email`, `billing_phone`.
- **wp_comments**: Obfuscate `comment_author_email`, `comment_author_IP`.

## 5. Environment Connection Strings

### Development (Local)
- **DB**: Local D1 SQLite file (`.wrangler/state/v3/d1/...`).
- **Upstream**:
  ```env
  WC_URL=https://staging.shopwice.com
  WC_CONSUMER_KEY=ck_test_...
  WC_CONSUMER_SECRET=cs_test_...
  ```

### Staging
- **DB**: Cloudflare D1 (Preview Database).
- **Upstream**: Same as Development or Staging URL.

### Production
- **DB**: Cloudflare D1 (Production Database `shopwice-db`).
- **Upstream**:
  ```env
  WC_URL=https://shopwice.com
  WC_CONSUMER_KEY=ck_live_...
  WC_CONSUMER_SECRET=cs_live_...
  ```

## 6. Automated Resilience Tests
We have automated tests to verify the service behavior when the database is unreachable.

### Test: Database Resilience Check
**Purpose**: Verify that the API starts and returns appropriate error codes (or health check status) without a database connection, rather than crashing.

**Run Command**:
```bash
npm run test:resilience
```

**Expected Behavior**:
- Health Check (`/api/health`): Returns `200 OK` (if dependencies are optional) or `503 Service Unavailable` with a clear message.
- GraphQL Queries: Return `errors` array with "Database not initialized" or "Internal Error" message, but the HTTP status remains `200` (standard GraphQL behavior).
