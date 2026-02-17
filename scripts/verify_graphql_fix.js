require('dotenv').config();
const { resolvers } = require('../src/graphql/resolvers');
const WooCommerceClient = require('../src/utils/wc-client');

// Mock context
const context = {
    user: {
        id: 16533,
        role: 'wcfm_vendor',
        email: 'kwessi@gmail.com'
    },
    env: {
        WC_URL: process.env.WC_URL,
        WC_CONSUMER_KEY: process.env.WC_CONSUMER_KEY,
        WC_CONSUMER_SECRET: process.env.WC_CONSUMER_SECRET,
        // Mock D1 DB interface if needed, but resolvers use `db` module which uses `better-sqlite3` or similar?
        // Wait, `resolvers.js` requires `../config/db`. 
        // `src/config/db.js` likely handles the DB connection.
        // Let's check if it needs env or if it works locally.
    }
};

async function verify() {
    try {
        console.log('Simulating createProduct mutation as vendor...');
        
        const input = {
            name: 'Test Product GraphQL Fix',
            type: 'simple',
            regularPrice: '30.00',
            description: 'Created via verify script',
            shortDescription: 'Test',
            status: 'publish',
            categories: [{ id: 15 }]
        };

        // Call the resolver
        // Note: resolvers.js imports db. If db depends on Cloudflare D1 binding, this script might fail 
        // unless I mocked db or if `src/config/db.js` supports local execution.
        // I checked `src/config/db.js` before? No.
        // Let's try.
        
        // But `resolvers.js` uses `syncProductToD1` which uses `db.query`.
        // If `db.query` works locally (e.g. using wrangler d1 execute or better-sqlite3), it's fine.
        // If not, it will fail.
        
        // Let's assume `createProduct` returns the WC product *before* syncing?
        // No, it calls `syncProductToD1` (await) inside.
        
        const result = await resolvers.Mutation.createProduct(null, { input }, context);
        
        console.log('Product Created:', result.id);
        
        // Now verify author
        console.log('Verifying author...');
        const wc = new WooCommerceClient(context.env);
        const p = await wc.get(`/products/${result.id}`);
        
        console.log(`Product ${p.id} Post Author: ${p.post_author}`);
        
        // Check meta
        const wcfmMeta = p.meta_data.find(m => m.key === '_wcfm_product_author');
        console.log(`_wcfm_product_author: ${wcfmMeta ? wcfmMeta.value : 'Not found'}`);
        
        if (p.post_author == 16533 || (wcfmMeta && wcfmMeta.value == 16533)) {
            console.log('SUCCESS: Product assigned to vendor.');
        } else {
            console.log('FAILURE: Product NOT assigned to vendor.');
        }

    } catch (e) {
        console.error('Error:', e);
    }
}

verify();
