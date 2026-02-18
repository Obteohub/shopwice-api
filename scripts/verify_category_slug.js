
const fs = require('fs');

function log(msg, data = '') {
    const str = typeof msg === 'string' ? msg : JSON.stringify(msg);
    const dataStr = data ? (typeof data === 'string' ? data : JSON.stringify(data)) : '';
    const line = `${str} ${dataStr}\n`;
    try {
        fs.appendFileSync('verification.txt', line);
    } catch (e) {
        console.log("Error writing to file:", e.message);
    }
    console.log(str, dataStr);
}

// Clear file
try {
    fs.writeFileSync('verification.txt', '');
} catch (e) { }

const db = require('../src/config/db');

// Mock specific DB queries
db.query = async (sql, params) => {
    const sqlLower = sql.toLowerCase();

    // Log only the main product queries logic
    if (sqlLower.includes('from wp_posts') && (sqlLower.includes('slug') || sqlLower.includes('term_id'))) {
        log('Intercepted SQL:', sql.replace(/\s+/g, ' ').trim());
        log('Params:', params);
    }

    // Mock simple responses to keep resolver running
    if (sqlLower.includes('count')) return [[{ total: 0 }]]; // Count query
    if (sqlLower.includes('select distinct')) return [[{ id: 1 }]]; // Main product query
    if (sqlLower.includes('wp_postmeta')) return [[]]; // Meta loader

    return [[]]; // Default empty
};

const { resolvers } = require('../src/graphql/resolvers');

async function runTest() {
    log('--- Testing Category Slug: aux-cables ---');
    const context = {
        loaders: {
            skuLoader: { loadMany: () => [] },
            imageLoader: { loadMany: () => [] },
            taxonomyLoader: { loadMany: () => [] },
            metaLoader: { loadMany: () => [] },
            excerptLoader: { loadMany: () => [] }
        }
    };

    try {
        await resolvers.Query.products(null, { category: 'aux-cables' }, context);
    } catch (e) {
    }

    log('\n--- Testing Category ID: 123 ---');
    try {
        await resolvers.Query.products(null, { category: '123' }, context);
    } catch (e) {
    }
}

runTest();
