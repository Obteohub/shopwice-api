
require('dotenv').config();
const fs = require('fs');
const { execSync } = require('child_process');
const WooCommerceClient = require('../src/utils/wc-client.js');

function log(msg) {
    fs.appendFileSync('resync_debug.log', msg + '\n');
    console.log(msg);
}

// Configuration
if (!process.env.WC_URL || !process.env.WC_CONSUMER_KEY || !process.env.WC_CONSUMER_SECRET) {
    log('Error: WC_URL, WC_CONSUMER_KEY, and WC_CONSUMER_SECRET must be set in .env');
}

const wc = new WooCommerceClient(process.env);

// Helper to escape for SQL
const escape = (str) => {
    if (str === null || str === undefined) return 'NULL';
    if (typeof str === 'number') return str;
    return `'${String(str).replace(/'/g, "''")}'`;
};

const escapeNotNull = (str, defaultVal = "''") => {
    if (str === null || str === undefined) return defaultVal;
    if (typeof str === 'number') return str;
    return `'${String(str).replace(/'/g, "''")}'`;
};

async function resyncImages() {
    log('--- Resyncing All Product Images ---');

    let page = 1;
    let products = [];
    let processing = true;

    while (processing) {
        log(`Fetching page ${page}...`);
        try {
            const batch = await wc.get('/products', { per_page: 50, page: page });
            if (batch.length === 0) {
                processing = false;
            } else {
                products = products.concat(batch);
                log(`Fetched ${batch.length} products (Total: ${products.length})`);
                page++;
            }
        } catch (e) {
            log(`Failed to fetch page ${page}: ${e.message}`);
            processing = false;
        }
    }

    if (products.length === 0) {
        log('No products found to sync.');
        return;
    }

    log(`Generating SQL for ${products.length} products...`);
    let sql = '';
    let updateCount = 0;

    for (const p of products) {
        // --- 1. Product Data (wp_posts) ---
        sql += `INSERT INTO wp_posts (
            ID, post_author, post_date, post_date_gmt, post_content, post_title, 
            post_excerpt, post_status, comment_status, ping_status, post_name, 
            post_modified, post_modified_gmt, post_parent, guid, post_type, menu_order
        ) VALUES (
            ${p.id}, 1, 
            ${escapeNotNull(p.date_created, "'0000-00-00 00:00:00'")}, ${escapeNotNull(p.date_created_gmt, "'0000-00-00 00:00:00'")}, 
            ${escapeNotNull(p.description)}, ${escapeNotNull(p.name)}, ${escapeNotNull(p.short_description)}, 
            ${escapeNotNull(p.status, "'publish'")}, 'open', 'closed', ${escapeNotNull(p.slug)}, 
            ${escapeNotNull(p.date_modified, "'0000-00-00 00:00:00'")}, ${escapeNotNull(p.date_modified_gmt, "'0000-00-00 00:00:00'")}, 
            ${p.parent_id || 0}, ${escapeNotNull(p.permalink)}, 'product', ${p.menu_order || 0}
        ) ON CONFLICT(ID) DO UPDATE SET post_title=excluded.post_title, post_status=excluded.post_status, post_date=excluded.post_date;\n`;

        // --- 2. Product Meta (wp_postmeta) ---
        const meta = {
            '_sku': p.sku,
            '_regular_price': p.regular_price,
            '_sale_price': p.sale_price,
            '_price': p.price,
            '_stock': p.stock_quantity,
            '_stock_status': p.stock_status,
            '_manage_stock': p.manage_stock ? 'yes' : 'no',
            '_virtual': p.virtual ? 'yes' : 'no',
            '_downloadable': p.downloadable ? 'yes' : 'no',
            '_weight': p.weight,
            '_thumbnail_id': p.images?.[0]?.id
        };

        Object.entries(meta).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                // Delete existing meta to avoid duplicates if no unique constraint
                sql += `DELETE FROM wp_postmeta WHERE post_id=${p.id} AND meta_key='${key}';\n`;
                sql += `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (${p.id}, '${key}', ${escape(value)});\n`;
            }
        });

        // --- 3. Lookup Table (wp_wc_product_meta_lookup) ---
        sql += `INSERT INTO wp_wc_product_meta_lookup (
            product_id, sku, min_price, max_price, onsale, stock_quantity, stock_status, average_rating, total_sales
        ) VALUES (
            ${p.id}, ${escape(p.sku)}, ${p.price || 0}, ${p.price || 0}, 
            ${p.on_sale ? 1 : 0}, ${p.stock_quantity || 0}, 
            ${p.stock_status === 'instock' ? "'instock'" : "'outofstock'"}, 
            ${p.average_rating || 0}, ${p.total_sales || 0}
        ) ON CONFLICT(product_id) DO UPDATE SET stock_quantity=excluded.stock_quantity, min_price=excluded.min_price, max_price=excluded.max_price;\n`;

        // --- 4. Categories ---
        if (p.categories) {
            p.categories.forEach(cat => {
                sql += `INSERT INTO wp_terms (term_id, name, slug) VALUES (${cat.id}, ${escape(cat.name)}, ${escape(cat.slug)}) ON CONFLICT(term_id) DO UPDATE SET name=excluded.name;\n`;
                sql += `INSERT INTO wp_term_taxonomy (term_id, taxonomy) VALUES (${cat.id}, 'product_cat') ON CONFLICT(term_id, taxonomy) DO NOTHING;\n`;
                sql += `INSERT INTO wp_term_relationships (object_id, term_taxonomy_id) VALUES (${p.id}, ${cat.id}) ON CONFLICT(object_id, term_taxonomy_id) DO NOTHING;\n`;
            });
        }

        updateCount++;

        // --- 5. Images (Attachments) ---
        const images = p.images || [];

        for (const img of images) {
            if (!img.id) continue;

            // The Logic from SyncService (patched)
            const imageUrl = img.src || img.source_url || img.url || '';
            const date = new Date().toISOString();
            const validSlug = (img.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

            if (!imageUrl) {
                log(`Warning: Image ${img.id} for product ${p.id} has no URL.`);
                continue;
            }

            // Generate SQL
            sql += `INSERT INTO wp_posts (
                ID, post_author, post_date, post_date_gmt, post_content, post_title, 
                post_excerpt, post_status, comment_status, ping_status, post_name, 
                post_modified, post_modified_gmt, post_parent, guid, post_type, post_mime_type
            ) VALUES (
                ${img.id}, 1, '${date}', '${date}', '', ${escape(img.name)}, '', 'inherit', 'open', 'closed',
                 ${escape(validSlug)}, '${date}', '${date}', ${p.id}, ${escape(imageUrl)}, 'attachment', 'image/jpeg'
            ) ON CONFLICT(ID) DO UPDATE SET guid=excluded.guid;\n`;

            sql += `DELETE FROM wp_postmeta WHERE post_id = ${img.id} AND meta_key = '_wp_attached_file';\n`;
            sql += `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (${img.id}, '_wp_attached_file', ${escape(imageUrl)});\n`;

            updateCount++;
        }
    }

    if (!sql) {
        log('No image updates needed.');
        return;
    }

    // Split into batches to avoid too large SQL files
    const outPath = 'resync_images.sql';
    fs.writeFileSync(outPath, sql);
    log(`Generated SQL for ${updateCount} images at ${outPath}. Executing...`);

    try {
        // We use --remote since we want to fix the production DB
        execSync(`npx wrangler d1 execute shopwice-db --remote --yes --file=${outPath}`, { stdio: 'inherit' });
        log('✅ Products resynced successfully!');

        // Invalidate KV Cache
        try {
            log('Invalidating KV Cache...');
            const timestamp = Date.now().toString();
            execSync(`npx wrangler kv key put --binding shopwice_cache "product_list_version" "${timestamp}" --remote`, { stdio: 'inherit' });
            log('✅ Cache invalidated!');
        } catch (e) {
            log(`❌ Cache invalidation failed: ${e.message}`);
        }
    } catch (e) {
        log(`❌ Resync failed: ${e.message}`);
    } finally {
        fs.unlinkSync(outPath);
    }
}

resyncImages().catch(console.error);
