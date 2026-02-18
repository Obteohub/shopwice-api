
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

async function resyncAll() {
    log('--- Starting Full System Resync ---');

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

    log(`Processing ${products.length} products (including fetching variations)...`);
    let sql = '';
    let updateCount = 0;

    for (const p of products) {
        log(`Preparing SQL for: ${p.id} - ${p.name}`);

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
        ) ON CONFLICT(ID) DO UPDATE SET 
            post_title=excluded.post_title, 
            post_status=excluded.post_status, 
            post_date=excluded.post_date,
            post_modified=excluded.post_modified,
            post_name=excluded.post_name,
            post_type='product';\n`;

        // --- 2. Product Meta (wp_postmeta) ---
        // Collect all meta from p.meta_data plus standard fields
        const metaEntries = [];
        if (p.meta_data) {
            p.meta_data.forEach(m => {
                let val = m.value;
                if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
                metaEntries.push({ key: m.key, val: String(val) });
            });
        }

        // Standard fields (ensure they are present)
        const standardMeta = {
            '_sku': p.sku,
            '_regular_price': p.regular_price,
            '_sale_price': p.sale_price,
            '_price': p.price,
            '_stock': p.stock_quantity,
            '_stock_status': p.stock_status,
            '_manage_stock': p.manage_stock ? 'yes' : 'no',
            '_virtual': p.virtual ? 'yes' : 'no',
            '_downloadable': p.downloadable ? 'yes' : 'no',
            '_thumbnail_id': p.images?.[0]?.id
        };
        Object.entries(standardMeta).forEach(([key, val]) => {
            if (val !== undefined && val !== null) {
                metaEntries.push({ key, val: String(val) });
            }
        });

        metaEntries.forEach(({ key, val }) => {
            sql += `DELETE FROM wp_postmeta WHERE post_id=${p.id} AND meta_key=${escape(key)};\n`;
            sql += `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (${p.id}, ${escape(key)}, ${escape(val)});\n`;
        });

        // --- 3. Lookup Table (wp_wc_product_meta_lookup) ---
        sql += `INSERT INTO wp_wc_product_meta_lookup (
            product_id, sku, virtual, downloadable, min_price, max_price, onsale, 
            stock_quantity, stock_status, average_rating, total_sales, tax_status, tax_class
        ) VALUES (
            ${p.id}, ${escape(p.sku)}, ${p.virtual ? 1 : 0}, ${p.downloadable ? 1 : 0}, 
            ${p.price || 0}, ${p.price || 0}, 
            ${p.on_sale ? 1 : 0}, ${p.stock_quantity || 0}, 
            ${p.stock_status === 'instock' ? "'instock'" : "'outofstock'"}, 
            ${p.average_rating || 0}, ${p.total_sales || 0},
            ${escape(p.tax_status || 'taxable')}, ${escape(p.tax_class || '')}
        ) ON CONFLICT(product_id) DO UPDATE SET 
            stock_quantity=excluded.stock_quantity, 
            min_price=excluded.min_price, 
            max_price=excluded.max_price,
            stock_status=excluded.stock_status,
            onsale=excluded.onsale;\n`;

        // --- 4. Categories ---
        if (p.categories) {
            p.categories.forEach(cat => {
                sql += `INSERT INTO wp_terms (term_id, name, slug) VALUES (${cat.id}, ${escape(cat.name)}, ${escape(cat.slug)}) ON CONFLICT(term_id) DO UPDATE SET name=excluded.name;\n`;
                sql += `INSERT INTO wp_term_taxonomy (term_id, taxonomy) VALUES (${cat.id}, 'product_cat') ON CONFLICT(term_id, taxonomy) DO NOTHING;\n`;
                sql += `INSERT INTO wp_term_relationships (object_id, term_taxonomy_id) VALUES (${p.id}, ${cat.id}) ON CONFLICT(object_id, term_taxonomy_id) DO NOTHING;\n`;
            });
        }

        // --- 5. Variations ---
        if (p.type === 'variable' && p.variations && p.variations.length > 0) {
            log(`Fetching variations for ${p.id}...`);
            try {
                const variations = await wc.get(`/products/${p.id}/variations`, { per_page: 100 });
                for (const v of variations) {
                    sql += `INSERT INTO wp_posts (
                        ID, post_author, post_date, post_date_gmt, post_content, post_title, 
                        post_excerpt, post_status, comment_status, ping_status, post_name, 
                        post_modified, post_modified_gmt, post_parent, guid, post_type
                    ) VALUES (
                        ${v.id}, 1, '${v.date_created}', '${v.date_created_gmt}', 
                        '', ${escape(v.name)}, '', 'publish', 'open', 'closed', ${escape(v.slug)}, 
                        '${v.date_modified}', '${v.date_modified_gmt}', ${p.id}, ${escape(v.permalink)}, 'product_variation'
                    ) ON CONFLICT(ID) DO UPDATE SET post_status='publish', post_parent=excluded.post_parent, post_type='product_variation';\n`;

                    const vMeta = {
                        '_sku': v.sku,
                        '_price': v.price,
                        '_regular_price': v.regular_price,
                        '_sale_price': v.sale_price,
                        '_stock': v.stock_quantity,
                        '_stock_status': v.stock_status,
                        '_thumbnail_id': v.image?.id
                    };
                    Object.entries(vMeta).forEach(([key, val]) => {
                        if (val !== undefined && val !== null) {
                            sql += `DELETE FROM wp_postmeta WHERE post_id=${v.id} AND meta_key='${key}';\n`;
                            sql += `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (${v.id}, '${key}', ${escape(val)});\n`;
                        }
                    });

                    // Variation Lookup
                    sql += `INSERT INTO wp_wc_product_meta_lookup (
                        product_id, sku, min_price, max_price, onsale, stock_quantity, stock_status
                    ) VALUES (
                        ${v.id}, ${escape(v.sku)}, ${v.price || 0}, ${v.price || 0}, 
                        ${v.on_sale ? 1 : 0}, ${v.stock_quantity || 0}, 
                        ${v.stock_status === 'instock' ? "'instock'" : "'outofstock'"}
                    ) ON CONFLICT(product_id) DO UPDATE SET stock_quantity=excluded.stock_quantity, min_price=excluded.min_price;\n`;
                }
            } catch (ve) {
                log(`Failed to fetch variations for product ${p.id}: ${ve.message}`);
            }
        }

        updateCount++;

        // --- 6. Images ---
        const images = p.images || [];
        for (const img of images) {
            if (!img.id) continue;
            const imageUrl = img.src || img.source_url || img.url || '';
            const date = p.date_created ? p.date_created.replace('T', ' ').split('.')[0] : new Date().toISOString().replace('T', ' ').split('.')[0];
            const validSlug = (img.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
            if (!imageUrl) continue;

            sql += `INSERT INTO wp_posts (
                ID, post_author, post_date, post_date_gmt, post_content, post_title, 
                post_excerpt, post_status, comment_status, ping_status, post_name, 
                post_modified, post_modified_gmt, post_parent, guid, post_type, post_mime_type
            ) VALUES (
                ${img.id}, 1, '${date}', '${date}', '', ${escape(img.name)}, '', 'inherit', 'open', 'closed',
                 ${escape(validSlug)}, '${date}', '${date}', ${p.id}, ${escape(imageUrl)}, 'attachment', 'image/jpeg'
            ) ON CONFLICT(ID) DO UPDATE SET guid=excluded.guid, post_parent=excluded.post_parent;\n`;

            sql += `DELETE FROM wp_postmeta WHERE post_id = ${img.id} AND meta_key = '_wp_attached_file';\n`;
            sql += `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (${img.id}, '_wp_attached_file', ${escape(imageUrl)});\n`;
        }

        // To prevent massive SQL files that fail the 1MB limit, 
        // we should execute in smaller chunks (e.g. every 20 products)
        if (updateCount % 20 === 0) {
            await executeBatch(sql);
            sql = '';
        }
    }

    if (sql) {
        await executeBatch(sql);
    }

    log('--- All System Resync Finished ---');

    // Invalidate KV Cache across all possible bindings
    try {
        log('Invalidating KV Cache...');
        const timestamp = Date.now().toString();
        // Try multiple bindings commonly used
        const bindings = ['shopwice_cache', 'CACHE'];
        for (const b of bindings) {
            try {
                execSync(`npx wrangler kv key put --binding ${b} "product_list_version" "${timestamp}" --remote`, { stdio: 'inherit' });
                log(`✅ Cache invalidated for binding: ${b}`);
            } catch (e) {
                log(`⚠️ Warning: Cache invalidation failed for binding ${b} (maybe it doesn't exist)`);
            }
        }
    } catch (e) {
        log(`❌ Global cache invalidation failed: ${e.message}`);
    }
}

async function executeBatch(sql) {
    const outPath = 'resync_batch.sql';
    fs.writeFileSync(outPath, sql);
    log(`Executing SQL batch (${sql.split('\n').length} lines)...`);
    try {
        execSync(`npx wrangler d1 execute shopwice-db --remote --yes --file=${outPath}`, { stdio: 'inherit' });
    } catch (e) {
        log(`❌ Batch execution failed: ${e.message}`);
    } finally {
        fs.unlinkSync(outPath);
    }
}

resyncAll().catch(console.error);
