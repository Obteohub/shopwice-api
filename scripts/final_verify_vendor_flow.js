require('dotenv').config();
const WooCommerceClient = require('../src/utils/wc-client');
const { execSync } = require('child_process');

// Mock DB for SyncService (to avoid crashing on local execution without D1 binding)
const mockDb = {
    init: () => {},
    query: async (sql, params = []) => {
        try {
            // Just log, don't execute to save time/errors in this specific flow check 
            // unless we really want to test D1 sync again (we already did).
            // Let's actually try to execute to be thorough, but catch errors.
            let finalSql = sql;
            for (const param of params) {
                let val = param;
                if (typeof val === 'string') val = `'${val.replace(/'/g, "''")}'`;
                if (val === null || val === undefined) val = 'NULL';
                finalSql = finalSql.replace('?', val);
            }
            const cleanSql = finalSql.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim();
            const cmdSql = cleanSql.replace(/"/g, '\\"');
            execSync(`npx wrangler d1 execute shopwice-db --local --command "${cmdSql}"`, { stdio: 'pipe' });
            return [[], []];
        } catch (e) {
            // Ignore unique constraint errors etc.
            return [[], []];
        }
    }
};
require.cache[require.resolve('../src/config/db')] = { exports: mockDb };
const SyncService = require('../src/services/syncService');

async function runFlow() {
    const wc = new WooCommerceClient({
        WC_URL: process.env.WC_URL,
        WC_CONSUMER_KEY: process.env.WC_CONSUMER_KEY,
        WC_CONSUMER_SECRET: process.env.WC_CONSUMER_SECRET
    });

    const vendorId = 16533;
    const productName = `Vendor Product Flow Test ${Date.now()}`;

    try {
        // ==========================================
        // 1. Create Product
        // ==========================================
        console.log('--- Step 1: Creating Product ---');
        const productData = {
            name: productName,
            type: 'simple',
            regular_price: '50.00',
            description: 'Created via final flow verification script',
            short_description: 'Flow Test',
            status: 'publish', // Publish immediately to see in list
            categories: [{ id: 15 }],
            author: vendorId,
            meta_data: [
                { key: '_wcfm_product_author', value: vendorId },
                { key: '_wcfm_product_views', value: '0' }
            ]
        };

        const newProduct = await wc.post('/products', productData);
        console.log(`✅ Created Product ID: ${newProduct.id}`);
        console.log(`   Name: ${newProduct.name}`);
        console.log(`   Author: ${newProduct.post_author}`);

        // Sync (simulate router behavior)
        console.log('   Syncing to D1...');
        await SyncService.syncProduct(newProduct);

        // ==========================================
        // 2. Fetch Vendor Products
        // ==========================================
        console.log('\n--- Step 2: Fetching Vendor Products ---');
        // Wait a moment for indexing if any
        await new Promise(r => setTimeout(r, 2000));

        const products = await wc.get('/products', { 
            author: vendorId, 
            per_page: 10,
            status: 'publish'
        });

        console.log(`Fetched ${products.length} published products for vendor ${vendorId}.`);

        // Verify
        const found = products.find(p => p.id === newProduct.id);
        if (found) {
            console.log(`✅ SUCCESS: New product ${newProduct.id} is in the vendor's product list.`);
            console.log(`   List Item Author: ${found.post_author}`);
            const meta = found.meta_data.find(m => m.key === '_wcfm_product_author');
            console.log(`   List Item WCFM Meta: ${meta ? meta.value : 'Missing'}`);
        } else {
            console.log(`❌ FAILURE: New product ${newProduct.id} was NOT found in the vendor's product list.`);
            console.log('Top 5 IDs found:', products.slice(0,5).map(p => p.id).join(', '));
        }

    } catch (error) {
        console.error('Error:', error.message);
        if (error.data) console.error(JSON.stringify(error.data, null, 2));
    }
}

runFlow();
