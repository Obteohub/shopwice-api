const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Usage: node scripts/import_from_json.js ./path/to/data.json
const dataFile = process.argv[2];

if (!dataFile) {
    console.error('Please provide a path to the JSON data file.');
    console.error('Usage: node scripts/import_from_json.js ./data.json');
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

// Tables to import
const tables = [
    'wp_posts',
    'wp_postmeta',
    'wp_comments',
    'wp_commentmeta',
    'wp_terms',
    'wp_term_taxonomy',
    'wp_term_relationships',
    'wp_users',
    'wp_usermeta',
    'wp_wc_product_meta_lookup',
    'wp_woocommerce_attribute_taxonomies'
];

// Helper to escape strings for SQL
const escape = (str) => {
    if (str === null || str === undefined) return 'NULL';
    if (typeof str === 'number') return str;
    return `'${String(str).replace(/'/g, "''")}'`;
};

// Generate SQL insert statements
let sqlFileContent = '';

for (const table of tables) {
    if (data[table] && Array.isArray(data[table])) {
        console.log(`Processing ${table}...`);
        const rows = data[table];
        if (rows.length === 0) continue;

        // Get columns from first row
        const columns = Object.keys(rows[0]);
        
        // Split into chunks of 100 to avoid query length limits
        const chunkSize = 100;
        for (let i = 0; i < rows.length; i += chunkSize) {
            const chunk = rows.slice(i, i + chunkSize);
            const values = chunk.map(row => {
                return `(${columns.map(col => escape(row[col])).join(',')})`;
            }).join(',\n');

            const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES \n${values};\n`;
            sqlFileContent += sql;
        }
    }
}

const outPath = './import_data.sql';
fs.writeFileSync(outPath, sqlFileContent);
console.log(`Generated SQL import file at ${outPath}`);
console.log('Running import via Wrangler...');

try {
    // Execute the generated SQL
    execSync(`npx wrangler d1 execute shopwice-db --remote --file=${outPath}`, { stdio: 'inherit' });
    console.log('Import successful!');
    // Clean up
    fs.unlinkSync(outPath);
} catch (e) {
    console.error('Import failed:', e.message);
}
