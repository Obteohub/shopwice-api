
const https = require('https');
const CK = 'ck_fb44dd511071306357e91233109bb5725639d88c';
const CS = 'cs_41c396912693a16097ef527101b8c6747e448372';
const SITE_URL = 'https://shopwice.com';

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    console.error("Parse Error for URL:", url);
                    console.error("Response:", data.substring(0, 200));
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function checkEndpoints() {
    const auth = `consumer_key=${CK}&consumer_secret=${CS}`;
    
    // Check Attributes
    console.log("Checking Attributes...");
    try {
        const attrs = await fetchJson(`${SITE_URL}/wp-json/wc/v3/products/attributes?${auth}`);
        console.log("Attributes found:", attrs.map(a => a.slug).join(', '));
    } catch (e) { console.error("Attributes failed", e.message); }

    // Check custom taxonomies for Brands
    const brandTaxonomies = ['product_brand', 'pwb-brand', 'brand'];
    for (const tax of brandTaxonomies) {
        console.log(`Checking ${tax}...`);
        try {
            // Try standard WP V2 API for custom taxonomies
            const terms = await fetchJson(`${SITE_URL}/wp-json/wp/v2/${tax}?per_page=1`);
            if (terms && terms.length > 0) {
                console.log(`✅ Found terms for ${tax}`);
            } else if (terms && terms.code) {
                 console.log(`❌ ${tax}: ${terms.code}`);
            } else {
                 console.log(`⚠️ ${tax} returned empty or invalid.`);
            }
        } catch (e) { 
            // console.log(`Failed ${tax}`); 
        }
    }
}

checkEndpoints();
