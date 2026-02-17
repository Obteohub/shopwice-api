
require('dotenv').config();
// const fetch = require('node-fetch');

const WC_URL = process.env.WC_URL;
const CONSUMER_KEY = process.env.WC_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.WC_CONSUMER_SECRET;
const VENDOR_ID = 16533;
const PRODUCT_ID = 207151;

if (!WC_URL || !CONSUMER_KEY || !CONSUMER_SECRET) {
    console.error('Missing env vars');
    process.exit(1);
}

const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${auth}`
};

async function fixAuthor() {
    console.log(`Attempting to set author to ${VENDOR_ID} for product ${PRODUCT_ID}...`);
    
    try {
        const url = `${WC_URL}/wp-json/wc/v3/products/${PRODUCT_ID}`;
        console.log(`PUT ${url}`);
        
        // Try setting 'author' (standard WC)
        const body = {
            author: VENDOR_ID
        };

        const res = await fetch(url, { 
            method: 'PUT',
            headers,
            body: JSON.stringify(body)
        });
        
        if (!res.ok) {
            console.error('Error updating product:', res.status);
            const text = await res.text();
            console.log(text);
            return;
        }

        const product = await res.json();
        console.log('Update Success.');
        console.log(`Post Author (Core WP): ${product.post_author || product.author}`);
        
        console.log('\n--- Store Info ---');
        console.log('Store Object:', JSON.stringify(product.store || {}, null, 2));
        
    } catch (e) {
        console.error('Exception:', e.message);
    }
}

fixAuthor();
