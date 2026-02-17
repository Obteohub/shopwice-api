const BASE_URL = 'http://127.0.0.1:8788/api';

async function verifyIsolation() {
    console.log('🚀 Verifying REST Cart Isolation (Cart-Token Check)...');

    // 1. Fetch Cart
    console.log('\n--- 1. Session 1: Initial Fetch ---');
    let res1 = await fetch(`${BASE_URL}/cart`);
    let nonce1 = res1.headers.get('x-wc-store-api-nonce');
    let cartToken1 = res1.headers.get('cart-token');

    console.log(`   Nonce 1: ${nonce1 ? 'Captured' : 'MISSING'}`);
    console.log(`   Cart-Token 1: ${cartToken1 ? 'Captured' : 'MISSING'}`);

    // 2. Add item
    console.log('\n--- 2. Session 1: Add Item ---');
    const productId = 207137;
    const addHeaders = {
        'Content-Type': 'application/json',
        'X-WC-Store-API-Nonce': nonce1
    };
    if (cartToken1) addHeaders['Cart-Token'] = cartToken1;

    const addRes = await fetch(`${BASE_URL}/cart/add`, {
        method: 'POST',
        headers: addHeaders,
        body: JSON.stringify({ id: String(productId), quantity: '1' })
    });

    const addData = await addRes.json();
    console.log(`   Added: ${addData.items?.length > 0 ? 'Success' : 'Failed'}`);

    const updatedNonce1 = addRes.headers.get('x-wc-store-api-nonce');
    if (updatedNonce1) nonce1 = updatedNonce1;
    const updatedCartToken1 = addRes.headers.get('cart-token');
    if (updatedCartToken1) cartToken1 = updatedCartToken1;

    // 3. Re-verify Session 1
    console.log('\n--- 3. Session 1: Re-verify ---');
    const verifyHeaders = { 'X-WC-Store-API-Nonce': nonce1 };
    if (cartToken1) verifyHeaders['Cart-Token'] = cartToken1;

    const res1b = await fetch(`${BASE_URL}/cart`, { headers: verifyHeaders });
    const cart1b = await res1b.json();
    console.log(`   Items 1 (again): ${cart1b.items?.length || 0}`);

    // 4. Isolation Test
    console.log('\n--- 4. Session 2: Initial Fetch ---');
    const res2 = await fetch(`${BASE_URL}/cart`);
    const cart2 = await res2.json();
    console.log(`   Items 2: ${cart2.items?.length || 0}`);

    if ((cart2.items?.length || 0) === 0) {
        console.log('✅ PASS: Session 2 is empty.');
    } else {
        console.log('❌ FAIL: leakage!');
    }
}

verifyIsolation().catch(console.error);
