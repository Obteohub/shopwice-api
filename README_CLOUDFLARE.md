# Cloudflare Pages Deployment Guide

This repository has been refactored to support deployment to **Cloudflare Pages**.
The architecture uses **Cloudflare Pages Functions** for the backend API and GraphQL, and serves static assets from the `public` directory.

## Prerequisites

1.  **Cloudflare Account**: You need a Cloudflare account.
2.  **Database**: Your MySQL database must be accessible from the internet (not `localhost`).
    -   Recommended: Use Cloudflare Hyperdrive or a serverless-friendly provider (PlanetScale, Neon, etc.).
    -   If using a VPS, ensure port 3306 is open to Cloudflare IPs or use Cloudflare Tunnel.
3.  **Redis**: Use a serverless Redis provider like **Upstash** (recommended for Workers). Local Redis will not work.

## Directory Structure

-   `public/`: Contains static frontend assets (HTML, CSS, JS).
-   `functions/`: Contains the Serverless Functions.
    -   `functions/graphql.js`: The GraphQL API endpoint.
    -   `functions/api/[[route]].js`: The REST API endpoints (Wildcard router).
-   `src/`: Shared logic (Controllers, Services, Config).

## Setup & Deployment

1.  **Install Dependencies**
    ```bash
    npm install
    ```

2.  **Local Development**
    To run the Cloudflare Pages environment locally:
    ```bash
    npx wrangler pages dev .
    ```
    This will serve the app at `http://localhost:8788`.

3.  **Environment Variables**
    You must set the following secrets in your Cloudflare Pages Dashboard (Settings > Environment variables):

    -   `WC_URL`: https://shopwice.com
    -   `WC_CONSUMER_KEY`: your_key
    -   `WC_CONSUMER_SECRET`: your_secret
    -   `DB_HOST`: your_db_host (e.g., remote IP or hostname)
    -   `DB_USER`: your_db_user
    -   `DB_PASSWORD`: your_db_password
    -   `DB_NAME`: your_db_name
    -   `REDIS_URL`: your_redis_url (e.g., redis://default:pass@global-redis.upstash.io:6379)
    -   `JWT_SECRET`: your_jwt_secret

4.  **Deploy to Cloudflare**
    
    **Option A: Git Integration (Recommended)**
    -   Push this code to GitHub/GitLab.
    -   Connect your repository to Cloudflare Pages.
    -   Set the **Build Command** to `npm install` (or leave empty if no build step is needed for static assets).
    -   Set the **Build Output Directory** to `public`.
    -   Add the Environment Variables in the dashboard.

    **Option B: Direct Upload**
    ```bash
    npx wrangler pages deploy .
    ```

## Key Changes Made
-   **GraphQL**: Migrated from `apollo-server-express` to `graphql-yoga` (Worker-compatible).
-   **REST API**: Migrated from `express` to `itty-router` running in Pages Functions.
-   **Database**: `src/config/db.js` now uses lazy initialization and proxying to support serverless environments.
-   **Redis**: `src/services/redis.js` refactored for connection handling in Workers.
-   **Axios**: Removed `httpAgent` configuration which causes issues in Workers.

## Troubleshooting
-   **Database Connection Errors**: Ensure your database allows connections from Cloudflare's Edge network. Using **Cloudflare Hyperdrive** is highly recommended for performance and connection pooling.
-   **Redis Errors**: Ensure you are using a public Redis URL (like Upstash).
