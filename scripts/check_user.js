
require('dotenv').config();

const WC_URL = process.env.WC_URL;
const CONSUMER_KEY = process.env.WC_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.WC_CONSUMER_SECRET;
const VENDOR_ID = 16533;

const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${auth}`
};

async function checkUser() {
    console.log(`Checking /wc/v3/customers/${VENDOR_ID} ...`);
    try {
        const url = `${WC_URL}/wp-json/wc/v3/customers/${VENDOR_ID}`;
        console.log(`GET ${url}`);
        const res = await fetch(url, { headers });
        if (!res.ok) {
            console.error('Error fetching customer:', res.status);
            const text = await res.text();
            console.log(text);
        } else {
            const user = await res.json();
            console.log('Customer Found:');
            console.log(`ID: ${user.id}`);
            console.log(`Username: ${user.username}`);
            console.log(`Email: ${user.email}`);
            console.log(`Role: ${user.role}`); // WC uses singular 'role' usually? Or 'roles'?
        }
    } catch (e) {
        console.error('Exception:', e.message);
    }
}

checkUser();
