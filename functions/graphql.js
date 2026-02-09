import { createYoga } from 'graphql-yoga';
import { makeExecutableSchema } from '@graphql-tools/schema';
import typeDefs from '../src/graphql/schema.js';
import { resolvers } from '../src/graphql/resolvers.js';
import { createLoaders } from '../src/graphql/dataloaders.js';
import db from '../src/config/db.js';

export const onRequest = async (context) => {
    const { request, env } = context;
    
    // Inject environment variables to services
    if (env) {
        if (db.init) db.init(env);
    }

    const schema = makeExecutableSchema({
        typeDefs,
        resolvers
    });

    const yoga = createYoga({
        schema,
        graphqlEndpoint: '/graphql',
        landingPage: false,
        context: {
            ...context,
            token: request.headers.get('authorization')?.replace('Bearer ', '').trim(),
            user: null,
            loaders: createLoaders()
        },
        fetchAPI: { Response }
    });

    return yoga.fetch(request, context);
};
