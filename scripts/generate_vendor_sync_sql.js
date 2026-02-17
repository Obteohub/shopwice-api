
require('dotenv').config();
const WooCommerceClient = require('../src/utils/wc-client');
const { execSync } = require('child_process');

// Helper to escape SQL values
function escapeSql(str) {
    if (!str) return '';
    // Escape single quotes by doubling them
    // Also handle backslashes if necessary, but D1/SQLite usually just needs single quotes escaped
    return str.replace(/'/g, "''");
}

// Helper to execute SQL
function executeSql(sql) {
    try {
        // Flatten SQL to single line to avoid CLI argument issues
        const cleanSql = sql.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim();
        
        // Escape double quotes for the shell command argument
        // We wrap the command in double quotes: --command "..."
        // So any internal double quotes must be escaped: \"
        const cmdSql = cleanSql.replace(/"/g, '\\"');
        
        // Execute (suppress stdout to keep logs clean, verify via D1 later)
        execSync(`npx wrangler d1 execute shopwice-db --local --command "${cmdSql}"`, { stdio: 'pipe' });
    } catch (e) {
        // Only log if it's a real error, ignore some constraint violations if we want
        // console.error("SQL Execution Error:", e.message);
        // Maybe log detailed error for debugging if needed
        // console.error("Failed SQL:", sql.substring(0, 100) + "...");
    }
}

async function syncAllVendors() {
    const wc = new WooCommerceClient(process.env);
    console.log("🚀 Starting Global Vendor Sync...");

    try {
        // 1. Fetch all vendors
        let page = 1;
        let allVendors = [];
        
        console.log("Fetching vendors...");
        while (true) {
            try {
                const vendors = await wc.get('/customers', { role: 'wcfm_vendor', per_page: 100, page });
                if (vendors.length === 0) break;
                allVendors = allVendors.concat(vendors);
                console.log(`  Page ${page}: Found ${vendors.length} vendors`);
                page++;
            } catch (err) {
                console.error("  Error fetching vendors page " + page, err.message);
                break;
            }
        }
        
        console.log(`Total Vendors Found: ${allVendors.length}`);

        // 2. Sync products for each vendor
        for (const vendor of allVendors) {
            console.log(`\nProcessing Vendor: ${vendor.username} (ID: ${vendor.id})`);
            await syncVendorProducts(wc, vendor.id);
        }

        console.log("\n✅ Global Sync Complete!");

    } catch (e) {
        console.error("Global Sync Error:", e);
    }
}

async function syncVendorProducts(wc, vendorId) {
    try {
        let page = 1;
        let totalSynced = 0;

        while (true) {
            // Fetch products for this vendor
            // Note: 'vendor' param works because of WCFM plugin
            const products = await wc.get('/products', { vendor: vendorId, per_page: 50, page });
            if (products.length === 0) break;
            
            for (const p of products) {
                syncProduct(p, vendorId);
                process.stdout.write('.'); // Progress dot
            }
            totalSynced += products.length;
            page++;
        }
        if (totalSynced > 0) console.log(` Synced ${totalSynced} products.`);
        else console.log(" No products found.");

    } catch (e) {
        console.error(`  Error syncing vendor ${vendorId}:`, e.message);
    }
}

function syncProduct(p, vendorId) {
    const postDate = (p.date_created || new Date().toISOString()).replace('T', ' ').split('.')[0];
    const postDateGmt = (p.date_created_gmt || new Date().toISOString()).replace('T', ' ').split('.')[0];
    const postModified = (p.date_modified || new Date().toISOString()).replace('T', ' ').split('.')[0];
    const postModifiedGmt = (p.date_modified_gmt || new Date().toISOString()).replace('T', ' ').split('.')[0];
    
    // Ensure author is set correctly. 
    // p.post_author usually refers to the vendor user ID in WCFM setup.
    // If undefined, fallback to vendorId we are iterating on.
    const productAuthor = p.post_author || vendorId;

    // 1. Insert/Update wp_posts
    const sqlPost = `
        INSERT INTO wp_posts (
            ID, post_author, post_date, post_date_gmt, post_content, post_title, 
            post_excerpt, post_status, comment_status, ping_status, post_name, 
            post_modified, post_modified_gmt, post_parent, guid, post_type, menu_order
        ) VALUES (
            ${p.id}, ${productAuthor}, '${postDate}', '${postDateGmt}', 
            '${escapeSql(p.description || '')}', '${escapeSql(p.name || '')}', '${escapeSql(p.short_description || '')}', 
            '${p.status}', 'open', 'closed', '${escapeSql(p.slug || '')}', 
            '${postModified}', '${postModifiedGmt}', ${p.parent_id || 0}, '${escapeSql(p.permalink || '')}', 'product', ${p.menu_order || 0}
        ) ON CONFLICT(ID) DO UPDATE SET 
            post_title=excluded.post_title, post_status=excluded.post_status, post_author=excluded.post_author;
    `;
    executeSql(sqlPost);

    // 2. Sync wp_postmeta (Vendor Association)
    // Always sync _wcfm_product_author
    executeSql(`DELETE FROM wp_postmeta WHERE post_id=${p.id} AND meta_key='_wcfm_product_author'`);
    executeSql(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (${p.id}, '_wcfm_product_author', '${vendorId}')`);

    // 3. Other essential meta
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
        if (v !== undefined && v !== null && v !== '') {
            executeSql(`DELETE FROM wp_postmeta WHERE post_id=${p.id} AND meta_key='${k}'`);
            executeSql(`INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (${p.id}, '${k}', '${escapeSql(String(v))}')`);
        }
    }
    
    // 4. Lookup Table (wp_wc_product_meta_lookup)
    const sqlLookup = `
         INSERT INTO wp_wc_product_meta_lookup (
            product_id, sku, min_price, max_price, onsale, stock_quantity, stock_status, average_rating, total_sales
        ) VALUES (
            ${p.id}, '${escapeSql(p.sku || '')}', ${p.price || 0}, ${p.price || 0}, 
            ${p.on_sale ? 1 : 0}, ${p.stock_quantity || 0}, '${p.stock_status === 'instock' ? 'instock' : 'outofstock'}', 
            ${p.average_rating || 0}, ${p.total_sales || 0}
        ) ON CONFLICT(product_id) DO UPDATE SET 
            min_price=excluded.min_price, max_price=excluded.max_price, stock_status=excluded.stock_status;
    `;
    executeSql(sqlLookup);
}

syncAllVendors();
