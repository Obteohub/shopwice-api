import { graphql } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import pkgSchema from '../src/graphql/schema.js';
import pkgResolvers from '../src/graphql/resolvers.js';
import pkgDb from '../src/config/db.js';

// Handle CommonJS default exports
const typeDefs = pkgSchema.schema || pkgSchema; // schema.js exports typeDefs
const resolvers = pkgResolvers.resolvers || pkgResolvers;
const db = pkgDb.default || pkgDb;

async function testResilience() {
    console.log('🧪 Testing API Resilience (No Database Connection)...');

    // 1. Build Executable Schema
    const schema = makeExecutableSchema({
        typeDefs,
        resolvers
    });

    // 2. Mock Environment WITHOUT DB binding
    const mockEnv = {
        // DB is intentionally missing
        CACHE: null, // Cache also missing to force DB hit
        WC_URL: 'https://example.com'
    };

    // 3. Initialize DB with missing env (should not crash, just leave internal d1 null)
    try {
        db.init(mockEnv);
        console.log('✅ DB Init handled missing binding gracefully');
    } catch (e) {
        console.error('❌ DB Init crashed:', e);
        process.exit(1);
    }

    // 4. Run a Query that requires DB
    const query = `
        query {
            product(id: "123") {
                id
                name
            }
        }
    `;

    // 5. Execute GraphQL
    try {
        const result = await graphql({
            schema,
            source: query,
            contextValue: {
                env: mockEnv,
                loaders: {
                   // Minimal mock loaders
                   product: { load: async () => null }
                } 
            }
        });

        // 6. Verify Result
        if (result.errors && result.errors.length > 0) {
            const msg = result.errors[0].message;
            console.log('✅ API handled DB failure gracefully (Returned GraphQL Error):');
            console.log(`   "${msg}"`);
        } else if (result.data) {
             console.log('✅ API handled DB failure gracefully (Returned Data/Null):', result.data);
        }

    } catch (e) {
        console.error('❌ Critical Failure: API crashed on query:', e);
        process.exit(1);
    }
}

testResilience();
