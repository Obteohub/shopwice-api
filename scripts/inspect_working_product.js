
require('dotenv').config();
// const fetch = require('node-fetch');

const WC_URL = process.env.WC_URL;
const CONSUMER_KEY = process.env.WC_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.WC_CONSUMER_SECRET;
const VENDOR_ID = 16533; // kwessi@gmail.com

if (!WC_URL || !CONSUMER_KEY || !CONSUMER_SECRET) {
    console.error('Missing env vars');
    process.exit(1);
}

const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${auth}`
};

async function inspectProduct() {
    console.log('Inspecting created product 207151...');
    
    try {
        const url = `${WC_URL}/wp-json/wc/v3/products/207151`;
        console.log(`GET ${url}`);
        const res = await fetch(url, { headers });
        if (!res.ok) {
            console.error('Error fetching product:', res.status);
            const text = await res.text();
            console.log(text);
            return;
        }

        const product = await res.json();
        console.log('--------------------------------------------------');
        console.log(`Product ID: ${product.id}`);
        console.log(`Name: ${product.name}`);
        console.log(`Slug: ${product.slug}`);
        console.log(`Status: ${product.status}`);
        console.log(`Post Author (Core WP): ${product.post_author || product.author}`);
        
        console.log('\n--- Meta Data (Relevant to WCFM) ---');
        const relevantKeys = ['_wcfm_product_author', '_wcfm_product_views', '_wcfmmp_product_commission', '_wcfm_product_policy'];
        product.meta_data.forEach(m => {
            if (relevantKeys.includes(m.key) || m.key.includes('wcfm')) {
                console.log(`${m.key}: ${m.value}`);
            }
        });

        console.log('\n--- Store Info (if available in response) ---');
        if (product.store) {
            console.log('Store Object:', JSON.stringify(product.store, null, 2));
        } else {
            console.log('Store Object: MISSING');
        }
        
    } catch (e) {
        console.error('Exception:', e.message);
    }
}

inspectProduct();
