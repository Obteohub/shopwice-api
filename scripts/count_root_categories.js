const BASE_URL = 'https://api.shopwice.com';
const GRAPHQL_URL = `${BASE_URL}/graphql`;

async function countRootCategories() {
    console.log('Fetching categories from', GRAPHQL_URL);
    
    const query = `
        query {
            categories {
                id
                name
                parent
            }
        }
    `;

    try {
        const res = await fetch(GRAPHQL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        
        const json = await res.json();
        
        if (json.errors) {
            console.error('GraphQL Errors:', json.errors);
            return;
        }
        
        const allCats = json.data.categories;
        console.log(`Total Categories Fetched: ${allCats.length}`);
        
        // Filter for root categories (parent is 0 or null)
        const rootCats = allCats.filter(c => c.parent === 0 || c.parent === null);
        
        console.log(`\n✅ Root Categories (No Parents): ${rootCats.length}`);
        
        // Optional: List a few for verification
        if (rootCats.length > 0) {
            console.log('Sample Root Categories:');
            rootCats.slice(0, 10).forEach(c => console.log(`- ${c.name} (ID: ${c.id})`));
        }
        
    } catch (e) {
        console.error('Error:', e.message);
    }
}

countRootCategories();
