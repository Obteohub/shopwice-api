const https = require('https');

const username = 'kwessi@gmail.com';
const password = 'Black25';

const data = JSON.stringify({
    username: username,
    password: password
});

const options = {
    hostname: 'shopwice.com',
    path: '/wp-json/jwt-auth/v1/token',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

console.log(`Testing direct login to https://shopwice.com/wp-json/jwt-auth/v1/token...`);

const req = https.request(options, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        console.log(`Body: ${body}`);
    });
});

req.on('error', (e) => {
    console.error(`Error: ${e.message}`);
});

req.write(data);
req.end();
