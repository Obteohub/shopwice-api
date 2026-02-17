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

function uploadImage(token) {
    return new Promise((resolve, reject) => {
        const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
        const filename = 'test-product-image.jpg';
        // Minimal valid JPEG
        const fileContent = Buffer.from([
            0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00,
            0xFF, 0xDB, 0x00, 0x43, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
            0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00, 0x01,
            0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
            0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03, 0x03, 0x02, 0x04, 0x03, 0x05,
            0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D, 0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13,
            0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08, 0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24,
            0x33, 0x62, 0x72, 0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2A, 0x34, 0x35, 0x36,
            0xFF, 0xDA, 0x00, 0x0C, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3F, 0x00, 0xF9, 0xFE, 0x8A, 0x28, 0xA0, 0x0F,
            0xFF, 0xD9
        ]);

        const postDataStart = Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
            `Content-Type: image/jpeg\r\n\r\n`
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
                'Content-Length': postDataStart.length + fileContent.length + postDataEnd.length
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const json = JSON.parse(body);
                        resolve(json);
                    } catch (e) {
                        reject(new Error('Invalid JSON response'));
                    }
                } else {
                    reject(new Error(`Upload Failed: ${res.statusCode} - ${body}`));
                }
            });
        });
        req.on('error', reject);
        req.write(postDataStart);
        req.write(fileContent);
        req.write(postDataEnd);
        req.end();
    });
}

function createProduct(token, imageId, imageUrl) {
    return new Promise((resolve, reject) => {
        const productData = {
            name: `Test Product Recreated ${Date.now()}`,
            type: 'simple',
            regular_price: '99.99',
            description: 'Created with image upload test',
            short_description: 'Test',
            categories: [{ id: 15 }], // Assuming category 15 exists
            images: [
                {
                    src: imageUrl,
                    id: imageId
                }
            ]
        };

        const data = JSON.stringify(productData);
        const options = {
            hostname: HOST,
            port: PORT,
            path: '/api/products', // Or /api/vendor/products?
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        // Note: Generic /api/products might be GET only or Admin only?
        // /api/vendor/products is likely the vendor endpoint.
        // Let's try /graphql first as that's what frontend uses usually?
        // Actually, let's use the REST endpoint the user likely uses.
        // functions/api/[[route]].js has router.post('/vendor/products', ...)
        options.path = '/api/vendor/products';

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const json = JSON.parse(body);
                        resolve(json);
                    } catch (e) {
                        // Sometimes it might return empty body if 204?
                        resolve({ success: true, body });
                    }
                } else {
                    reject(new Error(`Create Product Failed: ${res.statusCode} - ${body}`));
                }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

(async () => {
    try {
        console.log(`Connecting to ${PROTOCOL}://${HOST}:${PORT}`);
        const token = await login();
        console.log('Login successful.');

        console.log('Uploading image...');
        const imageResult = await uploadImage(token);
        console.log('Upload successful. Image ID:', imageResult.id);

        console.log('Creating product...');
        const productResult = await createProduct(token, imageResult.id, imageResult.source_url);
        console.log('Product created successfully!');
        console.log('Product ID:', productResult.id);

    } catch (error) {
        console.error('Error:', error.message);
    }
})();
