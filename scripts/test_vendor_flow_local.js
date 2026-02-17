const http = require('http');

const username = 'kwessi@gmail.com';
const password = 'Black25';
const hostname = '127.0.0.1';
const port = 8788;

async function request(path, method, body = null, token = null) {
    return new Promise((resolve) => {
        const options = {
            hostname: hostname,
            port: port,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Node/Test'
            }
        };

        if (body) options.headers['Content-Length'] = JSON.stringify(body).length;
        if (token) options.headers['Authorization'] = `Bearer ${token}`;

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({ status: res.statusCode, data: json });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });

        req.on('error', (e) => {
            console.error(`Problem with request: ${e.message}`);
            resolve({ status: 500, data: e.message });
        });

        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function run() {
    console.log(`Testing Vendor Flow on http://${hostname}:${port}...\n`);

    // 1. Login
    console.log('1. Logging in...');
    const loginRes = await request('/api/auth/login', 'POST', { username, password });
    if (loginRes.status !== 200 || !loginRes.data.token) {
        console.log('Login Failed:', loginRes.data);
        return;
    }
    const token = loginRes.data.token;
    const vendorId = loginRes.data.id;
    console.log(`✅ Logged in as Vendor ID: ${vendorId} (Role: ${loginRes.data.role})`);

    // 2. See Products (GraphQL)
    console.log('\n2. Fetching Vendor Products...');
    const query = `
        query {
            products(vendorId: "${vendorId}") {
                nodes {
                    id
                    name
                    price
                    stockStatus
                }
            }
        }
    `;
    const prodRes = await request('/graphql', 'POST', { query }, token);
    if (prodRes.data.data && prodRes.data.data.products) {
        const products = prodRes.data.data.products.nodes;
        console.log(`✅ Found ${products.length} products owned by vendor.`);
        if (products.length > 0) {
            console.log(`   Sample: ${products[0].name} (${products[0].id})`);
        } else {
            console.log('   (Expected ~5 products after manual assignment)');
        }
    } else {
        console.log('❌ Failed to fetch products:', JSON.stringify(prodRes.data));
    }

    // 3. See Orders (GraphQL)
    console.log('\n3. Fetching Vendor Orders...');
    const orderQuery = `
        query {
            orders {
                nodes {
                    id
                    total
                    status
                    date_created
                }
            }
        }
    `;
    const orderRes = await request('/graphql', 'POST', { query: orderQuery }, token);
    if (orderRes.data.data && orderRes.data.data.orders) {
        const orders = orderRes.data.data.orders.nodes;
        console.log(`✅ Found ${orders.length} orders for vendor.`);
    } else {
        console.log('❌ Failed to fetch orders:', JSON.stringify(orderRes.data));
    }
}

run();
