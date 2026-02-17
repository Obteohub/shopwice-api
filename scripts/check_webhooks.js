
require('dotenv').config();
const WooCommerceClient = require('../src/utils/wc-client.js');

if (!process.env.WC_URL || !process.env.WC_CONSUMER_KEY || !process.env.WC_CONSUMER_SECRET) {
    console.error('Error: WC checking variables not set.');
    process.exit(1);
}

const wc = new WooCommerceClient(process.env);

async function checkWebhooks() {
    console.log('--- Checking WooCommerce Webhooks ---');
    try {
        const webhooks = await wc.get('/webhooks');
        console.log(`Found ${webhooks.length} webhooks:`);
        webhooks.forEach(w => {
            console.log(`- [${w.id}] ${w.name} (${w.topic}) -> ${w.delivery_url} [${w.status}]`);
        });

        // Check for required topics
        const required = ['product.created', 'product.updated', 'product.deleted'];
        const missing = required.filter(topic => !webhooks.some(w => w.topic === topic));

        if (missing.length > 0) {
            console.log(`\n⚠️ Missing Webhooks: ${missing.join(', ')}`);
        } else {
            console.log('\n✅ All primary product webhooks are present.');
        }

    } catch (e) {
        console.error('Error fetching webhooks:', e.message);
        if (e.Response) console.error(await e.Response.text());
    }
}

checkWebhooks();
