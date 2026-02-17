
require('dotenv').config();
const WooCommerceClient = require('../src/utils/wc-client');

async function run() {
    const wc = new WooCommerceClient(process.env);
    console.log("Fetching products...");

    try {
        const vendorId = 16326; 
        console.log(`Fetching products for vendor ${vendorId} using 'vendor' param...`);
        
        const products = await wc.get('/products', { vendor: vendorId });
        
        console.log(`Found ${products.length} products.`);
        if (products.length > 0) {
            console.log("First product:", products[0].id, products[0].name);
        } else {
             console.log("No products found with 'vendor' param.");
        }

    } catch (e) {
        console.error("Error fetching products:", e);
    }
}

run();
