const BASE_URL = 'https://api.shopwice.com';
const GRAPHQL_URL = `${BASE_URL}/graphql`;
const USERNAME = 'kwessi@gmail.com';
const PASSWORD = 'Black25';

async function runTests() {
    console.log('🚀 Starting GraphQL Endpoint Tests on', GRAPHQL_URL);
    let token = null;

    // 1. Login (REST) - Prerequisite for any potential protected queries
    console.log('\n--- 1. Testing Login (REST) ---');
    try {
        const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: USERNAME, password: PASSWORD })
        });
        
        const loginData = await loginRes.json();
        if (loginRes.ok && loginData.token) {
            token = loginData.token;
            console.log('✅ Login Successful');
            console.log('Token:', token.substring(0, 20) + '...');
        } else {
            console.error('❌ Login Failed:', loginData);
        }
    } catch (e) {
        console.error('❌ Login Error:', e.message);
    }

    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };

    // Helper to run GraphQL query
    async function runQuery(name, query) {
        console.log(`\n--- Testing ${name} ---`);
        try {
            const res = await fetch(GRAPHQL_URL, {
                method: 'POST',
                headers,
                body: JSON.stringify({ query })
            });
            
            const text = await res.text();
            try {
                const data = JSON.parse(text);
                if (data.errors) {
                    console.error(`❌ ${name} GraphQL Errors:`, JSON.stringify(data.errors, null, 2));
                } else {
                    console.log(`✅ ${name} Success`);
                    // Log a summary
                    const keys = Object.keys(data.data);
                    keys.forEach(k => {
                        const val = data.data[k];
                        if (Array.isArray(val)) {
                            console.log(`   ${k}: Found ${val.length} items`);
                            if(val.length > 0) console.log(`   Sample: ${JSON.stringify(val[0].name || val[0].id)}`);
                        } else if (val && val.nodes) {
                            console.log(`   ${k}: Found ${val.nodes.length} items`);
                            if(val.nodes.length > 0) console.log(`   Sample: ${JSON.stringify(val.nodes[0].name || val.nodes[0].id)}`);
                        } else {
                            console.log(`   ${k}: ${JSON.stringify(val)}`);
                        }
                    });
                }
            } catch (e) {
                console.error(`❌ ${name} Invalid JSON response:`, text.substring(0, 200));
            }
        } catch (e) {
            console.error(`❌ ${name} Request Error:`, e.message);
        }
    }

    // 2. Products
    await runQuery('Products', `
        query {
            products(first: 5) {
                nodes {
                    id
                    name
                    price
                    regularPrice
                }
            }
        }
    `);

    // 3. Categories
    await runQuery('Categories (Simple)', `
        query {
            categories {
                id
                name
                slug
            }
        }
    `);
    
    await runQuery('ProductCategories (Connection)', `
        query {
            productCategories(where: { search: "" }) {
                nodes {
                    id
                    name
                    count
                }
            }
        }
    `);

    // 4. Brands
    await runQuery('Brands', `
        query {
            productBrands {
                nodes {
                    id
                    name
                    slug
                }
            }
        }
    `);

    // 5. Locations
    await runQuery('Locations', `
        query {
            productLocations {
                nodes {
                    id
                    name
                    slug
                }
            }
        }
    `);

    // 6. Attributes
    await runQuery('Attributes (Taxonomies)', `
        query {
            productAttributeTaxonomies {
                nodes {
                    id
                    name
                    slug
                }
            }
        }
    `);

    // 7. Test GraphQL Login (Checking if it exists or verifying absence)
    // Note: Based on schema analysis, it does not exist, but let's try a common pattern just in case
    // or simply skip it as we already did REST login.
    console.log('\n--- Note: GraphQL "login" mutation was not found in schema. Used REST API for authentication. ---');
}

runTests();
