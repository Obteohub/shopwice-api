const http = require('http');
const https = require('https');

const USERNAME = 'kwessi@gmail.com';
const PASSWORD = 'Black25';
const HOST = process.env.HOST || 'localhost';
const PORT = process.env.PORT || 8788;
const PROTOCOL = 'http';

function login() {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ username: USERNAME, password: PASSWORD });
        const options = {
            hostname: HOST,
            port: PORT,
            path: '/api/auth/login',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const json = JSON.parse(body);
                        resolve(json.token);
                    } catch (e) {
                        reject(new Error('Invalid JSON response'));
                    }
                } else {
                    reject(new Error(`Login Failed: ${res.statusCode} - ${body}`));
                }
            });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

function upload(token) {
    return new Promise((resolve, reject) => {
        const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';

        const postDataStart = Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="file"\r\n\r\n` +
            `This is not a file, it is a string.`
        );
        const postDataEnd = Buffer.from(`\r\n--${boundary}--\r\n`);

        const options = {
            hostname: HOST,
            port: PORT,
            path: '/api/upload',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': postDataStart.length + postDataEnd.length
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                console.log(`Status: ${res.statusCode}`);
                console.log('Body:', body);
                resolve({ status: res.statusCode, body });
            });
        });

        req.on('error', reject);

        req.write(postDataStart);
        req.write(postDataEnd);
        req.end();
    });
}

(async () => {
    try {
        console.log(`Connecting to ${PROTOCOL}://${HOST}:${PORT}`);
        console.log('Logging in...');
        const token = await login();
        console.log('Login successful. Token received.');

        console.log('Uploading string (expecting error)...');
        await upload(token);

    } catch (error) {
        console.error('Error:', error.message);
        if (error.message.includes('ECONNREFUSED')) {
            console.error('Server is likely not running on port ' + PORT);
        }
    }
})();
