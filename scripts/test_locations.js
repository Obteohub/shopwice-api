
const BASE_URL = 'http://localhost:8787';

async function testLocations() {
    console.log('Fetching locations...');
    const query = `
        query {
            productLocations {
                nodes {
                    id
                    name
                    slug
                    count
                }
            }
        }
    `;

    try {
        const response = await fetch(`${BASE_URL}/graphql`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query })
        });

        const data = await response.json();
        
        if (data.errors) {
            console.error('GraphQL Errors:', data.errors);
            return;
        }

        const locations = data.data.productLocations.nodes;
        console.log(`Found ${locations.length} locations:`);
        locations.forEach(loc => {
            console.log(`- ${loc.name} (slug: ${loc.slug}, count: ${loc.count})`);
        });

    } catch (error) {
        console.error('Error fetching locations:', error);
    }
}

testLocations();
