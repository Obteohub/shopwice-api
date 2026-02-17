
require('dotenv').config();

const WC_URL = process.env.WC_URL;
const USERNAME = 'kwessi@gmail.com';
const PASSWORD = 'Black25';

async function createAsVendor() {
    console.log(`1. Logging in as ${USERNAME}...`);
    let token;
    try {
        const url = `${WC_URL}/wp-json/jwt-auth/v1/token`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: USERNAME, password: PASSWORD })
        });
        const data = await res.json();
        token = data.token;
        if (!token) throw new Error('No token received');
        console.log('Login successful.');
    } catch (e) {
        console.error('Login failed:', e.message);
        return;
    }

    console.log('2. Creating Product as Vendor...');
    const newProduct = {
        name: `Vendor Created Product ${Date.now()}`,
        type: 'simple',
        regular_price: '25.00',
        description: 'Created using Vendor JWT Token',
        short_description: 'Vendor Self-Create',
        status: 'publish' // Vendors usually can only 'pending', but let's try 'publish' or 'pending'
    };

    // Try WCFM endpoint first (if it accepts JWT)
    // WCFM Endpoint: /wcfmmp/v1/products
    // Or standard WC Endpoint: /wc/v3/products
    
    // Let's try standard WC endpoint with JWT header
    try {
        const url = `${WC_URL}/wp-json/wc/v3/products`;
        console.log(`POST ${url}`);
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(newProduct)
        });

        if (!res.ok) {
            console.error('Creation failed:', res.status);
            const text = await res.text();
            console.log(text);
        } else {
            const product = await res.json();
            console.log('Product Created!');
            console.log('ID:', product.id);
            console.log('Author:', product.post_author || product.author);
            console.log('Status:', product.status);
            
            console.log('\n--- Store Info ---');
            console.log('Store Object:', JSON.stringify(product.store || {}, null, 2));

            // 5. Fetch Vendor Stats (as Vendor)
            console.log('\n5. Fetching Vendor Stats (as Vendor)...');
            try {
                const statsUrl = `${WC_URL}/wp-json/wcfmmp/v1/sales-stats`;
                const statsRes = await fetch(statsUrl, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                
                if (statsRes.ok) {
                    const stats = await statsRes.json();
                    console.log(`✅ WCFM Stats found:`, JSON.stringify(stats).substring(0, 100) + '...');
                } else {
                    console.log(`❌ WCFM Stats failed: ${statsRes.status}`);
                    const text = await statsRes.text();
                    console.log(text);
                }
            } catch (e) {
                console.error('Stats fetch error:', e.message);
            }
        }
    } catch (e) {
        console.error('Exception:', e.message);
    }
}

createAsVendor();
