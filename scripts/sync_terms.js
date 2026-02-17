
const fs = require('fs');
const path = require('path');
const https = require('https');

// Config
const SITE_URL = 'https://shopwice.com';
const CK = process.env.WC_CONSUMER_KEY || 'ck_fb44dd511071306357e91233109bb5725639d88c';
const CS = process.env.WC_CONSUMER_SECRET || 'cs_41c396912693a16097ef527101b8c6747e448372';

// Fetch helper
async function fetchJson(endpoint, params = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(SITE_URL + endpoint);
        // Add Auth if WC endpoint
        if (endpoint.includes('/wc/v3/') || endpoint.includes('/wp/v2/')) {
            url.searchParams.append('consumer_key', CK);
            url.searchParams.append('consumer_secret', CS);
        }
        Object.keys(params).forEach(k => url.searchParams.append(k, params[k]));

        console.log(`Fetching ${url.toString()}...`);
        https.get(url.toString(), {
            headers: { 'User-Agent': 'NodeJS Sync Script' }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

// SQL helper
const esc = (str) => str ? String(str).replace(/'/g, "''") : '';

async function syncTaxonomy(taxonomy, endpoint) {
    console.log(`\n--- Syncing ${taxonomy} ---`);
    let page = 1;
    let allTerms = [];
    
    while (true) {
        try {
            const terms = await fetchJson(endpoint, { per_page: 100, page: page });
            if (terms.length === 0) break;
            allTerms = allTerms.concat(terms);
            console.log(`Page ${page}: Fetched ${terms.length} terms.`);
            page++;
        } catch (e) {
            console.error(`Error fetching page ${page}:`, e.message);
            break;
        }
    }
    
    console.log(`Total ${taxonomy} terms: ${allTerms.length}`);
    if (allTerms.length === 0) return [];

    const queries = [];
    
    for (const term of allTerms) {
        // WC API returns flat object, but DB needs split
        // wp_terms: term_id, name, slug, term_group
        queries.push(`INSERT OR IGNORE INTO wp_terms (term_id, name, slug, term_group) VALUES (${term.id}, '${esc(term.name)}', '${esc(term.slug)}', 0);`);
        
        // wp_term_taxonomy: term_taxonomy_id, term_id, taxonomy, description, parent, count
        // Note: WC API usually uses same ID for term_id and term_taxonomy_id, but not always guaranteed in WP core.
        // For simplicity in sync, we assume term_id = term_taxonomy_id or let DB handle autoincrement if we could, 
        // but D1 doesn't support easy "ON DUPLICATE KEY UPDATE" with different IDs.
        // Let's assume 1:1 mapping for imported data.
        queries.push(`INSERT OR IGNORE INTO wp_term_taxonomy (term_taxonomy_id, term_id, taxonomy, description, parent, count) VALUES (${term.id}, ${term.id}, '${taxonomy}', '${esc(term.description)}', ${term.parent || 0}, ${term.count || 0});`);

        // Image? WC Categories have 'image' object
        if (term.image && term.image.id) {
            queries.push(`INSERT OR IGNORE INTO wp_termmeta (term_id, meta_key, meta_value) VALUES (${term.id}, 'thumbnail_id', '${term.image.id}');`);
        }
    }
    
    return queries;
}

async function main() {
    const allQueries = [];
    
    // 1. Categories
    const catQueries = await syncTaxonomy('product_cat', '/wp-json/wc/v3/products/categories');
    allQueries.push(...catQueries);
    
    // 2. Tags
    const tagQueries = await syncTaxonomy('product_tag', '/wp-json/wc/v3/products/tags');
    allQueries.push(...tagQueries);

    // 3. Brands (Try standard WP endpoint if WC one doesn't exist, but usually exposed via plugin)
    // Common brand plugins expose to REST. Let's try to fetch from WP Terms directly if we know the slug?
    // Or check if WC has a brands endpoint. Official WC Brands is /wc/v3/products/brands
    // Let's try that.
    try {
        const brandQueries = await syncTaxonomy('product_brand', '/wp-json/wc/v3/products/brands');
        allQueries.push(...brandQueries);
    } catch (e) {
        console.log('Skipping brands (endpoint not found or error)');
    }

    // 4. Locations (Custom Taxonomy - exposed via WP REST API)
    try {
        const locationQueries = await syncTaxonomy('product_location', '/wp-json/wp/v2/product_location');
        allQueries.push(...locationQueries);
    } catch (e) {
        console.log('Skipping locations (endpoint not found or error):', e.message);
    }

    // Write to file
    const sqlPath = path.join(__dirname, 'sync_terms.sql');
    fs.writeFileSync(sqlPath, allQueries.join('\n'));
    console.log(`\nGenerated ${allQueries.length} SQL statements in ${sqlPath}`);
    
    // Execute
    console.log('Executing on D1...');
    const { execSync } = require('child_process');
    try {
        // Split into chunks if too large (D1 limit is 100MB but query count matters)
        // We'll just run it. If it fails due to size, we can split.
        execSync(`npx wrangler d1 execute shopwice-db --file="${sqlPath}" --remote`, { stdio: 'inherit' });
        console.log('Sync Complete!');
    } catch (e) {
        console.error('Execution Failed:', e.message);
    }
}

main();
