const BASE_URL = 'http://127.0.0.1:8788';
const GRAPHQL_URL = `${BASE_URL}/graphql`;

async function testCart() {
    console.log('🚀 Testing GraphQL Cart Operations with Session Persistence...');

    let sessionCookies = null;
    let storeNonce = null;
    let cartToken = null;

    // 0. Initial Cart Fetch to get Session/Nonce
    console.log('\n--- 0. Initial Cart Fetch (to establish session) ---');
    const getCartQuery = `
        query {
            cart {
                total
                itemCount
                isEmpty
            }
        }
    `;

    try {
        const res = await fetch(GRAPHQL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: getCartQuery })
        });
        
        // Capture Cookies & Nonce
        const cookies = res.headers.get('set-cookie');
        if (cookies) {
            console.log('🍪 Captured Initial Session Cookies:', cookies);
            sessionCookies = cookies;
        }
        
        const nonce = res.headers.get('x-wc-store-api-nonce');
        if (nonce) {
            console.log('🔑 Captured Initial Store Nonce');
            storeNonce = nonce;
        }

        const token = res.headers.get('cart-token');
        if (token) {
            console.log('🏷️ Captured Initial Cart Token');
            cartToken = token;
        }

        const json = await res.json();
        console.log('✅ Initial Cart Fetch Done');
        if (json.data && json.data.cart) {
            console.log(`   IsEmpty: ${json.data.cart.isEmpty}`);
        }
    } catch (e) {
        console.error('❌ Initial Request Error:', e.message);
        return;
    }

    // 1. Add to Cart
    console.log('\n--- 1. Adding Item to Cart ---');
    const addToCartQuery = `
        mutation AddToCart($input: AddToCartInput!) {
            addToCart(input: $input) {
                cart {
                    total
                    itemCount
                    contents {
                        nodes {
                            product {
                                node {
                                    name
                                }
                            }
                        }
                    }
                }
            }
        }
    `;

    const productId = 207137; 
    
    const fetchHeaders = { 'Content-Type': 'application/json' };
    if (sessionCookies) fetchHeaders['Cookie'] = sessionCookies;
    if (storeNonce) fetchHeaders['X-WC-Store-API-Nonce'] = storeNonce;
    if (cartToken) fetchHeaders['Cart-Token'] = cartToken;

    try {
        const res = await fetch(GRAPHQL_URL, {
            method: 'POST',
            headers: fetchHeaders,
            body: JSON.stringify({ 
                query: addToCartQuery,
                variables: { input: { productId, quantity: 1 } }
            })
        });
        
        // Update Cookies/Nonce if changed
        if (res.headers.get('set-cookie')) {
            sessionCookies = res.headers.get('set-cookie');
            console.log('🍪 Updated Session Cookies in AddToCart');
        }
        if (res.headers.get('x-wc-store-api-nonce')) storeNonce = res.headers.get('x-wc-store-api-nonce');
        if (res.headers.get('cart-token')) {
            cartToken = res.headers.get('cart-token');
            console.log('🏷️ Updated Cart Token in AddToCart');
        }

        const json = await res.json();
        
        if (json.errors) {
            console.error('❌ AddToCart Errors:', JSON.stringify(json.errors, null, 2));
            return;
        } else {
            console.log('✅ AddToCart Success!');
            const cart = json.data.addToCart.cart;
            console.log(`   Items: ${cart.itemCount}`);
        }
    } catch (e) {
        console.error('❌ Request Error:', e.message);
        return;
    }

    // 2. Fetch Cart (Query) with Session to Verify Persistence
    console.log('\n--- 2. Fetching Cart Query (Verification) ---');
    
    const verifyHeaders = { 'Content-Type': 'application/json' };
    if (sessionCookies) verifyHeaders['Cookie'] = sessionCookies;
    if (storeNonce) verifyHeaders['X-WC-Store-API-Nonce'] = storeNonce;
    if (cartToken) verifyHeaders['Cart-Token'] = cartToken;

    try {
        const res = await fetch(GRAPHQL_URL, {
            method: 'POST',
            headers: verifyHeaders,
            body: JSON.stringify({ query: getCartQuery })
        });
        
        const json = await res.json();
        if (json.errors) {
            console.error('❌ Cart Query Errors:', JSON.stringify(json.errors, null, 2));
        } else {
            const cart = json.data.cart;
            if (cart) {
                 console.log('✅ Cart Query Success!');
                 console.log(`   Items: ${cart.itemCount}`);
                 console.log(`   Total: ${cart.total}`);
                 
                 if (cart.itemCount > 0) {
                     console.log('🎉 SESSION PERSISTENCE VERIFIED!');
                 } else {
                     console.warn('⚠️ Cart is empty. Session persistence failed.');
                 }
            } else {
                console.error('❌ Cart is null.');
            }
        }
    } catch (e) {
        console.error('❌ Request Error:', e.message);
    }
}

testCart();
