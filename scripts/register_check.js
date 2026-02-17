require('dotenv').config();
const WooCommerceClient = require('../src/utils/wc-client');

async function checkUser() {
    const wc = new WooCommerceClient({
        WC_URL: process.env.WC_URL,
        WC_CONSUMER_KEY: process.env.WC_CONSUMER_KEY,
        WC_CONSUMER_SECRET: process.env.WC_CONSUMER_SECRET
    });

    try {
        console.log('Attempting to register kwessi@gmail.com to check existence...');
        
        const data = {
            email: 'kwessi@gmail.com',
            username: 'kwessi', // Try username
            password: 'Password123!', // Dummy password
            role: 'customer' // Try customer first
        };

        const response = await wc.post('/customers', data);
        console.log('User created (unexpectedly):', response.id);
        
    } catch (error) {
        console.log('Registration failed as expected.');
        console.log('Error Code:', error.data ? error.data.code : 'No code');
        console.log('Error Message:', error.message);
        
        if (error.data && error.data.data && error.data.data.resource_id) {
             console.log('Found Resource ID:', error.data.data.resource_id);
        } else {
            // Sometimes the ID is not returned in the error.
            // But let's see the full error data.
            console.log('Full Error Data:', JSON.stringify(error.data, null, 2));
        }
    }
}

checkUser();
