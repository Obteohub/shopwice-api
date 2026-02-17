require('dotenv').config();
const WooCommerceClient = require('../src/utils/wc-client');

async function createAndFetch() {
    const wc = new WooCommerceClient({
        WC_URL: process.env.WC_URL,
        WC_CONSUMER_KEY: process.env.WC_CONSUMER_KEY,
        WC_CONSUMER_SECRET: process.env.WC_CONSUMER_SECRET
    });

    const vendorId = 16533; // kwessi@gmail.com
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const productName = `Vendor Product Auto-Test ${timestamp}`;

    console.log(`1. Creating product "${productName}" for vendor ${vendorId}...`);

    try {
        // Create Product
        const productData = {
            name: productName,
            type: 'simple',
            regular_price: '50.00',
            description: 'Created via createAndFetch script',
            short_description: 'Vendor Verification',
            status: 'publish', // Publish immediately to be seen in lists
            categories: [{ id: 15 }],
            author: vendorId, // Assign to vendor
            meta_data: [
                { key: '_wcfm_product_author', value: vendorId },
                { key: '_wcfm_product_views', value: '0' }
            ]
        };

        const createdProduct = await wc.post('/products', productData);
        console.log(`✅ Product Created: ID ${createdProduct.id}`);
        console.log(`   - Assigned Author: ${createdProduct.post_author}`);
        
        // Wait a moment for indexing/propagation if any
        await new Promise(r => setTimeout(r, 2000));

        console.log(`\n2. Fetching ALL products for vendor ${vendorId}...`);
        
        // Fetch products filtered by author
        const vendorProducts = await wc.get('/products', {
            author: vendorId,
            per_page: 100, // Fetch enough to find it
            status: 'any'
        });

        console.log(`Found ${vendorProducts.length} products for this vendor.`);

        // Verify if the new product is in the list
        const found = vendorProducts.find(p => p.id === createdProduct.id);

        if (found) {
            console.log(`✅ SUCCESS: New product ${createdProduct.id} ("${found.name}") was found in the vendor's product list.`);
            console.log(`   - List Item Author: ${found.post_author}`);
            const meta = found.meta_data.find(m => m.key === '_wcfm_product_author');
            console.log(`   - List Item WCFM Meta: ${meta ? meta.value : 'Missing'}`);
        } else {
            console.error(`❌ FAILURE: New product ${createdProduct.id} was NOT found in the vendor's product list.`);
            console.log("Recent products in list:");
            vendorProducts.slice(0, 5).forEach(p => console.log(` - ${p.id}: ${p.name} (Author: ${p.post_author})`));
        }

    } catch (error) {
        console.error('Error:', error.message);
        if (error.data) console.error(JSON.stringify(error.data, null, 2));
    }
}

createAndFetch();
