require('dotenv').config();
const WooCommerceClient = require('../src/utils/wc-client');

async function inspectProduct() {
    const wc = new WooCommerceClient({
        WC_URL: process.env.WC_URL,
        WC_CONSUMER_KEY: process.env.WC_CONSUMER_KEY,
        WC_CONSUMER_SECRET: process.env.WC_CONSUMER_SECRET
    });

    try {
        const productId = 207150;
        console.log(`Inspecting Product ${productId}...`);
        
        const p = await wc.get(`/products/${productId}`);
        
        console.log('Product Data:');
        console.log('ID:', p.id);
        console.log('Name:', p.name);
        console.log('Status:', p.status);
        console.log('Post Author (WC V3 doesn\'t always expose this):', p.post_author); // Usually undefined in V3
        
        console.log('Meta Data:');
        if (p.meta_data) {
            p.meta_data.forEach(m => {
                if (m.key.includes('author') || m.key.includes('vendor') || m.key.includes('wcfm')) {
                    console.log(`- ${m.key}: ${m.value}`);
                }
            });
        }

        // Check if we can see post_author via WP API
        const auth = btoa(`${process.env.WC_CONSUMER_KEY}:${process.env.WC_CONSUMER_SECRET}`);
        const baseUrl = process.env.WC_URL || 'https://shopwice.com';
        
        console.log('\nFetching via WP API to check post_author...');
        const res = await fetch(`${baseUrl}/wp-json/wp/v2/product/${productId}`, {
             headers: { 'Authorization': `Basic ${auth}` }
        });
        
        if (res.ok) {
            const wpProduct = await res.json();
            console.log('WP API Author:', wpProduct.author);
        } else {
            console.log('WP API Fetch Failed:', res.status, res.statusText);
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

inspectProduct();
