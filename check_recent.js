const db = require('./src/config/db');

async function check() {
    console.log('Checking recent posts...');
    try {
        const [rows] = await db.query(`
            SELECT ID, post_title, post_status, post_type, post_date 
            FROM wp_posts 
            ORDER BY post_date DESC 
            LIMIT 20
        `);
        console.table(rows);
    } catch (e) {
        console.error('Error:', e);
    }
}

check();
