
require('dotenv').config();

const API_URL = 'http://localhost:8788/api'; // I need to run this against the local wrangler dev server? 
// Or I can test against the real endpoint if deployed?
// The user context says "shopwice-api" is the project.
// I can assume the `[[route]].js` is deployed or I can run it locally.
// But wait, I can just use the underlying logic of login directly in a script.

const WC_URL = process.env.WC_URL;
const USERNAME = 'kwessi@gmail.com';
const PASSWORD = 'Black25';

async function testLogin() {
    console.log(`Attempting to login as ${USERNAME}...`);
    try {
        const url = `http://127.0.0.1:8788/api/auth/login`;
        console.log(`POST ${url}`);
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: USERNAME, password: PASSWORD })
        });

        if (!res.ok) {
            console.error('Login failed:', res.status);
            const text = await res.text();
            console.log(text);
            return;
        }

        const data = await res.json();
        console.log('Login Success!');
        console.log('Full Data:', JSON.stringify(data, null, 2));
        console.log('Token:', data.token ? data.token.substring(0, 20) + '...' : 'MISSING');
        console.log('User Email:', data.user_email);
        console.log('User ID:', data.user_id || (data.data && data.data.user ? data.data.user.id : 'Unknown'));

        return data.token;

    } catch (e) {
        console.error('Exception:', e.message);
    }
}

testLogin();
