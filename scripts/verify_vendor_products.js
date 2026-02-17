require('dotenv').config();
const WooCommerceClient = require('../src/utils/wc-client');

async function checkVendorProducts() {
    const env = {
        WC_URL: process.env.WC_URL,
        WC_CONSUMER_KEY: process.env.WC_CONSUMER_KEY,
        WC_CONSUMER_SECRET: process.env.WC_CONSUMER_SECRET
    };
    
    // Use standard WooCommerce Client
    const wc = new WooCommerceClient(env);
    const userId = 16533;
    const productId = 207150; 

    console.log(`Fetching products for Vendor ${userId} via WooCommerce API...`);

    try {
        // Fetch recent products without author filter first to debug
        console.log('Fetching recent products...');
        const products = await wc.get('/products', { per_page: 20, status: 'any' }); 
        
        console.log(`Found ${products.length} products.`);
        
        const found = products.find(p => p.id === productId);
        
        if (found) {
            console.log(`✅ Product ${productId} IS in the recent list.`);
            console.log('Product Status:', found.status);
            console.log('Product Author (Post Author):', found.post_author); 
            // Check meta
            const meta = found.meta_data.find(m => m.key === '_wcfm_product_author');
            console.log('WCFM Author Meta:', meta ? meta.value : 'Not found');
            
            if (found.post_author == userId || (meta && meta.value == userId)) {
                 console.log('Ownership verification: MATCH');
            } else {
                 console.log('Ownership verification: MISMATCH');
            }
        } else {
            console.log(`❌ Product ${productId} is NOT in the recent list.`);
            console.log('Recent products found:', products.map(p => `${p.id}: ${p.name}`).join(', '));
        }

    } catch (e) {
        console.error('Error fetching WCFM products:', e.message);
        if (e.data) console.error(JSON.stringify(e.data, null, 2));
    }
}

checkVendorProducts();
