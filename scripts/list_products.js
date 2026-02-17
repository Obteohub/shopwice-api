const BASE_URL = 'http://127.0.0.1:8788';
const GRAPHQL_URL = `${BASE_URL}/graphql`;

async function listProducts() {
    const query = `
        query {
            products(first: 5) {
                nodes {
                    id
                    databaseId
                    name
                    stockStatus
                    price
                }
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
        console.log(JSON.stringify(json, null, 2));
    } catch (e) {
        console.error(e);
    }
}

listProducts();
