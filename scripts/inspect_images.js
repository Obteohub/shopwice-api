
const dbConfig = require('../src/config/db.js');

// Mock D1 with data to simulate the issue
const mockD1 = {
    prepare: (sql) => ({
        bind: (...params) => ({
            all: async () => {
                console.log(`[SQL] ${sql} | Params: ${JSON.stringify(params)}`);

                // Simulate products query
                if (sql.includes('FROM wp_posts p') && sql.includes('LIMIT')) {
                    return {
                        results: [{
                            id: 101, name: 'Test Product', slug: 'test-product',
                            price: 10, regularPrice: 10, stock_quantity: 5, onSale: 0,
                            averageRating: 0, ratingCount: 0
                        }],
                        meta: {}
                    };
                }

                // Simulate _thumbnail_id meta retrieval
                if (sql.includes("_thumbnail_id")) {
                    // Scenario 1: Meta missing
                    // return { results: [], meta: {} };

                    // Scenario 2: Meta exists but points to non-existent post
                    // return { results: [{ post_id: 101, meta_value: '999' }], meta: {} };

                    // Scenario 3: Meta exists, ID exists
                    return { results: [{ post_id: 101, meta_value: '201' }], meta: {} };
                }

                // Simulate Attachment retrieval
                if (sql.includes('FROM wp_posts WHERE ID IN') && sql.includes('201')) {
                    // Scenario A: Guid is empty
                    return { results: [{ ID: 201, guid: '' }], meta: {} };

                    // Scenario B: Guid exists
                    // return { results: [{ ID: 201, guid: 'https://example.com/image.jpg' }], meta: {} };
                }

                if (sql.includes('count')) return { results: [{ total: 1 }], meta: {} };

                return { results: [], meta: {} };
            }
        })
    })
};

const mockKV = {
    get: async () => null,
    put: async () => { }
};

const env = { DB: mockD1, CACHE: mockKV };
dbConfig.init(env);

// Loaders
const { createLoaders } = require('../src/graphql/dataloaders.js');
const loaders = createLoaders();

async function inspectImages() {
    const { resolvers } = require('../src/graphql/resolvers.js');
    console.log('--- Inspecting Images via Resolvers ---');

    const result = await resolvers.Query.products(null, {}, { loaders, env });
    console.log('Result:', JSON.stringify(result.nodes[0].image, null, 2));
}

inspectImages().catch(console.error);
