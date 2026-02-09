# Media Migration Guide

This guide explains how to migrate your product images from WordPress to Cloudflare R2.

## Prerequisites
- Node.js installed
- Authenticated with Wrangler (`npx wrangler login`)

## 1. Run the Migration Script
The script `scripts/migrate_media.js` downloads images from your `products.json` file and uploads them to your R2 bucket (`shopwice-media`). It also generates a SQL file to update the database.

To run the full migration (this may take several hours for 3000+ images):

```bash
node scripts/migrate_media.js --all
```

**Note:** If the script stops or fails (e.g., due to network issues), you can simply run it again. It will overwrite the `seed_media.sql` file, so make sure to execute the SQL (Step 2) after a successful run or batch.

## 2. Update the Database
Once the script finishes (or after a batch), update your Cloudflare D1 database with the new image URLs:

```bash
npx wrangler d1 execute shopwice-db --remote --file seed_media.sql
```

## 3. Verify
Check your API or database to see that product images are now served from `https://pub-3da318373ea74e3289271edc63013603.r2.dev/...`.

## Troubleshooting
- **Network Errors**: "Network connection lost" or "Unspecified error" from Wrangler are common during bulk uploads. Just retry the script.
- **Quota**: Ensure you don't exceed your R2 free tier if applicable (10GB storage, 1M Class A operations).
