const https = require('https');
const { URL } = require('url');

const CK = 'ck_fb44dd511071306357e91233109bb5725639d88c';
const CS = 'cs_41c396912693a16097ef527101b8c6747e448372';
const SITE_URL = 'https://shopwice.com';

async function fetchJson(endpoint, params = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(SITE_URL + endpoint);
        if (endpoint.includes('/wc/v3/')) {
            url.searchParams.append('consumer_key', CK);
            url.searchParams.append('consumer_secret', CS);
        }
        Object.keys(params).forEach(k => url.searchParams.append(k, params[k]));

        console.log(`Fetching ${url.toString()}...`);

        https.get(url.toString(), {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'application/json'
            },
            timeout: 30000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 400) {
                    reject(new Error(`API Error ${res.statusCode}`));
                    return;
                }
                try {
                    const json = JSON.parse(data);
                    resolve(json);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function run() {
    try {
        console.log("Fetching Categories...");
        const categories = await fetchJson('/wp-json/wc/v3/products/categories', { per_page: 20 });
        console.log(`Got ${categories.length} categories.`);
        console.log('Sample:', categories[0]);
    } catch (e) {
        console.error("Error:", e);
    }
}

run();
