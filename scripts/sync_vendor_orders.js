
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const WC_URL = process.env.WC_URL || 'https://shopwice.com';
const USERNAME = 'kwessi@gmail.com';
const PASSWORD = 'Black25';
const VENDOR_ID = 16533;

async function syncOrders() {
    console.log('1. Logging in...');
    let token;
    try {
        const res = await fetch(`${WC_URL}/wp-json/jwt-auth/v1/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: USERNAME, password: PASSWORD })
        });
        const data = await res.json();
        token = data.token;
        if (!token) throw new Error('No token');
    } catch (e) {
        console.error('Login failed:', e.message);
        return;
    }

    console.log('2. Fetching Vendor Orders from WCFM...');
    try {
        const res = await fetch(`${WC_URL}/wp-json/wcfmmp/v1/orders`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) {
            console.error('Fetch failed:', res.status);
            return;
        }

        const orders = await res.json();
        console.log(`Found ${orders.length} orders.`);
        
        if (orders.length === 0) {
            console.log('No orders to sync.');
            return;
        }

        const values = [];
        const placeholders = [];
        
        // Helper to escape SQL string (basic)
        const esc = (str) => str ? String(str).replace(/'/g, "''") : '';

        for (const order of orders) {
            // WCFM API returns 'vendor_order_details' which seems to be the summary or specific item detail
            // But looking at the structure, it seems to flatten or provide the commission detail.
            // If an order has multiple items for the vendor, we might need to rely on 'line_items' and calculate commission?
            // OR check if 'vendor_order_details' captures it.
            // In the sample, 'vendor_order_details' has 'product_id' and 'item_id'. This suggests it is per-item.
            // If the API returns one entry per Order ID (distinct), then we might miss items if there are multiple.
            // But let's trust 'vendor_order_details' for now.
            
            const d = order.vendor_order_details;
            if (!d) continue;

            // Prepare values for SQL
            // (vendor_id, order_id, product_id, variation_id, quantity, product_price, total_commission, commission_status, order_status, created, shipping, tax, item_id, refund_status)
            
            values.push(`(
                '${esc(d.vendor_id)}', 
                '${esc(d.order_id)}', 
                '${esc(d.product_id)}', 
                '${esc(d.variation_id)}', 
                '${esc(d.quantity)}', 
                '${esc(d.product_price)}', 
                '${esc(d.total_commission)}', 
                '${esc(d.commission_status)}', 
                '${esc(d.order_status)}', 
                '${esc(d.created)}',
                '${esc(d.shipping)}',
                '${esc(d.tax)}',
                '${esc(d.item_id)}',
                '${esc(d.refund_status)}'
            )`);
        }

        if (values.length > 0) {
            const sql = `INSERT OR IGNORE INTO wp_wcfm_marketplace_orders 
            (vendor_id, order_id, product_id, variation_id, quantity, product_price, total_commission, commission_status, order_status, created, shipping, tax, item_id, refund_status) 
            VALUES \n${values.join(',\n')};`;
            
            // Write SQL to file
            const sqlPath = path.join(__dirname, 'sync_orders.sql');
            fs.writeFileSync(sqlPath, sql);
            console.log(`Generated SQL for ${values.length} items at ${sqlPath}`);
            
            // Execute SQL using Wrangler
            console.log('Executing SQL on D1...');
            const { execSync } = require('child_process');
            try {
                execSync(`npx wrangler d1 execute shopwice-db --file="${sqlPath}" --remote`, { stdio: 'inherit' });
                console.log('Sync Complete!');
            } catch (err) {
                console.error('Execution failed:', err.message);
            }
        }

    } catch (e) {
        console.error('Exception:', e.message);
    }
}

syncOrders();
