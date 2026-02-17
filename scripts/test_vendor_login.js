const https = require('https');

const username = 'kwessi@gmail.com';
const password = 'Black25';
const hostname = 'shopwice-api.pages.dev';
const path = '/api/auth/login';

const data = JSON.stringify({
    username: username,
    password: password
});

const options = {
    hostname: hostname,
    path: path,
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'User-Agent': 'Node/Test'
    }
};

console.log(`Testing login for vendor ${username} on https://${hostname}${path}...`);

const req = https.request(options, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
        console.log(`\nStatus Code: ${res.statusCode}`);
        try {
            const json = JSON.parse(body);
            if (res.statusCode === 200) {
                console.log('Login Successful! ✅');
                console.log('Full Response:', JSON.stringify(json, null, 2));
            } else {
                console.log('Login Failed ❌');
                console.log('Error:', json);
            }
        } catch (e) {
            console.log('Response Body:', body);
        }
    });
});

req.on('error', (e) => {
    console.error(`Error: ${e.message}`);
});

req.write(data);
req.end();
