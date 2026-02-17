
require('dotenv').config();
const { execSync } = require('child_process');

function executeSql(sql) {
    try {
        const cleanSql = sql.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim();
        const cmdSql = cleanSql.replace(/"/g, '\\"');
        console.log(`Executing: ${cmdSql}`);
        const output = execSync(`npx wrangler d1 execute shopwice-db --local --command "${cmdSql}"`, { stdio: 'pipe' }).toString();
        console.log(output);
    } catch (e) {
        console.error("SQL Execution Error:", e.message);
        if (e.stdout) console.log(e.stdout.toString());
        if (e.stderr) console.error(e.stderr.toString());
    }
}

async function run() {
    console.log("Checking wp_wcfm_marketplace_orders table...");
    
    // Check table structure/existence
    executeSql(`SELECT name FROM sqlite_master WHERE type='table' AND name='wp_wcfm_marketplace_orders'`);

    // Check count of orders
    executeSql(`SELECT COUNT(*) as total FROM wp_wcfm_marketplace_orders`);

    // Check first 5 rows
    executeSql(`SELECT * FROM wp_wcfm_marketplace_orders LIMIT 5`);

    // Check for a specific vendor (e.g., 16326)
    console.log("Checking orders for vendor 16326...");
    executeSql(`SELECT * FROM wp_wcfm_marketplace_orders WHERE vendor_id = 16326 LIMIT 5`);
}

run();
