require('dotenv').config();
const WooCommerceClient = require('../src/utils/wc-client');
const { execSync } = require('child_process');

function executeSql(sql, params = []) {
    try {
        // Replace ? with params
        let finalSql = sql;
        for (const param of params) {
            let val = param;
            if (typeof val === 'string') val = `'${val.replace(/'/g, "''")}'`; // Escape single quotes
            if (val === null || val === undefined) val = 'NULL';
            finalSql = finalSql.replace('?', val);
        }

        const cleanSql = finalSql.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim();
        const cmdSql = cleanSql.replace(/"/g, '\\"');
        
        console.log(`Executing SQL...`);
        execSync(`npx wrangler d1 execute shopwice-db --local --command "${cmdSql}"`, { stdio: 'pipe' });
    } catch (e) {
        console.error("SQL Execution Error:", e.message);
    }
}

async function syncProduct() {
    const wc = new WooCommerceClient({
        WC_URL: process.env.WC_URL,
        WC_CONSUMER_KEY: process.env.WC_CONSUMER_KEY,
        WC_CONSUMER_SECRET: process.env.WC_CONSUMER_SECRET
    });

    try {
        const productId = 207143;
        const vendorId = 16533;
        
        console.log(`Fetching product ${productId}...`);
        const p = await wc.get(`/products/${productId}`);
        
        // Sync Logic from resolvers.js
        const postDate = (p.date_created || new Date().toISOString()).replace('T', ' ').split('.')[0];
        const postDateGmt = (p.date_created_gmt || new Date().toISOString()).replace('T', ' ').split('.')[0];
        const postModified = (p.date_modified || new Date().toISOString()).replace('T', ' ').split('.')[0];
        const postModifiedGmt = (p.date_modified_gmt || new Date().toISOString()).replace('T', ' ').split('.')[0];
        const productAuthor = vendorId || p.post_author || 0;

        // 1. wp_posts
        const sqlPosts = `
            INSERT INTO wp_posts (
                ID, post_author, post_date, post_date_gmt, post_content, post_title, 
                post_excerpt, post_status, comment_status, ping_status, post_name, 
                post_modified, post_modified_gmt, post_parent, guid, post_type, menu_order
            ) VALUES (
                ?, ?, ?, ?, ?, ?, 
                ?, ?, 'open', 'closed', ?, 
                ?, ?, ?, ?, 'product', ?
            ) ON CONFLICT(ID) DO UPDATE SET 
                post_title=excluded.post_title, 
                post_content=excluded.post_content,
                post_excerpt=excluded.post_excerpt,
                post_status=excluded.post_status, 
                post_author=excluded.post_author,
                post_modified=excluded.post_modified,
                post_modified_gmt=excluded.post_modified_gmt,
                post_name=excluded.post_name,
                post_parent=excluded.post_parent;
        `;
        
        executeSql(sqlPosts, [
            p.id, productAuthor, postDate, postDateGmt, p.description || '', p.name || '',
            p.short_description || '', p.status, p.slug || '',
            postModified, postModifiedGmt, p.parent_id || 0, p.permalink || '', p.menu_order || 0
        ]);

        // 2. wp_postmeta - Vendor Association
        executeSql(`DELETE FROM wp_postmeta WHERE post_id = ${p.id} AND meta_key = '_wcfm_product_author'`);
        executeSql(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_wcfm_product_author', ?)`, [p.id, vendorId]);

        // 3. Other Meta
        const meta = {
            '_price': p.price,
            '_regular_price': p.regular_price,
            '_sale_price': p.sale_price,
            '_sku': p.sku,
            '_stock_status': p.stock_status,
            '_stock': p.stock_quantity,
            '_manage_stock': p.manage_stock ? 'yes' : 'no'
        };

        for (const [k, v] of Object.entries(meta)) {
            if (v !== undefined && v !== null) {
                executeSql(`DELETE FROM wp_postmeta WHERE post_id = ${p.id} AND meta_key = '${k}'`);
                executeSql(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)`, [p.id, k, String(v)]);
            }
        }

        // 4. Lookup Table
        const sqlLookup = `
            INSERT INTO wp_wc_product_meta_lookup (
                product_id, sku, min_price, max_price, onsale, stock_quantity, stock_status, average_rating, total_sales
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?
            ) ON CONFLICT(product_id) DO UPDATE SET 
                min_price=excluded.min_price, 
                max_price=excluded.max_price, 
                stock_status=excluded.stock_status,
                stock_quantity=excluded.stock_quantity,
                onsale=excluded.onsale;
        `;
        
        executeSql(sqlLookup, [
            p.id, p.sku || '', p.price || 0, p.price || 0, 
            p.on_sale ? 1 : 0, p.stock_quantity || 0, p.stock_status === 'instock' ? 'instock' : 'outofstock',
            p.average_rating || 0, p.total_sales || 0
        ]);

        console.log('Sync complete.');

    } catch (error) {
        console.error('Error:', error.message);
    }
}

syncProduct();
