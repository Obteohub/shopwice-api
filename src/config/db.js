const mysql = require('mysql2/promise');
require('dotenv').config();

let pool = null;
let mockPool = null;

const getPool = () => {
    if (mockPool) return mockPool;
    if (pool) return pool;

    const config = {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 10, // Lower limit for serverless
        queueLimit: 0,
        ssl: process.env.DB_SSL === 'true' || process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
    };

    pool = mysql.createPool(config);
    return pool;
};

// Export a Proxy that forwards all operations to the lazy-loaded pool
module.exports = new Proxy({}, {
    get: function(target, prop) {
        // Allow injecting a mock pool for testing
        if (prop === 'setMock') {
            return (mock) => { mockPool = mock; };
        }

        // Allow access to the init function if we want to manually inject env
        if (prop === 'init') {
            return (env) => {
                if (env) {
                    Object.assign(process.env, env);
                }
            };
        }
        
        const p = getPool();
        const value = p[prop];
        
        // If the property is a function, bind it to the pool
        if (typeof value === 'function') {
            return value.bind(p);
        }
        return value;
    }
});
