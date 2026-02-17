
const dbConfig = require('../src/config/db.js');

// Mock D1 to simulate the user's specific bad data
const mockD1 = {
    prepare: (sql) => ({
        bind: (...params) => ({
            all: async () => {
                console.log(`[SQL] ${sql} | Params: ${JSON.stringify(params)}`);

                // Simulate retrieving the specific bad products
                if (sql.includes('FROM wp_posts p') && sql.includes('207137')) {
                    return {
                        results: [{
                            id: 207137, name: 'Apple USB C Travel Adaptor', slug: 'apple-usb-c-travel-adaptor',
                            price: 0, regularPrice: 0, stock_quantity: 0, onSale: 0,
                            averageRating: 0, ratingCount: 0,
                            // Simulating the issue: imageId might be null or pointing to a bad attachment
                            imageId: '99999'
                        }],
                        meta: {}
                    };
                }

                // Simulate _thumbnail_id meta retrieval
                if (sql.includes("_thumbnail_id") && params.includes(207137)) {
                    // The meta exists, but points to an attachment ID
                    return { results: [{ post_id: 207137, meta_value: '99999' }], meta: {} };
                }

                // Simulate Attachment retrieval
                if (sql.includes('FROM wp_posts WHERE ID IN') && (params.includes('99999') || sql.includes('99999'))) {
                    // Critical: The attachment exists but has NO GUID (this is what caused the issue before fix)
                    return { results: [{ ID: 99999, guid: '' }], meta: {} };
                }

                if (sql.includes('count')) return { results: [{ total: 1 }], meta: {} };

                return { results: [], meta: {} };
            }
        })
    })
};

const mockKV = { get: async () => null };

const env = { DB: mockD1, CACHE: mockKV };
dbConfig.init(env);

const { createLoaders } = require('../src/graphql/dataloaders.js');
const loaders = createLoaders();

async function inspectSpecificProduct() {
    const { resolvers } = require('../src/graphql/resolvers.js');
    console.log('--- Inspecting Product 207137 ---');

    // We mock the loader to force a fresh fetch or just rely on the mock DB
    const result = await resolvers.Query.product(null, { id: 207137 }, { loaders, env });

    console.log('Product Image Data:', JSON.stringify(result.image, null, 2));
}

inspectSpecificProduct().catch(console.error);
