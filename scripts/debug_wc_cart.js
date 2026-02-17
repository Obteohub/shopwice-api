const WC_URL = 'https://shopwice.com';
const PRODUCTS_URL = `${WC_URL}/wp-json/wc/store/v1/products?per_page=5`;

async function listLiveProducts() {
    console.log(`Fetching ${PRODUCTS_URL}...`);
    try {
        const res = await fetch(PRODUCTS_URL, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log('Status:', res.status);
        if (!res.ok) {
            console.error('Failed to fetch products');
            return;
        }
        
        const data = await res.json();
        data.forEach(p => {
            console.log(`ID: ${p.id} | Name: ${p.name} | Price: ${p.prices.price}`);
        });
        
    } catch (e) {
        console.error('Error:', e);
    }
}

listLiveProducts();
