const fs = require('fs');
const https = require('https');
const { URL } = require('url');

// Configuration
const CK = 'ck_fb44dd511071306357e91233109bb5725639d88c';
const CS = 'cs_41c396912693a16097ef527101b8c6747e448372';
const SITE_URL = 'https://shopwice.com';
const OUTPUT_SQL = 'seed_full.sql';

// Helper to fetch JSON with retry
async function fetchJson(endpoint, params = {}, retries = 3) {
    return new Promise((resolve, reject) => {
        const attempt = async (n) => {
            try {
                // Ensure endpoint does not have double slashes if concatenated
                const cleanEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
                const fullUrl = endpoint.startsWith('http') ? endpoint : `${SITE_URL}${cleanEndpoint}`;
                
                const url = new URL(fullUrl);
                
                // Add Auth if WC endpoint
                if (endpoint.includes('/wc/v3/')) {
                    url.searchParams.append('consumer_key', CK);
                    url.searchParams.append('consumer_secret', CS);
                }
                
                Object.keys(params).forEach(k => url.searchParams.append(k, params[k]));

                console.log(`⬇️ Fetching ${url.toString().replace(CK, '***').replace(CS, '***')} (Attempt ${4 - n})...`);

                const options = {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Accept': 'application/json'
                    },
                    timeout: 60000 // 60s timeout
                };

                const req = https.get(url.toString(), options, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        if (res.statusCode >= 400) {
                            if (n > 1 && (res.statusCode >= 500 || res.statusCode === 429)) {
                                console.log(`   ⚠️ Error ${res.statusCode}, retrying...`);
                                setTimeout(() => attempt(n - 1), 2000);
                                return;
                            }
                            // Try to parse error
                            try {
                                const err = JSON.parse(data);
                                reject(new Error(`API Error ${res.statusCode}: ${err.message || JSON.stringify(err)}`));
                            } catch {
                                reject(new Error(`API Error ${res.statusCode}: ${data.substring(0, 100)}`));
                            }
                            return;
                        }
                        try {
                            const json = JSON.parse(data);
                            resolve(json);
                        } catch (e) {
                            reject(e);
                        }
                    });
                });
                
                req.on('error', (err) => {
                    if (n > 1) {
                         console.log(`   ⚠️ Network error ${err.message}, retrying...`);
                         setTimeout(() => attempt(n - 1), 2000);
                    } else {
                        reject(err);
                    }
                });
                
            } catch (err) {
                reject(err);
            }
        };
        attempt(retries);
    });
}

// Helper to escape SQL strings
const esc = (str) => {
    if (str === null || str === undefined) return 'NULL';
    if (typeof str === 'number') return str;
    return `'${String(str).replace(/'/g, "''").replace(/\\/g, '\\\\')}'`;
};

// Process all pages with a callback
async function processAllPages(endpoint, params = {}, processPage) {
    let page = 1;
    let keepFetching = true;

    while (keepFetching) {
        try {
            // Add minimal delay to avoid rate limiting
            await new Promise(r => setTimeout(r, 2000));
            
            const data = await fetchJson(endpoint, { ...params, per_page: 20, page });
            if (!data || data.length === 0) {
                keepFetching = false;
            } else {
                await processPage(data);
                console.log(`   ✅ Processed ${data.length} items (Page ${page})`);
                page++;
            }
        } catch (e) {
            console.error(`   ⚠️ Error processing page ${page} of ${endpoint}: ${e.message}. Stopping pagination.`);
            keepFetching = false;
        }
    }
}

async function run() {
    let sql = `-- Auto-generated Seed File from Shopwice.com\n`;
    sql += `-- Generated at ${new Date().toISOString()}\n\n`;
    sql += `PRAGMA defer_foreign_keys = ON;\n\n`;

    // Save periodically helper
    const saveFile = () => {
        fs.writeFileSync(OUTPUT_SQL, sql);
        console.log(`💾 Saved progress to ${OUTPUT_SQL} (${sql.length} bytes)`);
    };

    try {
        // 1. Attributes
        console.log("\n📦 Fetching Attributes...");
        const attributes = await fetchJson('/wp-json/wc/v3/products/attributes');
        
        for (const attr of attributes) {
            sql += `INSERT OR REPLACE INTO wp_woocommerce_attribute_taxonomies (attribute_id, attribute_name, attribute_label, attribute_type, attribute_orderby, attribute_public) VALUES (${attr.id}, ${esc(attr.slug.replace('pa_', ''))}, ${esc(attr.name)}, ${esc(attr.type)}, ${esc(attr.order_by)}, ${attr.has_archives ? 1 : 0});\n`;
            
            // Fetch Terms for this Attribute
            console.log(`   Fetching terms for ${attr.slug}...`);
            await processAllPages(`/wp-json/wc/v3/products/attributes/${attr.id}/terms`, {}, (terms) => {
                for (const term of terms) {
                    sql += `INSERT OR REPLACE INTO wp_terms (term_id, name, slug, term_group) VALUES (${term.id}, ${esc(term.name)}, ${esc(term.slug)}, 0);\n`;
                    sql += `INSERT OR REPLACE INTO wp_term_taxonomy (term_taxonomy_id, term_id, taxonomy, description, parent, count) VALUES (${term.id}, ${term.id}, ${esc(attr.slug)}, ${esc(term.description)}, ${term.parent || 0}, ${term.count || 0});\n`;
                }
            });
        }
        saveFile();

        // 2. Categories
        console.log("\n📂 Fetching Categories...");
        await processAllPages('/wp-json/wc/v3/products/categories', {}, (categories) => {
            for (const cat of categories) {
                sql += `INSERT OR REPLACE INTO wp_terms (term_id, name, slug, term_group) VALUES (${cat.id}, ${esc(cat.name)}, ${esc(cat.slug)}, 0);\n`;
                sql += `INSERT OR REPLACE INTO wp_term_taxonomy (term_taxonomy_id, term_id, taxonomy, description, parent, count) VALUES (${cat.id}, ${cat.id}, 'product_cat', ${esc(cat.description)}, ${cat.parent || 0}, ${cat.count || 0});\n`;
            }
        });
        saveFile();

        // 3. Tags
        console.log("\n🏷️ Fetching Tags...");
        await processAllPages('/wp-json/wc/v3/products/tags', {}, (tags) => {
            for (const tag of tags) {
                sql += `INSERT OR REPLACE INTO wp_terms (term_id, name, slug, term_group) VALUES (${tag.id}, ${esc(tag.name)}, ${esc(tag.slug)}, 0);\n`;
                sql += `INSERT OR REPLACE INTO wp_term_taxonomy (term_taxonomy_id, term_id, taxonomy, description, parent, count) VALUES (${tag.id}, ${tag.id}, 'product_tag', ${esc(tag.description)}, 0, ${tag.count || 0});\n`;
            }
        });
        saveFile();

        // 4. Brands (Custom Taxonomy)
        console.log("\n🏢 Fetching Brands...");
        await processAllPages('/wp-json/wp/v2/product_brand', {}, (brands) => {
            if (Array.isArray(brands)) {
                for (const brand of brands) {
                    sql += `INSERT OR REPLACE INTO wp_terms (term_id, name, slug, term_group) VALUES (${brand.id}, ${esc(brand.name)}, ${esc(brand.slug)}, 0);\n`;
                    const desc = brand.description || '';
                    sql += `INSERT OR REPLACE INTO wp_term_taxonomy (term_taxonomy_id, term_id, taxonomy, description, parent, count) VALUES (${brand.id}, ${brand.id}, 'product_brand', ${esc(desc)}, ${brand.parent || 0}, ${brand.count || 0});\n`;
                }
            }
        });
        saveFile();

        // 5. Locations (Custom Taxonomy)
        console.log("\n🌍 Fetching Locations...");
        await processAllPages('/wp-json/wp/v2/product_location', {}, (locations) => {
            if (Array.isArray(locations)) {
                for (const loc of locations) {
                    sql += `INSERT OR REPLACE INTO wp_terms (term_id, name, slug, term_group) VALUES (${loc.id}, ${esc(loc.name)}, ${esc(loc.slug)}, 0);\n`;
                    const desc = loc.description || '';
                    sql += `INSERT OR REPLACE INTO wp_term_taxonomy (term_taxonomy_id, term_id, taxonomy, description, parent, count) VALUES (${loc.id}, ${loc.id}, 'product_location', ${esc(desc)}, ${loc.parent || 0}, ${loc.count || 0});\n`;
                }
            }
        });
        saveFile();

        // 6. Products 
        console.log("\n🛍️ Fetching Products...");
        await processAllPages('/wp-json/wc/v3/products', {}, (products) => {
            for (const p of products) {
                const date = p.date_created || new Date().toISOString();
                const dateGmt = p.date_created_gmt || new Date().toISOString();
                
                sql += `INSERT OR REPLACE INTO wp_posts (ID, post_author, post_date, post_date_gmt, post_content, post_title, post_excerpt, post_status, comment_status, ping_status, post_name, post_modified, post_modified_gmt, post_parent, guid, post_type, menu_order) VALUES (${p.id}, 1, ${esc(date)}, ${esc(dateGmt)}, ${esc(p.description)}, ${esc(p.name)}, ${esc(p.short_description)}, ${esc(p.status)}, 'open', 'closed', ${esc(p.slug)}, ${esc(p.date_modified)}, ${esc(p.date_modified_gmt)}, ${p.parent_id}, ${esc(p.permalink)}, 'product', ${p.menu_order});\n`;
                
                // Meta
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
                    '_thumbnail_id': (p.images && p.images.length > 0) ? p.images[0].id : null
                };
                for (const [key, val] of Object.entries(meta)) {
                    if (val !== undefined && val !== null) {
                        sql += `INSERT OR REPLACE INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (${p.id}, ${esc(key)}, ${esc(val)});\n`;
                    }
                }
                
                // Relationships
                const allTerms = [
                    ...(p.categories || []).map(c => c.id),
                    ...(p.tags || []).map(t => t.id),
                    ...(p.brands || []).map(b => b.id),
                    ...(p.locations || []).map(l => l.id)
                ];
                
                for (const termId of allTerms) {
                    if (termId) {
                        sql += `INSERT OR REPLACE INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (${p.id}, ${termId}, 0);\n`;
                    }
                }
            }
        });

        fs.writeFileSync(OUTPUT_SQL, sql);
        console.log(`\n✅ Generated ${OUTPUT_SQL} with ${sql.length} bytes.`);

    } catch (error) {
        console.error("❌ Fatal Error:", error);
        if (sql.length > 100) {
            console.log("⚠️ Saving partial data...");
            fs.writeFileSync(OUTPUT_SQL, sql);
            console.log(`💾 Saved partial ${OUTPUT_SQL}`);
        }
    }
}

run();
