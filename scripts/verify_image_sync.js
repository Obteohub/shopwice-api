
const syncService = require('../src/services/syncService.js');
const dbConfig = require('../src/config/db.js');

// Mock D1
const mockStore = {
    posts: {},
    postmeta: {}
};

const mockD1 = {
    prepare: (sql) => ({
        bind: (...params) => ({
            all: async () => {
                // Simulate INSERT
                if (sql.includes('INSERT INTO wp_posts')) {
                    // Parse ID and Guid from params
                    // Values: [id, author, date, date_gmt, content, title, excerpt, status, comment, ping, name, mod, mod_gmt, parent, guid, ...]
                    const id = params[0];
                    const guid = params[14];
                    mockStore.posts[id] = { id, guid };
                    console.log(`[DB] Inserted Post ${id} with GUID: ${guid}`);
                    return { results: [], meta: {} };
                }
                return { results: [], meta: {} };
            }
        })
    })
};

const env = { DB: mockD1 };
dbConfig.init(env);

async function verifyImageSync() {
    console.log('--- Verifying Image Sync ---');

    // Test 1: Image with 'src'
    console.log('\nTest 1: Image with src');
    await syncService.syncImages([{ id: 101, src: 'https://example.com/img1.jpg' }], 0);

    // Test 2: Image with 'source_url'
    console.log('\nTest 2: Image with source_url');
    await syncService.syncImages([{ id: 102, source_url: 'https://example.com/img2.jpg' }], 0);

    // Test 3: Image with 'url'
    console.log('\nTest 3: Image with url');
    await syncService.syncImages([{ id: 103, url: 'https://example.com/img3.jpg' }], 0);

    // Test 4: Missing URL
    console.log('\nTest 4: Missing URL (Should log warning)');
    await syncService.syncImages([{ id: 104 }], 0);

}

verifyImageSync().catch(console.error);
