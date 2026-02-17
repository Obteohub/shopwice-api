const BASE_URL = 'http://127.0.0.1:8788';
const USERNAME = 'kwessi@gmail.com';
const PASSWORD = 'Black25';

async function verifySingleOrder() {
    console.log('1. Logging in...');
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: USERNAME, password: PASSWORD })
    });
    
    const loginData = await loginRes.json();
    if (!loginRes.ok || !loginData.token) {
        console.error('Login Failed:', loginData);
        return;
    }
    const token = loginData.token;
    console.log('Login Successful. Token obtained.');

    console.log('\n2. Fetching Orders List...');
    const ordersRes = await fetch(`${BASE_URL}/api/vendor/orders`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!ordersRes.ok) {
        console.error('Fetch Orders Failed:', await ordersRes.text());
        return;
    }
    
    const orders = await ordersRes.json();
    console.log(`Found ${orders.length} orders.`);
    
    if (orders.length === 0) {
        console.log('No orders to test single fetch with.');
        return;
    }

    const orderId = orders[0].id; // Assuming order object has 'id'
    console.log(`\n3. Fetching Single Order ID: ${orderId}...`);
    
    const singleOrderRes = await fetch(`${BASE_URL}/api/vendor/orders/${orderId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (singleOrderRes.ok) {
        const orderData = await singleOrderRes.json();
        console.log('✅ Single Order Fetch Successful!');
        console.log('Order ID:', orderData.id);
        console.log('Order Status:', orderData.status);
    } else {
        console.error('❌ Single Order Fetch FAILED:', singleOrderRes.status);
        console.error('Response:', await singleOrderRes.text());
    }
}

verifySingleOrder();
