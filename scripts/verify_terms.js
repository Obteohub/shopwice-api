
const BASE_URL = 'http://127.0.0.1:8788';

async function verifyEndpoints() {
    const endpoints = [
        '/api/categories',
        '/api/brands',
        '/api/tags',
        '/api/locations'
    ];

    console.log('Verifying Term Endpoints...\n');

    for (const ep of endpoints) {
        try {
            const res = await fetch(`${BASE_URL}${ep}`);
            if (!res.ok) {
                console.error(`❌ ${ep} FAILED: ${res.status}`);
                continue;
            }
            
            const data = await res.json();
            const count = Array.isArray(data) ? data.length : (data.nodes ? data.nodes.length : 0);
            
            console.log(`✅ ${ep}: Found ${count} items.`);
            
            if (count > 0) {
                const sample = Array.isArray(data) ? data[0] : data.nodes[0];
                console.log(`   Sample: [ID: ${sample.id}] ${sample.name}`);
                if (ep === '/api/categories' && sample.image) {
                    console.log(`   Image: ${sample.image.src}`);
                }
            } else {
                console.log(`   ⚠️ No items found.`);
            }

        } catch (e) {
            console.error(`❌ ${ep} ERROR: ${e.message}`);
        }
        console.log('---');
    }
}

verifyEndpoints();
