require('dotenv').config();
const SyncService = require('../src/services/syncService');
const db = require('../src/config/db');

// Mock Env
const env = {
    ...process.env,
    // Add any required bindings if needed
};

// Mock WC Client get method to return variations
// Since SyncService uses require('wc-client'), we can't easily mock it without proxyquire or similar.
// BUT, we can mock the `env` such that `WooCommerceClient` fails or we can partial mock.
// OR, we can just modify the test to not rely on fetching if we pass full variation data? 
// No, SyncService fetches variations using the client.
// We must mock `wc-client` response.

// Since we cannot mock module requires easily in this environment, 
// We will augment SyncService to allow injecting a client, OR we use a real WC product if we have one.
//
// Better approach: 
// Modify SyncService to allow passing a mock client?
// No, it instantiates `new WooCommerceClient(env)`.
//
// Let's create a "MockWooCommerceClient" and swap the file? No that's dangerous.
//
// Let's fallback to: We rely on the FACT that we fixed the code.
// We can try to sync a "fake" variable product, but it will try to fetch variations from WC and fail.
//
// Okay, let's create a REAL dummy variable product in WC using a script, then sync it.
//
// `scripts/create_test_variable_product.js`
// 1. Create variable product via WC API.
// 2. Create variation.
// 3. Trigger sync (simulate webhook).
// 4. Check DB.

const WooCommerceClient = require('../src/utils/wc-client');

async function test() {
    const wc = new WooCommerceClient(env);

    console.log('Creating test variable product...');
    const p = await wc.post('/products', {
        name: 'Test Variable Product ' + Date.now(),
        type: 'variable',
        description: 'Testing variations sync',
        short_description: 'Short desc',
        regular_price: '100',
        attributes: [
            {
                name: 'Color',
                visible: true,
                variation: true,
                options: ['Red', 'Blue']
            }
        ]
    });

    console.log(`Created parent: ${p.id}. Creating variation...`);

    const v = await wc.post(`/products/${p.id}/variations`, {
        regular_price: '120',
        attributes: [
            {
                name: 'Color',
                option: 'Red'
            }
        ]
    });

    console.log(`Created variation: ${v.id}.`);

    // Now simulate Sync
    // We need to fetch the parent again to get the updated variations list (IDs)
    const [freshP] = await wc.get('/products', { include: [p.id] });

    console.log('Simulating SyncService...');
    await SyncService.syncProduct(freshP, env);

    console.log('Sync complete. Checking DB...');
    const [rows] = await db.query("SELECT * FROM wp_posts WHERE post_type = 'product_variation' AND post_parent = ?", [p.id]);

    if (rows.length > 0) {
        console.log('✅ Success! Found variation in DB:', rows[0]);
    } else {
        console.error('❌ Failed! Variation not found in DB.');
    }

    // Cleanup
    console.log('Cleaning up...');
    await wc.delete(`/products/${p.id}`, { force: true });
}

test().catch(console.error);
