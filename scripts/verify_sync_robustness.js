const db = require('../src/config/db');
const SyncService = require('../src/services/syncService');

// Mock DB
db.query = async (sql, params) => {
    console.log('SQL:', sql.replace(/\s+/g, ' ').trim());
    console.log('Params:', JSON.stringify(params));

    // Return empty results for checks
    if (sql.includes('SELECT') && (sql.includes('term_id') || sql.includes('term_taxonomy_id'))) {
        return [[{ term_id: 100, term_taxonomy_id: 200 }]];
    }
    if (sql.includes('SELECT last_insert_rowid')) {
        return [[{ id: 999 }]];
    }

    return [[]];
};

const mockProduct = {
    id: 43330,
    name: 'Test Product Robust Sync',
    sku: 'TEST-ROBUST-001',
    price: '199',
    total_sales: 55,
    meta_data: [
        { key: '_product_attributes', value: 'a:1:{s:8:"pa_color";a:6:{s:4:"name";s:8:"pa_color";s:5:"value";s:0:"";s:8:"position";i:0;s:10:"is_visible";i:1;s:12:"is_variation";i:1;s:11:"is_taxonomy";i:1;}}' },
        { key: '_upsell_ids', value: [101, 102] },
        { key: '_crosssell_ids', value: [201, 202] },
        { key: '_custom_field', value: 'custom_value' }
    ],
    product_location: [
        { id: 501, name: 'Warehouse A', slug: 'warehouse-a' }
    ],
    attributes: [
        { id: 1, name: 'Color', slug: 'pa_color', options: ['Red', 'Blue'] }
    ],
    upsell_ids: [101, 102],
    cross_sell_ids: [201, 202],
    images: [{ id: 888, src: 'http://test.com/img.jpg' }]
};

async function run() {
    console.log('--- STARTING ROBUST SYNC VERIFICATION ---');
    try {
        await SyncService.syncProduct(mockProduct);
        console.log('\n--- VERIFICATION FINISHED SUCCESSFULLY ---');
    } catch (e) {
        console.error('\n--- VERIFICATION FAILED ---', e);
    }
}

run();
