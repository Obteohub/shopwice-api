import { onRequest } from '../functions/api/[[route]].js';

async function test() {
    console.log('Testing Cloudflare Functions Router...');

    // Mock Context
    const context = {
        request: new Request('http://localhost/api/health'),
        env: {
            NODE_ENV: 'test'
        },
        waitUntil: () => {}
    };

    try {
        const response = await onRequest(context);
        if (response.status !== 200) {
            throw new Error(`Status ${response.status}`);
        }
        const data = await response.json();
        console.log('Response:', data);
        
        if (data.status === 'UP') {
            console.log('✅ Health check passed');
        } else {
            console.log('❌ Health check failed');
        }
    } catch (e) {
        console.error('❌ Error:', e);
    }
}

test();
