
require('dotenv').config();

const WC_URL = process.env.WC_URL;
const CONSUMER_KEY = process.env.WC_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.WC_CONSUMER_SECRET;

const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${auth}`
};

async function testAdminOrders() {
    console.log('Fetching orders as Admin...');
    try {
        const url = `${WC_URL}/wp-json/wc/v3/orders?per_page=5`;
        console.log(`GET ${url}`);
        const res = await fetch(url, { headers });
        if (!res.ok) {
            console.error('Error:', res.status);
            const text = await res.text();
            console.log(text);
            return;
        }

        const orders = await res.json();
        console.log(`Found ${orders.length} orders.`);
        if (orders.length > 0) {
            const order = orders[0];
            console.log('Sample Order:', order.id, order.status);
            console.log('Line Items:', JSON.stringify(order.line_items, null, 2));
            
            // Check for vendor metadata in line items or order meta
            if (order.meta_data) {
                console.log('Meta Data Keys:', order.meta_data.map(m => m.key).join(', '));
                const vendorMeta = order.meta_data.find(m => m.key.includes('vendor') || m.key.includes('wcfm'));
                if (vendorMeta) console.log('Vendor Meta:', vendorMeta);
            }
            
            // Check line items for meta
            order.line_items.forEach(item => {
                console.log(`Item: ${item.name} (${item.product_id})`);
                if (item.meta_data) {
                    console.log('  Item Meta:', item.meta_data.map(m => m.key).join(', '));
                }
            });
        }

    } catch (e) {
        console.error('Exception:', e.message);
    }
}

testAdminOrders();
