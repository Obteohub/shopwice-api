require('dotenv').config();
const WooCommerceClient = require('../src/utils/wc-client');

async function findUserAndCreateProduct() {
    const wc = new WooCommerceClient({
        WC_URL: process.env.WC_URL,
        WC_CONSUMER_KEY: process.env.WC_CONSUMER_KEY,
        WC_CONSUMER_SECRET: process.env.WC_CONSUMER_SECRET
    });

    try {
        console.log('Searching for user kwessi@gmail.com...');
        
        // Try searching via WC Customers API with role=all
        // Note: 'role' param might not be supported by all versions, but let's try.
        let users = await wc.get('/customers', { email: 'kwessi@gmail.com', role: 'all' });
        
        if (users.length === 0) {
            console.log('Not found with role=all, trying role=wcfm_vendor...');
            users = await wc.get('/customers', { email: 'kwessi@gmail.com', role: 'wcfm_vendor' });
        }

        if (users.length === 0) {
             console.error('User kwessi@gmail.com not found via WC API (Customers endpoint).');
             return;
        }

        const user = users[0];
        console.log(`Found user: ${user.username} (ID: ${user.id}, Role: ${user.role})`);

        // Create Product
        const productData = {
            name: 'Test Product for Kwessi',
            type: 'simple',
            regular_price: '25.00',
            description: 'This is a test product created via API for vendor verification.',
            short_description: 'Test product.',
            status: 'publish',
            categories: [
                { id: 15 } 
            ],
            meta_data: [
                 { key: '_wcfm_product_author', value: user.id }
            ]
        };
 
        console.log('Creating product...');
        const product = await wc.post('/products', productData);
        console.log(`Product created: ID ${product.id}`);
         
     } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
}

findUserAndCreateProduct();
