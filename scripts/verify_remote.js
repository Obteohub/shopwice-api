const https = require('https');

const domain = 'shopwice-api.pages.dev';

async function request(path, method = 'GET', body = null) {
    return new Promise((resolve) => {
        const options = {
            hostname: domain,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Node/Test'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({ status: res.statusCode, data: json });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });

        req.on('error', (e) => resolve({ status: 500, error: e.message }));
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function run() {
    console.log(`Verifying endpoints on ${domain}...\n`);

    // 1. List Products
    const productsRes = await request('/api/products');
    if (productsRes.status === 200 && Array.isArray(productsRes.data)) {
        console.log(`[200] GET /api/products => Found ${productsRes.data.length} products. Sample: ${productsRes.data[0].name}`);
        
        // 2. Single Product
        const firstId = productsRes.data[0].id;
        const singleRes = await request(`/api/products/${firstId}`);
        console.log(`[${singleRes.status}] GET /api/products/${firstId} => ${singleRes.data.name || 'Error'}`);
    } else {
        console.log(`[${productsRes.status}] GET /api/products => Failed`);
    }

    // 3. Attributes, Brands, Locations
    for (const type of ['attributes', 'brands', 'locations']) {
        const res = await request(`/api/v3/${type}`); // Checking if v3 works too
        const res2 = await request(`/api/${type}`);
        console.log(`[${res2.status}] GET /api/${type} => Array of ${Array.isArray(res2.data) ? res2.data.length : 'error'} items`);
    }

    // 4. Auth endpoints
    const authTests = [
        { path: '/api/auth/login', method: 'POST', body: { username: 'kwessi@gmail.com', password: 'Black25' } },
        { path: '/api/auth/google', method: 'POST', body: { idToken: 'test' } },
        { path: '/api/auth/forgot-password', method: 'POST', body: { email: 'test@example.com' } }
    ];

    for (const test of authTests) {
        const res = await request(test.path, test.method, test.body);
        const summary = res.data.message || res.data.error || JSON.stringify(res.data).substring(0, 50);
        console.log(`[${res.status}] ${test.method} ${test.path} => ${summary}`);
    }

    // 5. Collection Data
    const collectionRes = await request('/api/collection-data');
    console.log(`[${collectionRes.status}] GET /api/collection-data => ${collectionRes.data.attributes ? 'Found attributes' : 'No attributes'}`);

    // 6. Places
    const placesRes = await request('/api/places/autocomplete?input=Lagos');
    console.log(`[${placesRes.status}] GET /api/places/autocomplete => Status: ${placesRes.data.status}`);

    console.log('\nVerification complete.');
}

run();
