
const username = 'kwessi@gmail.com';
const password = 'Black25';
const baseUrl = 'http://localhost:8788/api'; // Testing against local dev server

async function testVendorFlow() {
    console.log(`Attempting login for ${username}...`);
    try {
        const loginRes = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const loginData = await loginRes.json();
        if (!loginRes.ok) {
            console.error('Login Failed:', loginRes.status, loginData);
            return;
        }

        const token = loginData.token;
        const userId = loginData.id;
        console.log('Login Successful! ✅');
        console.log('User ID:', userId);
        console.log('Token (snippet):', token.substring(0, 20) + '...');

        console.log('\nFetching Vendor Products...');
        // The API now handles author and per_page automatically
        const productsRes = await fetch(`${baseUrl}/vendor/products`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const productsData = await productsRes.json();
        if (!productsRes.ok) {
            console.error('Fetch Products Failed:', productsRes.status, productsData);
        } else {
            console.log(`Success! Found ${productsData.length} products. ✅`);
            console.log('Total Products Header (X-WP-Total):', productsRes.headers.get('X-WP-Total'));
            console.log('Total Pages Header (X-WP-TotalPages):', productsRes.headers.get('X-WP-TotalPages'));

            if (productsData.length > 0) {
                console.log('Sample Product:', productsData[0].id, productsData[0].name);
            }
        }

        console.log('\nFetching Vendor Orders...');
        const ordersRes = await fetch(`${baseUrl}/vendor/orders`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const ordersData = await ordersRes.json();
        if (!ordersRes.ok) {
            console.error('Fetch Orders Failed:', ordersRes.status, ordersData);
        } else {
            console.log(`Success! Found ${ordersData.length} orders. ✅`);
            console.log('Total Orders Header (X-WP-Total):', ordersRes.headers.get('X-WP-Total'));
            console.log('Total Pages Header (X-WP-TotalPages):', ordersRes.headers.get('X-WP-TotalPages'));
        }

        console.log('\nTesting Media Upload...');
        const formData = new FormData();
        const blob = new Blob(['dummy content'], { type: 'image/png' });
        formData.append('file', blob, 'debug-test.png');

        const uploadRes = await fetch(`${baseUrl}/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });

        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) {
            console.error('Upload Failed:', uploadRes.status, uploadData);
        } else {
            console.log('Upload Successful! ✅');
            console.log('Response ID:', uploadData.id);
            console.log('Public URL:', uploadData.source_url);
        }

    } catch (e) {
        console.error('Error during test:', e.message);
    }
}

testVendorFlow();
