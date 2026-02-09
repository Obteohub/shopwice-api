import { onRequest as onRestRequest } from '../functions/api/[[route]].js';
import { onRequest as onGraphqlRequest } from '../functions/graphql.js';
import db from '../src/config/db.js';

// Mock DB
const mockProducts = [
    { id: 1, name: 'Test Product', slug: 'test-product', price: 10, regularPrice: 20, stockQuantity: 100, onSale: true }
];

db.setMock({
    query: async (sql, params) => {
        // Handle COUNT queries
        if (sql.includes('COUNT')) return [[{ total: 1 }]];

        // Handle wp_postmeta queries (DataLoaders)
        if (sql.includes('FROM wp_postmeta')) {
            // Fix for single ID passed to IN (?)
            if (!Array.isArray(params[0])) {
                params[0] = [params[0]];
            }
            if (sql.includes('meta_key = \'_sku\'')) {
                return [params[0].map(id => ({ post_id: id, meta_value: `SKU-${id}` }))];
            }
            if (sql.includes('meta_key = \'_thumbnail_id\'')) {
                return [params[0].map(id => ({ post_id: id, meta_value: 101 }))]; // Image ID 101
            }
            if (sql.includes('meta_key = \'_product_image_gallery\'')) {
                return [params[0].map(id => ({ post_id: id, meta_value: '102,103' }))]; // Gallery IDs
            }
            // General meta loader
            if (sql.includes('meta_key IN')) {
                 const results = [];
                 params[0].forEach(id => {
                     results.push({ post_id: id, meta_key: '_price', meta_value: '10' });
                     results.push({ post_id: id, meta_key: '_regular_price', meta_value: '20' });
                     results.push({ post_id: id, meta_key: '_stock_status', meta_value: 'instock' });
                 });
                 return [results];
            }
        }

        // Handle wp_posts queries (Images, Products)
        if (sql.includes('FROM wp_posts')) {
             // Image lookup (Look for exact match of "WHERE ID = ?" or "WHERE ID IN")
             // The product query uses alias "p", so "p.ID = ?"
             if (sql.includes('WHERE ID = ?') || sql.includes('WHERE ID IN')) {
                 const ids = Array.isArray(params[0]) ? params[0] : [params[0]];
                 return [ids.map(id => ({
                     ID: id,
                     guid: `http://example.com/img/${id}.jpg`,
                     post_title: `Image ${id}`,
                     post_excerpt: `Caption for ${id}`
                 }))];
             }
             
             // Product lookup
             return [[{ 
                id: 1, 
                ID: 1,
                post_title: 'Test Product', 
                name: 'Test Product',
                post_name: 'test-product',
                slug: 'test-product',
                post_content: 'Description',
                description: 'Description',
                post_excerpt: 'Short Desc',
                short_description: 'Short Desc',
                post_status: 'publish',
                post_date: new Date(),
                price: 10,
                regularPrice: 20,
                stockQuantity: 100,
                onSale: true,
                min_price: 10,
                max_price: 20,
                onsale: 1,
                stock_quantity: 100,
                stock_status: 'instock',
                total_sales: 0,
                average_rating: 4.5,
                rating_count: 2
            }]];
        }

        // Handle wp_term_relationships (Categories)
        if (sql.includes('FROM wp_term_relationships')) {
             return [[{
                 object_id: 1,
                 term_id: 50,
                 id: 50,
                 name: 'Test Category',
                 slug: 'test-cat',
                 taxonomy: 'product_cat'
             }]];
        }

        return [[{ 
            id: 1, 
            name: 'Test Product', 
            slug: 'test-product',
            price: 10,
            regularPrice: 20,
            stockQuantity: 100,
            onSale: true
        }]];
    }
});

// Mock Global Fetch for WC/WCFM calls
global.fetch = async (url, options) => {
    if (url.includes('tokeninfo')) return { ok: true, json: async () => ({ email: 'test@example.com' }) };
    if (url.includes('store-vendors')) return { 
        ok: true, 
        json: async () => ([{ id: 1, store_name: 'Test Vendor' }]) 
    };
    if (url.includes('products')) return { 
        ok: true, 
        json: async () => ([{ id: 1, name: 'Test Product' }]) 
    };
    if (url.includes('cart')) return {
        ok: true,
        json: async () => ({ items: [], totals: { total_price: '0' } })
    };
    return { ok: true, json: async () => ({}) };
};

// Mock Cloudflare Environment
const env = {
    DB_HOST: process.env.DB_HOST,
    DB_USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD,
    DB_NAME: process.env.DB_NAME,
    WC_URL: process.env.WC_URL,
    WC_CONSUMER_KEY: process.env.WC_CONSUMER_KEY,
    WC_CONSUMER_SECRET: process.env.WC_CONSUMER_SECRET,
    JWT_SECRET: process.env.JWT_SECRET || 'test-secret'
};

function createMockToken() {
    return 'mock.jwt.token';
}

// Test Runner
async function testRoute(method, path, body = null) {
    console.log(`Testing ${method} ${path}...`);

    const context = {
        env,
        waitUntil: () => {},
        passThroughOnException: () => {}
    };

    try {
        let res;
        if (path === '/graphql') {
            const req = new Request(`http://localhost${path}`, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + createMockToken()
                },
                body: body ? JSON.stringify(body) : null
            });
            context.request = req;
            res = await onGraphqlRequest(context);
        } else {
            let reqPath = path;
            if (!path.startsWith('/api')) {
                 reqPath = '/api' + path;
            }
            const req = new Request(`http://localhost${reqPath}`, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + createMockToken()
                },
                body: body ? JSON.stringify(body) : null
            });
            context.request = req;
            res = await onRestRequest(context);
        }
        
        console.log(`Status: ${res.status}`);

        let data;
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            data = await res.json();
            if (path === '/graphql' && !data.errors) {
                 console.log('✅ GraphQL Query Success');
                 console.log('Sample Data:', JSON.stringify(data.data, null, 2));
                 if (data.data.product) {
                     console.log('Image Data:', JSON.stringify(data.data.product.image, null, 2));
                     console.log('Categories:', JSON.stringify(data.data.product.categories, null, 2));
                 }
            } else if (res.status === 200) {
                 console.log('✅ Success');
            } else if (res.status === 401 || res.status === 403) {
                 console.log('✅ Correctly rejected unauthorized request');
            } else {
                 console.log('❌ Failed');
                 console.log(JSON.stringify(data, null, 2));
            }
        } else {
            console.log('Response:', await res.text());
        }
    } catch (e) {
        console.error('❌ Error:', e);
    }
}

async function runTests() {
    // 1. Health Check
    await testRoute('GET', '/health');

    // 2. Public Routes
    await testRoute('GET', '/products');
    await testRoute('GET', '/cart');
    await testRoute('GET', '/locations'); // Assuming this exists or is handled
    await testRoute('GET', '/vendor/list');

    // 3. Protected Routes (should fail without token or with invalid token, but we are sending a mock token which might be accepted if not validated against real DB/Secret properly, but we want to verify the ROUTE exists)
    // The current implementation of verify_cf uses a mock token.
    console.log('Testing Protected Route (Expect 401)...');
    // Note: Our mock fetch/DB doesn't implement full auth validation logic unless we mock the secret validation too.
    // But let's check a vendor route.
    await testRoute('GET', '/vendor/products');

    // 4. GraphQL
    console.log('Testing GraphQL Endpoint...');
    // Query list
    await testRoute('POST', '/graphql', {
        query: `
            query {
                products(first: 1) {
                    nodes {
                        id
                        name
                    }
                }
            }
        `
    });

    // Query single product with details to test DataLoaders
    console.log('Testing GraphQL Single Product with DataLoaders...');
    await testRoute('POST', '/graphql', {
        query: `
            query {
                product(id: "1") {
                    id
                    name
                    price
                    image {
                        sourceUrl
                    }
                    categories {
                        name
                    }
                }
            }
        `
    });
}

runTests();
