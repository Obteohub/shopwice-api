
const API_URL = 'http://127.0.0.1:8788/api';

async function testCustomerFlow() {
    const timestamp = Date.now();
    const email = `customer_${timestamp}@example.com`;
    const password = 'Password123!';

    console.log(`🚀 Testing Customer Flow with ${email}...`);

    // 1. Register
    console.log('\n--- 1. Register ---');
    try {
        const regRes = await fetch(`${API_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email,
                username: `user_${timestamp}`,
                password,
                firstName: 'Test',
                lastName: 'Customer'
            })
        });

        const regData = await regRes.json();
        console.log('Register Status:', regRes.status);
        console.log('Register Response:', JSON.stringify(regData, null, 2));

        if (!regRes.ok) return;

    } catch (e) {
        console.error('Register Error:', e.message);
        return;
    }

    // 2. Login
    console.log('\n--- 2. Login ---');
    try {
        const loginRes = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: email,
                password
            })
        });

        const loginData = await loginRes.json();
        console.log('Login Status:', loginRes.status);
        console.log('Login Response:', JSON.stringify(loginData, null, 2));

        if (loginData.token) {
            console.log('✅ Login Successful');
            // Check for expected fields
            console.log('Has id:', !!loginData.id);
            console.log('Has user_id:', !!loginData.user_id);
            console.log('Has user object:', !!loginData.user);
        } else {
            console.error('❌ Login Failed (No Token)');
        }

    } catch (e) {
        console.error('Login Error:', e.message);
    }
}

testCustomerFlow();
