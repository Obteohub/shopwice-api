require('dotenv').config();
const { execSync } = require('child_process');
const WooCommerceClient = require('../src/utils/wc-client');

// Mock DB module to use Wrangler CLI for local execution
const mockDb = {
    init: () => {},
    query: async (sql, params = []) => {
        try {
            // Replace ? with params
            let finalSql = sql;
            for (const param of params) {
                let val = param;
                if (typeof val === 'string') val = `'${val.replace(/'/g, "''")}'`; // Escape single quotes
                if (val === null || val === undefined) val = 'NULL';
                finalSql = finalSql.replace('?', val);
            }
    
            const cleanSql = finalSql.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim();
            const cmdSql = cleanSql.replace(/"/g, '\\"');
            
            // console.log(`[MockDB] Executing: ${cmdSql.substring(0, 100)}...`);
            execSync(`npx wrangler d1 execute shopwice-db --local --command "${cmdSql}"`, { stdio: 'pipe' });
            return [[], []]; // Return empty result, we just want execution
        } catch (e) {
            console.error("SQL Execution Error:", e.message);
            return [[], []];
        }
    }
};

// Override the require cache for db.js
require.cache[require.resolve('../src/config/db')] = {
    exports: mockDb
};

const SyncService = require('../src/services/syncService');

async function createRestProduct() {
    const env = {
        WC_URL: process.env.WC_URL,
        WC_CONSUMER_KEY: process.env.WC_CONSUMER_KEY,
        WC_CONSUMER_SECRET: process.env.WC_CONSUMER_SECRET,
        DB: {} // Dummy
    };

    const userId = 16533; // Vendor ID

    console.log('Simulating POST /vendor/products (REST) ...');

    const api = new WooCommerceClient(env);
    
    try {
        const body = {
            name: 'Test Product REST Route',
            type: 'simple',
            regular_price: '45.00',
            description: 'Created via REST verification script',
            short_description: 'REST Test',
            status: 'pending',
            categories: [{ id: 15 }]
        };

        // Logic from router.post('/vendor/products')
        if (!body.author) body.author = userId;

        // Explicitly set WCFM meta data (Mirroring the fix in functions/api/[[route]].js)
        if (!body.meta_data) body.meta_data = [];
        body.meta_data.push({ key: '_wcfm_product_author', value: userId });
        body.meta_data.push({ key: '_wcfm_product_views', value: '0' });

        console.log('Sending to WC API...');
        const product = await api.post('/products', body);
        console.log(`Product Created: ID ${product.id}`);

        // Logic from router.post('/vendor/products') - Sync
        if (product && product.id) {
            console.log('Triggering SyncService...');
            // In the router, we do:
            // if (env.DB) { const dbConfig = require('../../src/config/db.js'); dbConfig.init(env); await SyncService.syncProduct(data); }
            
            // Here we just call SyncService directly as we mocked DB
            await SyncService.syncProduct(product);
        }

        // Verify Author
        console.log('Verifying Author...');
        const p = await api.get(`/products/${product.id}`);
        const wcfmMeta = p.meta_data.find(m => m.key === '_wcfm_product_author');
        
        console.log(`Post Author: ${p.post_author}`);
        console.log(`_wcfm_product_author: ${wcfmMeta ? wcfmMeta.value : 'Not found'}`);

        if (p.post_author == userId || (wcfmMeta && wcfmMeta.value == userId)) {
            console.log('SUCCESS: Product created via REST logic and assigned to vendor.');
        } else {
            console.log('FAILURE: Product NOT assigned to vendor.');
        }

    } catch (e) {
        console.error('Error:', e.message);
        if (e.data) console.error(JSON.stringify(e.data, null, 2));
    }
}

createRestProduct();
