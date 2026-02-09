const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Usage: node scripts/seed_products.js ./products.json
const dataFile = process.argv[2];

if (!dataFile) {
    console.error('Please provide a path to the WooCommerce Products JSON file.');
    console.error('Usage: node scripts/seed_products.js ./products.json');
    process.exit(1);
}

const products = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

// Helper to escape strings for SQL
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

const BATCH_SIZE = 10;
console.log(`Processing ${products.length} products in batches of ${BATCH_SIZE}...`);

for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    let sql = '';
    
    console.log(`Generating SQL for batch ${i / BATCH_SIZE + 1} (${batch.length} products)...`);

    batch.forEach(p => {
        // 1. wp_posts (Product)
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
        ) ON CONFLICT(ID) DO UPDATE SET post_title=excluded.post_title;\n`;

        // 2. wp_postmeta
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
                // wp_postmeta does not have a unique constraint on (post_id, meta_key) in standard WP,
                // so we cannot use ON CONFLICT. For seeding, we just INSERT.
                sql += `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (${p.id}, '${key}', ${escape(value)});\n`;
            }
        });

        // 3. wp_wc_product_meta_lookup
        sql += `INSERT INTO wp_wc_product_meta_lookup (
            product_id, sku, min_price, max_price, onsale, stock_quantity, stock_status, average_rating, total_sales
        ) VALUES (
            ${p.id}, ${escape(p.sku)}, ${p.price || 0}, ${p.price || 0}, 
            ${p.on_sale ? 1 : 0}, ${p.stock_quantity || 0}, 
            ${p.stock_status === 'instock' ? "'instock'" : "'outofstock'"}, 
            ${p.average_rating || 0}, ${p.total_sales || 0}
        ) ON CONFLICT(product_id) DO UPDATE SET stock_quantity=excluded.stock_quantity;\n`;

        // 4. Categories (Simple)
        if (p.categories) {
            p.categories.forEach(cat => {
                // Ensure Term Exists
                sql += `INSERT INTO wp_terms (term_id, name, slug) VALUES (${cat.id}, ${escape(cat.name)}, ${escape(cat.slug)}) ON CONFLICT(term_id) DO NOTHING;\n`;
                sql += `INSERT INTO wp_term_taxonomy (term_id, taxonomy) VALUES (${cat.id}, 'product_cat') ON CONFLICT(term_id, taxonomy) DO NOTHING;\n`;
                // Link
                sql += `INSERT INTO wp_term_relationships (object_id, term_taxonomy_id) VALUES (${p.id}, ${cat.id}) ON CONFLICT(object_id, term_taxonomy_id) DO NOTHING;\n`;
            });
        }
    });

    const outPath = `./seed_batch_${i}.sql`;
    fs.writeFileSync(outPath, sql);
    
    try {
        console.log(`Executing batch ${i / BATCH_SIZE + 1}...`);
        execSync(`npx wrangler d1 execute shopwice-db --remote --yes --file=${outPath}`, { stdio: 'inherit' });
        fs.unlinkSync(outPath);
    } catch (e) {
        console.error(`❌ Batch ${i / BATCH_SIZE + 1} failed:`, e.message);
        // Continue or break? Let's break to avoid cascading errors.
        process.exit(1);
    }
}

console.log('✅ Seeding completed successfully!');
