# Shopwice API (Cloudflare Pages)

## Overview
This project provides a serverless API for the Shopwice e-commerce platform, deployed on Cloudflare Pages Functions. It replaces the legacy Express/Node.js server with a modern, edge-compatible architecture.

## Features
- **GraphQL API**: Powered by `graphql-yoga`, fully compatible with Cloudflare Workers.
- **REST API**: Powered by `itty-router`, handling legacy endpoints, auth, and vendor management.
- **Database**: Lazy-loaded MySQL connection (requires TCP capable environment or Cloudflare Hyperdrive/Tunnel).
- **Authentication**: Web Crypto API based JWT implementation.
- **Caching**: In-memory Map caching (per isolate).

## Project Structure
- `functions/`: Cloudflare Pages Functions (Entry points)
  - `api/[[route]].js`: REST API (Wildcard router)
  - `graphql.js`: GraphQL Endpoint
- `src/`: Core Logic
  - `config/`: Database and WooCommerce config
  - `graphql/`: Schema, Resolvers, DataLoaders
  - `utils/`: Helpers (Auth, WooCommerce Client)
  - `services/`: Third-party service integrations (WCFM)
- `scripts/`: Verification and testing scripts
- `public/`: Static assets (Placeholder)

## Getting Started

### Prerequisites
- Node.js
- Cloudflare Wrangler CLI (`npm install -g wrangler`)

### Installation
```bash
npm install
```

### Development
Run the local development server (simulates Cloudflare environment):
```bash
npm run dev
```
The API will be available at `http://localhost:8788`.

### Deployment
```bash
npm run deploy
```

## Environment Variables
Ensure the following variables are set in Cloudflare Pages settings (or `.dev.vars` for local dev):
- `WC_URL`
- `WC_CONSUMER_KEY`
- `WC_CONSUMER_SECRET`
- `DB_HOST`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `JWT_SECRET`
- `GOOGLE_PLACES_API_KEY`

## Verification
Use the provided script to verify endpoints locally (uses a mock database):
```bash
node scripts/verify_cf_routes.mjs
```
