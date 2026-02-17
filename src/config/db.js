/**
 * Cloudflare D1 Database Adapter
 * Replaces mysql2 pool with D1 client
 */

let d1 = null;

module.exports = {
    init: (env) => {
        if (env && env.DB) {
            d1 = env.DB;
        }
    },

    // Adapter to match mysql2 query interface: query(sql, params) -> [rows, fields]
    query: async (sql, params = []) => {
        if (!d1) {
            throw new Error("Database not initialized. Call init(env) first.");
        }

        // Validate params to ensure no undefined values (causes D1 bind error 1101)
        const safeParams = params.map(p => (p === undefined ? null : p));

        try {
            const stmt = d1.prepare(sql).bind(...safeParams);
            const result = await stmt.all();
            
            // mysql2 returns [rows, fields]
            // D1 returns { results: [], success: true, meta: ... }
            return [result.results, result.meta];
        } catch (error) {
            console.error("D1 Query Error:", error.message, "SQL:", sql, "Params:", safeParams);
            throw error;
        }
    },

    // Transaction helper
    transaction: async (callback) => {
        if (!d1) throw new Error("Database not initialized");
        // D1 batching can simulate transactions for simple cases, 
        // but true interactive transactions require the new D1 transaction API
        // For now, we'll execute directly (Warning: not atomic)
        return callback(module.exports);
    }
};
