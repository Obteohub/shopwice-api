
require('dotenv').config();

const WC_URL = process.env.WC_URL;
const CONSUMER_KEY = process.env.WC_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.WC_CONSUMER_SECRET;
const VENDOR_ID = 16533; // kwessi@gmail.com

if (!WC_URL || !CONSUMER_KEY || !CONSUMER_SECRET) {
    console.error('Missing env vars');
    process.exit(1);
}

const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${auth}`
};

console.log('Keys:', CONSUMER_KEY.substring(0, 5) + '...', CONSUMER_SECRET.substring(0, 5) + '...');

async function checkWCFM() {
    console.log('Checking Basic Connectivity...');
    
    // 0. Check Root WC API
    try {
        const url = `${WC_URL}/wp-json/wc/v3`;
        console.log(`GET ${url}`);
        const res = await fetch(url, { headers });
        console.log('Root WC status:', res.status);
        if (res.ok) {
            const data = await res.json();
            console.log('WC API Root OK. Routes:', Object.keys(data.routes || {}).length);
        } else {
             const text = await res.text();
             console.log('Root WC Error:', text.substring(0, 200));
        }
    } catch (e) {
        console.error('Root Connection Error:', e.message);
    }

    try {
        const url = `${WC_URL}/wp-json/wcfmmp/v1/products?vendor_id=${VENDOR_ID}`;
        console.log(`GET ${url}`);
        const res = await fetch(url, { headers });
        if (!res.ok) {
            console.error('Error fetching WCFM products:', res.status, res.statusText);
            const text = await res.text();
            console.error(text);
        } else {
            const data = await res.json();
            console.log(`WCFM Products found: ${data.length}`);
            if (data.length > 0) {
                console.log('Sample Product:', data[0].id, data[0].name);
            }
        }
    } catch (e) {
        console.error('Exception fetching WCFM products:', e.message);
    }

    // 2. Check Vendor Orders via WCFM Endpoint
    try {
        const url = `${WC_URL}/wp-json/wcfmmp/v1/orders?vendor_id=${VENDOR_ID}`;
        console.log(`GET ${url}`);
        const res = await fetch(url, { headers });
        if (!res.ok) {
            console.error('Error fetching WCFM orders:', res.status, res.statusText);
            const text = await res.text();
            console.error(text);
        } else {
            const data = await res.json();
            console.log(`WCFM Orders found: ${data.length}`);
             if (data.length > 0) {
                console.log('Sample Order:', data[0].id, data[0].status);
            }
        }
    } catch (e) {
        console.error('Exception fetching WCFM orders:', e.message);
    }
    
    // 3. Check Standard WC Products with Author filter
    try {
        console.log('Testing WC Products with author filter...');
        // Try Admin (1) first
        const urlAdmin = `${WC_URL}/wp-json/wc/v3/products?author=1`;
        console.log(`GET ${urlAdmin}`);
        const resAdmin = await fetch(urlAdmin, { headers });
        console.log('Admin Filter Status:', resAdmin.status);

        // Try Vendor (16533)
        const url = `${WC_URL}/wp-json/wc/v3/products?author=${VENDOR_ID}`;
        console.log(`GET ${url}`);
        const res = await fetch(url, { headers });
        if (!res.ok) {
             console.error('Error fetching WC products:', res.status);
             const text = await res.text();
             console.log('Error Body:', text.substring(0, 500));
        } else {
            const data = await res.json();
            console.log(`WC Products (author=${VENDOR_ID}) found: ${data.length}`);
             if (data.length > 0) {
                console.log('Sample Product:', data[0].id, data[0].name);
            }
        }
    } catch (e) {
         console.error('Exception fetching WC products:', e.message);
    }

    // 4. Try Creating Product via WC API
    try {
        console.log('Testing Product Creation via WC API...');
        const newProduct = {
            name: `Debug Product ${Date.now()}`,
            type: 'simple',
            regular_price: '10.00',
            description: 'Created via debug script',
            short_description: 'Debug',
            status: 'publish', // Publish immediately to see if it appears
            author: VENDOR_ID,
            meta_data: [
                { key: '_wcfm_product_author', value: String(VENDOR_ID) }
            ]
        };
        
        const url = `${WC_URL}/wp-json/wc/v3/products`;
        console.log(`POST ${url}`);
        const res = await fetch(url, { 
            method: 'POST',
            headers: headers,
            body: JSON.stringify(newProduct)
        });
        
        if (!res.ok) {
            console.error('Error creating product:', res.status);
            const text = await res.text();
            console.log(text);
        } else {
            const data = await res.json();
            console.log('Product Created OK:', data.id);
            console.log('Assigned Author:', data.post_author || data.author);
            
            // Check meta
            const meta = data.meta_data.find(m => m.key === '_wcfm_product_author');
            console.log('_wcfm_product_author:', meta ? meta.value : 'MISSING');
        }
    } catch (e) {
        console.error('Exception creating product:', e.message);
    }
}

checkWCFM();
