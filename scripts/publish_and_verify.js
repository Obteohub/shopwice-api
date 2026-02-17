require('dotenv').config();
const WooCommerceClient = require('../src/utils/wc-client');

async function publishAndVerify() {
    const wc = new WooCommerceClient({
        WC_URL: process.env.WC_URL,
        WC_CONSUMER_KEY: process.env.WC_CONSUMER_KEY,
        WC_CONSUMER_SECRET: process.env.WC_CONSUMER_SECRET
    });
    
    const userId = 16533;
    const productsToPublish = [207148, 207150];

    try {
        // 1. Publish Products
        for (const id of productsToPublish) {
            console.log(`Publishing product ${id}...`);
            await wc.post(`/products/${id}`, { status: 'publish' });
        }
        
        console.log('Waiting for potential async indexing (2s)...');
        await new Promise(r => setTimeout(r, 2000));

        // 2. Fetch Vendor Products
        console.log(`Fetching PUBLISHED products for Vendor ${userId}...`);
        
        // We can't use /products?vendor_id=... with standard client unless WCFM REST is active and reachable.
        // But we can filter by author if standard WP API supports it (it does).
        // Or we can fetch all and filter manually to see what's returned.
        
        // Let's try standard WC API with author filter
        const products = await wc.get('/products', { 
            author: userId, 
            status: 'publish',
            per_page: 50 
        });
        
        console.log(`Found ${products.length} published products for this vendor.`);
        
        const foundIds = products.map(p => p.id);
        
        productsToPublish.forEach(id => {
            if (foundIds.includes(id)) {
                console.log(`✅ Product ${id} IS visible in vendor list.`);
            } else {
                console.log(`❌ Product ${id} is NOT visible in vendor list.`);
            }
        });
        
        // Debug first found product to see author fields
        if (products.length > 0) {
            const p = products[0];
            console.log(`Sample Product [${p.id}]: Author=${p.post_author}, WCFM Meta=${getMeta(p, '_wcfm_product_author')}`);
        }

    } catch (e) {
        console.error('Error:', e.message);
        if (e.data) console.error(JSON.stringify(e.data, null, 2));
    }
}

function getMeta(p, key) {
    if (!p.meta_data) return 'N/A';
    const m = p.meta_data.find(x => x.key === key);
    return m ? m.value : 'Not found';
}

publishAndVerify();
