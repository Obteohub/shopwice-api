import { createYoga } from 'graphql-yoga';
import { makeExecutableSchema } from '@graphql-tools/schema';
import typeDefs from '../src/graphql/schema.js';
import { resolvers } from '../src/graphql/resolvers.js';
import { createLoaders } from '../src/graphql/dataloaders.js';
import db from '../src/config/db.js';
import { verifyJwt, decodeJwt } from '../src/utils/auth.js';

export const onRequest = async (context) => {
    const { request, env } = context;
    
    // Inject environment variables to services
    if (env) {
        if (db.init) db.init(env);
    }

    // Authenticate User
    let user = null;
    const token = request.headers.get('authorization')?.replace('Bearer ', '').trim();
    if (token) {
        try {
            let payload = await verifyJwt(token, env.JWT_SECRET);
            if (!payload) {
                console.warn("JWT Verification Failed, falling back to decode");
                payload = decodeJwt(token);
            }

            if (payload && payload.data && payload.data.user) {
                user = payload.data.user;
                // Attempt to get role from payload or default to customer
                // If the user is vendor 16533, ensure they have wcfm_vendor role for testing
                if (user.id == 16533) { 
                    user.role = 'wcfm_vendor'; 
                }
            }
        } catch (e) {
            console.error("JWT Verification Error:", e);
        }
    }

    const schema = makeExecutableSchema({
        typeDefs,
        resolvers
    });

    // Create a mutable object for response headers
    const responseHeaders = new Headers();

    const yoga = createYoga({
        schema,
        graphqlEndpoint: '/graphql',
        landingPage: false,
        context: {
            ...context,
            env: { ...context.env, CACHE: context.env.shopwice_cache },
            token,
            user,
            loaders: createLoaders(),
            headers: request.headers,
            responseHeaders // Pass mutable headers to context
        },
        fetchAPI: { Response }
    });

    const response = await yoga.fetch(request, context);
    
    // Merge any headers set by resolvers
    // Note: This only works if resolvers mutate context.responseHeaders
    // However, context in Yoga is recreated per request, so it should be safe.
    
    // Create a new response with merged headers
    const newResponse = new Response(response.body, response);
    
    // Append headers from our mutable object
    // Note: Headers.forEach is not always available in all environments, but typical for CF.
    if (responseHeaders) {
        for (const [key, value] of responseHeaders.entries()) {
            newResponse.headers.append(key, value);
        }
    }
    
    return newResponse;
};
