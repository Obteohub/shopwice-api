const fs = require('fs');

// Usage: node scripts/download_products.js <CONSUMER_KEY> <CONSUMER_SECRET> [SITE_URL]
const args = process.argv.slice(2);
const CK = args[0];
const CS = args[1];
const SITE_URL = args[2] || 'https://shopwice.com';

if (!CK || !CS) {
    console.error('❌ Missing Credentials');
    console.error('Usage: node scripts/download_products.js <CK_...> <CS_...>');
    process.exit(1);
}

const PER_PAGE = 100;
const OUTPUT_FILE = './products.json';

async function fetchAllProducts() {
    let allProducts = [];
    let page = 1;
    let keepFetching = true;

    console.log(`🚀 Starting download from ${SITE_URL}...`);

    while (keepFetching) {
        console.log(`   Fetching page ${page}...`);
        
        const url = `${SITE_URL}/wp-json/wc/v3/products?per_page=${PER_PAGE}&page=${page}&consumer_key=${CK}&consumer_secret=${CS}`;
        
        try {
            const res = await fetch(url);
            
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`API Error (${res.status}): ${text}`);
            }

            const products = await res.json();

            if (products.length === 0) {
                keepFetching = false;
            } else {
                allProducts = allProducts.concat(products);
                console.log(`   ✅ Got ${products.length} products.`);
                page++;
            }

        } catch (error) {
            console.error('❌ Download failed:', error.message);
            process.exit(1);
        }
    }

    console.log(`\n📦 Total Products Downloaded: ${allProducts.length}`);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allProducts, null, 2));
    console.log(`💾 Saved to ${OUTPUT_FILE}`);
    console.log(`\n👉 Next Step: Run 'npm run db:seed ${OUTPUT_FILE}' to import them.`);
}

fetchAllProducts();
