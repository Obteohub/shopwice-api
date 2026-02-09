# Real-time Data Synchronization Guide

To ensure the Shopwice middleware (Cloudflare D1) stays in sync with the main WordPress backend, we use **WooCommerce Webhooks**.

## 1. How it Works
1.  **Event**: An admin updates a product in WooCommerce.
2.  **Trigger**: WooCommerce sends a `POST` request to the Middleware URL.
3.  **Action**: The Middleware updates its local D1 database and clears the cache.

## 2. Configuration (WooCommerce)
You need to set up a Webhook in the WordPress Admin Dashboard.

1.  Go to **WooCommerce > Settings > Advanced > Webhooks**.
2.  Click **Add Webhook**.
3.  **Name**: `Shopwice Middleware Sync`
4.  **Status**: `Active`
5.  **Topic**: Select the specific resource topic (See below). **DO NOT select "Action"**.
    *   **Webhook 1**: Topic = `Product Created`
    *   **Webhook 2**: Topic = `Product Updated`
    *   **Webhook 3**: Topic = `Product Deleted`
6.  **Delivery URL**: `https://api.shopwice.com/api/webhooks/sync`
7.  **Secret**: `your-secure-webhook-secret` (Generate a strong random string).
    *   **IMPORTANT**: Use the **SAME** secret for all 3 webhooks.
    *   Our server uses one single environment variable (`WEBHOOK_SECRET`) to verify all of them.
8.  **API Version**: `WP REST API Integration v3`.
9.  Click **Save Webhook**.

> **⚠️ IMPORTANT**: Do **NOT** select **"Action"** as the Topic.
> *   **Why?** The "Action" topic only sends the *ID* of the product, but our system expects the *full product data* (Name, Price, Image, etc.) to update the database immediately.
> *   **Always use**: `Product Created`, `Product Updated`, or `Product Deleted`.

## 3. Configuration (Middleware)
You must configure the `WEBHOOK_SECRET` in the Cloudflare Pages environment to match the one you entered in WooCommerce.

### Local Development (.dev.vars)
Create a `.dev.vars` file in the project root (do not commit this file):
```env
WEBHOOK_SECRET=your-secure-webhook-secret
```

### Production (Cloudflare Dashboard)
1.  Go to **Cloudflare Dashboard > Pages > shopwice-api**.
2.  Go to **Settings > Environment variables**.
3.  Add a new variable:
    *   **Key**: `WEBHOOK_SECRET`
    *   **Value**: `your-secure-webhook-secret`
    *   **Encrypt**: Yes (Recommended).

## 4. Verification
To verify the sync is working:
1.  Update a product price in WordPress.
2.  Wait a few seconds.
3.  Query the Middleware API (GraphQL):
    ```graphql
    query {
      product(id: "123") {
        price
      }
    }
    ```
4.  The price should reflect the change immediately.

## 5. Manual Sync (Emergency)
If the webhooks fail or you need to re-sync everything:
1.  Export the JSON from WordPress.
2.  Run the manual import script (as described in `DATABASE_REQUIREMENTS.md`).
