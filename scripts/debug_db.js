
const db = require('../src/config/db');
require('dotenv').config();

async function testConnection() {
    console.log("Testing DB Connection...");
    console.log("Host:", process.env.DB_HOST);
    console.log("User:", process.env.DB_USER);
    console.log("DB:", process.env.DB_NAME);
    
    try {
        const [rows] = await db.query('SELECT 1 as val');
        console.log("Success:", rows);
    } catch (e) {
        console.error("Connection Failed:", e);
    }
}

testConnection();
