require('dotenv').config();
const SyncService = require('../src/services/syncService');
const db = require('../src/config/db');
const WooCommerceClient = require('../src/utils/wc-client');

// Mock Env for SyncService
const env = {
    ...process.env,
    // Add any binding mocks if needed, but SyncService uses db module which we verify below
};

// Initialize DB for local execution (using remote D1 via wrangler usually requires more setup,
// but here we can mock the db module or if running with wrangler exec, it handles it.
// Wait, SyncService imports db from ../config/db. 
// If we run this script with `node`, db module needs to know how to connect.
// If we run with `wrangler d1 execute`, we can't run complex node scripts easily.
// best approach: This script mimics the behavior of `sync_singular_product.js` but iterates.
// However, `sync_singular_product.js` generates SQL. `SyncService` executes SQL.
// If we want to use `SyncService` logic, we need `db.query` to execute against remote D1.
// That is hard from a node script without `wrangler d1 execute` wrapper for every query.
//
// ALTERNATIVE: checking `sync_singular_product.js`... it uses `execSync` with `wrangler d1 execute`.
// `SyncService` uses `db.query` which expects a D1 binding or local sqlite.
//
// So we cannot easily run `SyncService` from a local node script against remote D1.
//
// STRATEGY: 
// 1. We will use the `SyncService.js` logic but adapted to generate SQL and run it via `wrangler`, 
//    OR we assume we run this script IN the worker environment (hard to trigger),
//    OR we write a specialized script that does what `sync_singular_product.js` does but for variations.
//
// Let's go with the specialized script approach that reuses the logic but runs via `execSync`.
// This is safer and proven to work with `sync_singular_product.js`.

const { execSync } = require('child_process');
const fs = require('fs');

async function syncVariationsForProduct(slug) {
    if (!process.env.WC_URL || !process.env.WC_CONSUMER_KEY || !process.env.WC_CONSUMER_SECRET) {
        console.error('Error: missing env vars');
        return;
    }

    const wc = new WooCommerceClient(process.env);
    console.log(`Fetching product with slug: ${slug}...`);

    try {
        const products = await wc.get('/products', { slug });
        if (!products.length) {
            console.error(`Product not found in WooCommerce with slug: ${slug}`);
            return;
        }

        const p = products[0];
        console.log(`Found product: ${p.id} - ${p.name}`);

        if (p.type !== 'variable') {
            console.log('Not a variable product. Skipping.');
            return;
        }

        if (!p.variations || p.variations.length === 0) {
            console.log('No variations found. Skipping.');
            return;
        }

        console.log(`Found ${p.variations.length} variations. Syncing...`);

        const escape = (str) => {
            if (str === null || str === undefined) return 'NULL';
            if (typeof str === 'number') return str;
            return `'${String(str).replace(/'/g, "''")}'`;
        };

        let sql = '';

        for (const varId of p.variations) {
            console.log(`Fetching variation ${varId}...`);
            const v = await wc.get(`/products/${p.id}/variations/${varId}`);

            // Upsert into wp_posts
            sql += `
            INSERT INTO wp_posts (
                ID, post_author, post_date, post_date_gmt, post_content, post_title, 
                post_excerpt, post_status, comment_status, ping_status, post_name, 
                post_type, post_parent, guid, post_modified, post_modified_gmt
            ) VALUES (
                ${v.id}, 1, '${v.date_created}', '${v.date_created_gmt}', 
                ${escape(v.description)}, ${escape(v.name)}, ${escape(v.description)}, 
                'publish', 'open', 'closed', ${escape(v.slug)}, 'product_variation', ${p.id}, ${escape(v.permalink)},
                '${v.date_modified}', '${v.date_modified_gmt}'
            ) ON CONFLICT(ID) DO UPDATE SET 
                post_type='product_variation', 
                post_parent=${p.id},
                post_status='publish',
                post_title=excluded.post_title;\n`;

            // Meta
            const meta = {
                '_sku': v.sku,
                '_regular_price': v.regular_price,
                '_sale_price': v.sale_price,
                '_price': v.price,
                '_stock': v.stock_quantity,
                '_stock_status': v.stock_status,
                '_weight': v.weight,
                '_thumbnail_id': v.image ? v.image.id : null,
                '_product_attributes': JSON.stringify(v.attributes)
            };

            for (const [key, val] of Object.entries(meta)) {
                if (val !== undefined && val !== null) {
                    let sVal = String(val);
                    // Delete then insert for robustness
                    sql += `DELETE FROM wp_postmeta WHERE post_id = ${v.id} AND meta_key = ${escape(key)};\n`;
                    sql += `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (${v.id}, ${escape(key)}, ${escape(sVal)});\n`;
                }
            }

            // Lookup
            sql += `INSERT INTO wp_wc_product_meta_lookup (product_id, sku, min_price, max_price, stock_quantity, stock_status) VALUES (${v.id}, ${escape(v.sku)}, ${v.price || 0}, ${v.price || 0}, ${v.stock_quantity || 0}, ${escape(v.stock_status === 'instock' ? 'instock' : 'outofstock')}) ON CONFLICT(product_id) DO UPDATE SET min_price=excluded.min_price, max_price=excluded.max_price, stock_quantity=excluded.stock_quantity, stock_status=excluded.stock_status;\n`;
        }

        fs.writeFileSync('sync_vars.sql', sql);
        console.log('Executing D1 update...');
        execSync(`npx wrangler d1 execute shopwice-db --remote --yes --file=sync_vars.sql`, { stdio: 'inherit' });

        console.log('Invalidating cache...');
        const timestamp = Date.now().toString();
        execSync(`npx wrangler kv key put --binding shopwice_cache "product_list_version" "${timestamp}" --remote`, { stdio: 'inherit' });

        console.log(`✅ Success! Variations for ${p.id} synced.`);
        fs.unlinkSync('sync_vars.sql');

    } catch (e) {
        console.error('Sync failed:', e);
    }
}

const targetSlug = process.argv[2];
if (!targetSlug) {
    console.log('Please provide a product slug.');
    process.exit(1);
}
syncVariationsForProduct(targetSlug);
