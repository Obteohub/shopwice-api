require('dotenv').config();
const WooCommerceClient = require('../src/utils/wc-client.js');
const { execSync } = require('child_process');
const fs = require('fs');

async function syncProduct(slug) {
    if (!process.env.WC_URL || !process.env.WC_CONSUMER_KEY || !process.env.WC_CONSUMER_SECRET) {
        console.error('Error: missing env vars');
        return;
    }

    const wc = new WooCommerceClient(process.env);

    try {
        let p;
        if (/^\d+$/.test(slug)) {
            console.log(`Fetching product with ID: ${slug}...`);
            p = await wc.get(`/products/${slug}`);
        } else {
            console.log(`Fetching product with slug: ${slug}...`);
            const products = await wc.get('/products', { slug });
            if (!products.length) {
                console.error(`Product not found in WooCommerce with slug: ${slug}`);
                return;
            }
            p = products[0];
        }

        console.log(`Found product: ${p.id} - ${p.name}`);

        const escape = (str) => {
            if (str === null || str === undefined) return 'NULL';
            if (typeof str === 'number') return str;
            return `'${String(str).replace(/'/g, "''")}'`;
        };

        let sql = `
            INSERT INTO wp_posts (
                ID, post_author, post_date, post_date_gmt, post_content, post_title, 
                post_excerpt, post_status, comment_status, ping_status, post_name, 
                post_type, guid
            ) VALUES (
                ${p.id}, 1, '${p.date_created}', '${p.date_created_gmt}', 
                ${escape(p.description)}, ${escape(p.name)}, ${escape(p.short_description)}, 
                'publish', 'open', 'closed', ${escape(p.slug)}, 'product', ${escape(p.permalink)}
            ) ON CONFLICT(ID) DO UPDATE SET post_status='publish', post_title=excluded.post_title;\n
        `;

        if (p.categories) {
            p.categories.forEach(cat => {
                sql += `INSERT OR IGNORE INTO wp_terms (term_id, name, slug) VALUES (${cat.id}, ${escape(cat.name)}, ${escape(cat.slug)});\n`;
                sql += `INSERT OR IGNORE INTO wp_term_taxonomy (term_id, taxonomy, description) VALUES (${cat.id}, 'product_cat', '');\n`;
                sql += `INSERT OR IGNORE INTO wp_term_relationships (object_id, term_taxonomy_id) VALUES (${p.id}, ${cat.id});\n`;
            });
        }

        if (p.meta_data) {
            p.meta_data.forEach(m => {
                let val = m.value;
                if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
                // Robust metadata insertion: delete then insert
                sql += `DELETE FROM wp_postmeta WHERE post_id = ${p.id} AND meta_key = ${escape(m.key)};\n`;
                sql += `INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (${p.id}, ${escape(m.key)}, ${escape(String(val))});\n`;
            });
        }

        // Update Lookup Table
        sql += `
            INSERT INTO wp_wc_product_meta_lookup (
                product_id, sku, virtual, downloadable, min_price, max_price, 
                onsale, stock_quantity, stock_status, average_rating, total_sales, tax_status, tax_class
            ) VALUES (
                ${p.id}, ${escape(p.sku)}, ${p.virtual ? 1 : 0}, ${p.downloadable ? 1 : 0}, 
                ${p.price || 0}, ${p.price || 0}, ${p.on_sale ? 1 : 0}, 
                ${p.stock_quantity || 0}, ${p.stock_status === 'instock' ? "'instock'" : "'outofstock'"}, 
                ${p.average_rating || 0}, ${p.total_sales || 0}, ${escape(p.tax_status || 'taxable')}, ${escape(p.tax_class || '')}
            ) ON CONFLICT(product_id) DO UPDATE SET
                min_price = excluded.min_price,
                max_price = excluded.max_price,
                stock_quantity = excluded.stock_quantity,
                stock_status = excluded.stock_status,
                onsale = excluded.onsale;\n
        `;

        fs.writeFileSync('sync_one.sql', sql);
        console.log('Executing D1 update...');
        execSync(`npx wrangler d1 execute shopwice-db --remote --yes --file=sync_one.sql`, { stdio: 'inherit' });

        console.log('Invalidating cache...');
        const timestamp = Date.now().toString();
        execSync(`npx wrangler kv key put --binding shopwice_cache "product_list_version" "${timestamp}" --remote`, { stdio: 'inherit' });

        console.log(`✅ Success! Product ${p.id} synced with categories/meta and cache invalidated.`);
        fs.unlinkSync('sync_one.sql');
    } catch (e) {
        console.error('Sync failed:', e);
    }
}

const targetSlug = process.argv[2] || 'sony-wh-ch520-wireless-headphones-bluetooth-on-ear-headset';
syncProduct(targetSlug);
