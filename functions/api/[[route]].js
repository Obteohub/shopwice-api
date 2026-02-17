import { getCollectionData } from '../../src/controllers/collectionData_cf.mjs';
import crypto from 'node:crypto';
import SyncService from '../../src/services/syncService.js';
import db from '../../src/config/db.js';

// ==========================================
// Simple Router Implementation
// ==========================================

class SimpleRouter {
    constructor({ base = '' } = {}) {
        this.base = base;
        this.routes = [];
    }

    add(method, path, handler) {
        this.routes.push({ method, path, handler });
    }

    get(path, handler) { this.add('GET', path, handler); }
    post(path, handler) { this.add('POST', path, handler); }
    put(path, handler) { this.add('PUT', path, handler); }
    delete(path, handler) { this.add('DELETE', path, handler); }
    all(path, handler) { this.add('ALL', path, handler); }

    async handle(request, env) {
        const url = new URL(request.url);
        let path = url.pathname;
        if (this.base && path.startsWith(this.base)) {
            path = path.slice(this.base.length);
        } else {
            // If base is not matched, it might be running in a context where /api is not stripped
            // In Pages Functions, the route might be /api/products, so if base is /api, we expect /products
            // But if we are called with /api/products and base is /api, the above slice works.
            // If we are called with /products directly (unlikely if folder is functions/api), we should be fine.
        }

        // Normalize path
        if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
        if (!path.startsWith('/')) path = '/' + path;

        for (const route of this.routes) {
            // Check method (support HEAD automatically if GET exists)
            const isHead = request.method === 'HEAD';
            const methodToCheck = isHead ? 'GET' : request.method;

            if (route.method !== 'ALL' && route.method !== methodToCheck) continue;

            const match = this.matchPath(route.path, path);
            if (match) {
                request.params = match.params;
                request.query = Object.fromEntries(url.searchParams);
                const response = await route.handler(request, env);

                // If HEAD request, strip body but keep headers
                if (isHead) {
                    return new Response(null, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers
                    });
                }
                return response;
            }
        }

        return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    matchPath(routePath, actualPath) {
        if (routePath === '*') return { params: {} };

        const routeParts = routePath.split('/').filter(Boolean);
        const actualParts = actualPath.split('/').filter(Boolean).map(decodeURIComponent);

        if (routeParts.length !== actualParts.length) return null;

        const params = {};
        for (let i = 0; i < routeParts.length; i++) {
            const r = routeParts[i];
            const a = actualParts[i];

            if (r.startsWith(':')) {
                params[r.slice(1)] = a;
            } else if (r !== a) {
                return null;
            }
        }

        return { params };
    }
}

// ==========================================
// CORS Helpers
// ==========================================

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-WC-Store-API-Nonce',
};

// ==========================================
// App Setup
// ==========================================

const router = new SimpleRouter({ base: '/api' });

// Helper for Mock Express Response
const mockExpress = (req, handler) => new Promise((resolve) => {
    const res = {
        status: (code) => ({
            json: (data) => resolve(new Response(JSON.stringify(data), {
                status: code,
                headers: { 'Content-Type': 'application/json' }
            }))
        }),
        json: (data) => resolve(new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        })),
        send: (data) => resolve(new Response(data, { status: 200 }))
    };

    if (!req.query) {
        const url = new URL(req.url);
        req.query = Object.fromEntries(url.searchParams);
    }

    handler(req, res);
});

// Middleware to inject env into process.env for legacy code
const injectEnv = (req, env) => {
    if (env) {
        Object.assign(process.env, env);
        // Initialize DB with D1
        if (db.init) db.init(env);
    }
};

// ==========================================
// Webhook Handler
// ==========================================
router.post('/webhooks/sync', async (req, env) => {
    injectEnv(req, env);

    const secret = env.WEBHOOK_SECRET;
    if (!secret) {
        console.error('WEBHOOK_SECRET is not set');
        return new Response('Webhook Secret not configured', { status: 500 });
    }

    const signature = req.headers.get('x-wc-webhook-signature');
    const topic = req.headers.get('x-wc-webhook-topic');

    if (!signature) return new Response('Missing Signature', { status: 401 });

    const rawBody = await req.text();

    // Verify Signature
    const hash = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
    if (hash !== signature) {
        return new Response('Invalid Signature', { status: 401 });
    }

    const payload = JSON.parse(rawBody);

    // Allowed term taxonomies: locations, categories, tags, brands, and product attributes (pa_*)
    const TERM_TAXONOMIES = ['product_cat', 'product_category', 'product_tag', 'product_brand', 'product_location'];
    const isAllowedTermTaxonomy = (tax) =>
        TERM_TAXONOMIES.includes(tax) || (typeof tax === 'string' && tax.startsWith('pa_'));

    try {
        console.log(`Received Webhook: ${topic}`);
        if (topic === 'product.created' || topic === 'product.updated') {
            await SyncService.syncProduct(payload);
            if (env.shopwice_cache) {
                await env.shopwice_cache.delete(`product_${payload.id}`);
                await env.shopwice_cache.put('product_list_version', Date.now().toString());
                console.log(`Cache invalidated for product_${payload.id} and list`);
            }
        } else if (topic === 'product.deleted') {
            await SyncService.deleteProduct(payload.id);
            if (env.shopwice_cache) {
                await env.shopwice_cache.delete(`product_${payload.id}`);
                await env.shopwice_cache.put('product_list_version', Date.now().toString());
            }
        } else {
            // Term webhooks: {taxonomy}.created | .updated | .deleted
            const termMatch = topic && topic.match(/^([a-z0-9_]+)\.(created|updated|deleted)$/);
            if (termMatch) {
                const [, taxonomy, action] = termMatch;
                const taxonomyNorm = taxonomy === 'product_category' ? 'product_cat' : taxonomy;
                if (!isAllowedTermTaxonomy(taxonomyNorm)) {
                    console.log(`Ignoring webhook for unsupported taxonomy: ${taxonomy}`);
                    return new Response('Synced', { status: 200 });
                }
                if (action === 'deleted') {
                    const termId = payload.id ?? payload.term_id;
                    if (termId != null) await SyncService.deleteTerm(termId, taxonomyNorm);
                } else {
                    await SyncService.syncTerm(payload, taxonomyNorm);
                }
                if (env.shopwice_cache) {
                    await env.shopwice_cache.delete(defaultKey);
                    await env.shopwice_cache.delete(`terms_${taxonomyNorm}`);

                    // Invalidate Category/Term List Versions
                    if (taxonomyNorm === 'product_cat') {
                        await env.shopwice_cache.put('category_list_version', Date.now().toString());
                    }
                    console.log(`Cache invalidated for terms_${taxonomyNorm}`);
                }
            }
        }

        return new Response('Synced', { status: 200 });
    } catch (e) {
        console.error('Sync Error:', e);
        return new Response(e.message, { status: 500 });
    }
});

// JWT Helper (Web Crypto API)
const signJwt = async (payload, secret) => {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const header = { alg: 'HS256', typ: 'JWT' };
    const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(`${encodedHeader}.${encodedPayload}`)
    );
    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
};

const decodeJwt = (token) => {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
};

// Fetch Helper Class
class FetchClient {
    constructor(env, type, token = null) {
        this.env = env;
        const WC_URL = env.WC_URL || process.env.WC_URL;
        const WC_KEY = env.WC_CONSUMER_KEY || process.env.WC_CONSUMER_KEY;
        const WC_SECRET = env.WC_CONSUMER_SECRET || process.env.WC_CONSUMER_SECRET;

        this.headers = {
            'User-Agent': 'Shopwice-CF-Worker/1.0',
            'Content-Type': 'application/json'
        };

        // If token is provided, use Bearer Auth (for Vendor actions)
        if (token) {
            this.headers['Authorization'] = 'Bearer ' + token;
        } else if (type !== 'wp' && type !== 'jwt' && type !== 'store') {
            // Otherwise use Basic Auth (Admin actions)
            this.headers['Authorization'] = 'Basic ' + btoa(`${WC_KEY}:${WC_SECRET}`);
        }

        this.baseURL = WC_URL;
        if (type === 'wc') this.baseURL += '/wp-json/wc/v3';
        else if (type === 'store') this.baseURL += '/wp-json/wc/store/v1';
        else if (type === 'wp') this.baseURL += '/wp-json/wp/v2';
        else if (type === 'jwt') this.baseURL += '/wp-json/jwt-auth/v1';
        else if (type === 'wcfm') this.baseURL += '/wp-json/wcfmmp/v1';
    }

    async get(endpoint, params = {}) {
        const url = new URL(this.baseURL + endpoint);
        Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

        const res = await fetch(url.toString(), { headers: this.headers });
        if (!res.ok) throw await this.handleError(res);
        return await res.json();
    }

    async post(endpoint, body = {}) {
        const res = await fetch(this.baseURL + endpoint, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify(body)
        });
        if (!res.ok) throw await this.handleError(res);
        return await res.json();
    }

    async delete(endpoint, params = {}) {
        const url = new URL(this.baseURL + endpoint);
        Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

        const res = await fetch(url.toString(), {
            method: 'DELETE',
            headers: this.headers
        });
        if (!res.ok) throw await this.handleError(res);
        return await res.json();
    }

    async handleError(res) {
        let data;
        try { data = await res.json(); } catch (e) { data = { error: res.statusText }; }
        const error = new Error(data.message || 'Request failed');
        error.status = res.status;
        error.data = data;
        return error;
    }
}

// ==========================================
// ROUTES
// ==========================================

router.get('/health', () => new Response(JSON.stringify({ status: 'UP', timestamp: new Date() }), { headers: { 'Content-Type': 'application/json' } }));

// Products
router.get('/products', async (req, env) => {
    injectEnv(req, env);

    // Use D1 Database instead of remote WP
    try {
        const { resolvers } = require('../../src/graphql/resolvers.js');
        const { createLoaders } = require('../../src/graphql/dataloaders.js');

        // Mock Context
        const context = {
            env: { ...env, CACHE: env.shopwice_cache },
            loaders: createLoaders(),
            waitUntil: (promise) => { if (env.waitUntil) env.waitUntil(promise); }
        };

        const args = { ...req.query };

        // Handle 'where' args simulation for REST params
        if (args.category) args.where = { categoryId: args.category };
        if (args.search) args.where = { search: args.search };

        // Call the GraphQL resolver logic directly
        const result = await resolvers.Query.products(null, args, context);

        // Transform GraphQL Connection result to REST array if needed
        // But keeping it structure similar to GraphQL is often better for consistency,
        // however standard WC REST API returns an array.
        // Let's flatten it to match WC REST API structure roughly

        const products = result.nodes;
        return new Response(JSON.stringify(products));

    } catch (e) {
        console.error('Products API Error:', e);
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
});



// Reviews
router.get('/reviews', async (req, env) => {
    injectEnv(req, env);
    const api = new FetchClient(env, 'wc');
    try {
        const data = await api.get('/products/reviews', req.query);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: 500 });
    }
});

router.get('/products/reviews', async (req, env) => {
    injectEnv(req, env);
    const api = new FetchClient(env, 'wc');
    try {
        const data = await api.get('/products/reviews', req.query);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: 500 });
    }
});

router.get('/products/:id', async (req, env) => {
    injectEnv(req, env);
    try {
        const { resolvers } = require('../../src/graphql/resolvers.js');
        const { createLoaders } = require('../../src/graphql/dataloaders.js');

        const context = {
            env: { ...env, CACHE: env.shopwice_cache },
            loaders: createLoaders(),
            waitUntil: (promise) => { if (env.waitUntil) env.waitUntil(promise); }
        };

        const product = await resolvers.Query.product(null, { id: req.params.id }, context);

        if (!product) {
            return new Response(JSON.stringify({ error: 'Product not found' }), { status: 404 });
        }

        return new Response(JSON.stringify(product));
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
});

// Collection Data
router.get('/collection-data', (req, env) => {
    injectEnv(req, env);
    req.env = env;
    return mockExpress(req, getCollectionData);
});

// Helper to run GraphQL resolvers
const runResolver = async (env, resolverName, args = {}) => {
    try {
        const { resolvers } = require('../../src/graphql/resolvers.js');
        const { createLoaders } = require('../../src/graphql/dataloaders.js');

        const context = {
            env: { ...env, CACHE: env.shopwice_cache },
            loaders: createLoaders(),
            waitUntil: (promise) => { if (env.waitUntil) env.waitUntil(promise); }
        };

        // Navigate to nested resolver if needed (e.g. Query.products)
        const resolver = resolverName.split('.').reduce((acc, part) => acc && acc[part], resolvers);
        if (!resolver) throw new Error(`Resolver ${resolverName} not found`);

        const result = await resolver(null, args, context);
        return result.nodes ? result.nodes : result;
    } catch (e) {
        console.error(`Resolver Error (${resolverName}):`, e);
        throw e;
    }
};

// Categories
router.get('/categories', async (req, env) => {
    injectEnv(req, env);
    try {
        const data = await runResolver(env, 'Query.productCategories', req.query);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
});

router.get('/categories/:id', async (req, env) => {
    injectEnv(req, env);
    try {
        // Support ID or Slug lookup
        const args = { where: /^\d+$/.test(req.params.id) ? { id: req.params.id } : { slug: req.params.id } };
        const data = await runResolver(env, 'Query.productCategories', args);
        return new Response(JSON.stringify(data[0] || { error: 'Category not found' }), {
            status: data.length ? 200 : 404
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
});

// Tags
router.get('/tags', async (req, env) => {
    injectEnv(req, env);
    try {
        const data = await runResolver(env, 'Query.productTags', req.query);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
});

router.get('/tags/:id', async (req, env) => {
    injectEnv(req, env);
    try {
        const args = { where: /^\d+$/.test(req.params.id) ? { id: req.params.id } : { slug: req.params.id } };
        const data = await runResolver(env, 'Query.productTags', args);
        return new Response(JSON.stringify(data[0] || { error: 'Tag not found' }), {
            status: data.length ? 200 : 404
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
});

// Attributes (Taxonomies)
router.get('/attributes', async (req, env) => {
    injectEnv(req, env);
    try {
        const data = await runResolver(env, 'Query.productAttributeTaxonomies', { where: req.query });
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
});

router.get('/attributes/:id', async (req, env) => {
    injectEnv(req, env);
    try {
        // WC REST uses numeric ID for attribute taxonomies
        const data = await runResolver(env, 'Query.productAttributeTaxonomies', { where: { id: req.params.id } });
        return new Response(JSON.stringify(data[0] || { error: 'Attribute not found' }), {
            status: data.length ? 200 : 404
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
});

router.get('/attributes/:id/terms', async (req, env) => {
    injectEnv(req, env);
    try {
        // First get the attribute taxonomy to find its slug (e.g. pa_color)
        const attrs = await runResolver(env, 'Query.productAttributeTaxonomies', { where: { id: req.params.id } });
        if (!attrs.length) return new Response(JSON.stringify({ error: 'Attribute not found' }), { status: 404 });

        const taxonomy = attrs[0].slug; // e.g. pa_color

        // Now fetch terms for this taxonomy
        // We use the generic 'terms' resolver directly or via a new helper? 
        // We can expose Query.terms in resolvers.js
        const { resolvers } = require('../../src/graphql/resolvers.js');
        const { createLoaders } = require('../../src/graphql/dataloaders.js');
        const context = { env: { ...env, CACHE: env.shopwice_cache }, loaders: createLoaders() };

        const result = await resolvers.Query.terms(null, { taxonomy, where: req.query }, context);
        return new Response(JSON.stringify(result.nodes));
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
});

// Brands
router.get('/brands', async (req, env) => {
    injectEnv(req, env);
    try {
        const data = await runResolver(env, 'Query.productBrands', req.query);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
});

// Locations
router.get('/locations', async (req, env) => {
    injectEnv(req, env);
    try {
        const data = await runResolver(env, 'Query.productLocations', req.query);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
});

// ==========================================
// VENDOR ROUTES
// ==========================================

// Helper to get user ID from token
const getUserIdFromRequest = (req) => {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) return null;
    const token = authHeader.replace('Bearer ', '');
    const decoded = decodeJwt(token);
    // Handle typical WP JWT structures
    if (decoded?.data?.user?.id) return decoded.data.user.id;
    if (decoded?.id) return decoded.id;
    if (decoded?.user_id) return decoded.user_id;
    return null;
};

// Public Vendor List
router.get('/vendor/list', async (req, env) => {
    injectEnv(req, env);
    const api = new FetchClient(env, 'wcfm');
    try {
        // WCFM usually uses /store-vendors for list
        const data = await api.get('/store-vendors', req.query);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: 500 });
    }
});

// Normalize product taxonomy fields for WooCommerce API compatibility
// Handles: locations, brands - supports multiple input formats
function normalizeProductTaxonomies(body) {
    if (!body || typeof body !== 'object') return body;
    const result = { ...body };

    // Locations: WooCommerce expects locations: [{id: n}, ...]
    const locRaw = result.locations ?? result.location_ids ?? result.product_location ?? result.location;
    if (locRaw !== undefined) {
        const arr = Array.isArray(locRaw) ? locRaw : [locRaw];
        result.locations = arr.map(v => (typeof v === 'object' && v?.id != null) ? v : { id: Number(v) }).filter(v => v.id && !isNaN(v.id));
        delete result.location_ids;
        delete result.product_location;
        delete result.location;
    }

    // Brands: WooCommerce expects brands: [{id: n}, ...]
    const brandRaw = result.brands ?? result.brand_ids ?? result.product_brand;
    if (brandRaw !== undefined) {
        const arr = Array.isArray(brandRaw) ? brandRaw : [brandRaw];
        result.brands = arr.map(v => (typeof v === 'object' && v?.id != null) ? v : { id: Number(v) }).filter(v => v.id && !isNaN(v.id));
        delete result.brand_ids;
        delete result.product_brand;
    }

    return result;
}

// Vendor Products (Protected)
router.get('/vendor/products', async (req, env) => {
    injectEnv(req, env);
    const authHeader = req.headers.get('authorization');
    const token = authHeader ? authHeader.replace('Bearer ', '') : null;
    const userId = req.query.vendor_id || getUserIdFromRequest(req);

    if (!userId || !token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    // Use standard WC API with Vendor Token for listing products
    // This ensures we see what the vendor sees (and WCFM filters it)
    const api = new FetchClient(env, 'wc', token);

    try {
        const params = { ...req.query };
        if (params.vendor_id) delete params.vendor_id;

        // Ensure status=any to see pending products
        if (!params.status) params.status = 'any';

        const data = await api.get('/products', params);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: e.status || 500 });
    }
});

router.post('/vendor/products', async (req, env) => {
    injectEnv(req, env);
    const authHeader = req.headers.get('authorization');
    const token = authHeader ? authHeader.replace('Bearer ', '') : null;
    const userId = getUserIdFromRequest(req);

    if (!userId || !token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    // Use standard WC API with Vendor Token
    // This allows WCFM to intercept the request and assign the product to the vendor automatically
    const api = new FetchClient(env, 'wc', token);

    try {
        const body = await req.json();

        // Normalize taxonomy fields (locations, brands) for WooCommerce API compatibility
        const normalizedBody = normalizeProductTaxonomies(body);

        // Proxy to WC
        const data = await api.post('/products', normalizedBody);

        // Sync to D1 immediately
        if (data && data.id) {
            // Ensure sync service uses the correct DB binding
            if (env.DB) {
                const dbConfig = require('../../src/config/db.js');
                dbConfig.init(env);
                await SyncService.syncProduct(data);
            }
        }

        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: e.status || 500 });
    }
});

router.post('/vendor/products/:id', async (req, env) => {
    injectEnv(req, env);
    const authHeader = req.headers.get('authorization');
    const token = authHeader ? authHeader.replace('Bearer ', '') : null;
    const userId = getUserIdFromRequest(req);

    if (!userId || !token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const api = new FetchClient(env, 'wc', token);
    try {
        const id = req.params.id;
        const body = await req.json();

        // Normalize taxonomy fields (locations, brands) for WooCommerce API compatibility
        const normalizedBody = normalizeProductTaxonomies(body);

        // Ownership check happens upstream in WC/WCFM because we are using Vendor Token
        const data = await api.post(`/products/${id}`, normalizedBody);

        // Sync
        if (data && data.id) {
            if (env.DB) {
                const dbConfig = require('../../src/config/db.js');
                dbConfig.init(env);
                await SyncService.syncProduct(data);
            }
        }

        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: e.status || 500 });
    }
});

router.delete('/vendor/products/:id', async (req, env) => {
    injectEnv(req, env);
    const authHeader = req.headers.get('authorization');
    const token = authHeader ? authHeader.replace('Bearer ', '') : null;
    const userId = getUserIdFromRequest(req);

    if (!userId || !token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const api = new FetchClient(env, 'wc', token);
    try {
        const id = req.params.id;
        // Force delete?
        const data = await api.delete(`/products/${id}`, { force: true });

        // Sync Delete
        if (data && (data.id || data.previous?.id)) {
            const delId = data.id || data.previous.id;
            if (env.DB) {
                const dbConfig = require('../../src/config/db.js');
                dbConfig.init(env);
                await SyncService.deleteProduct(delId);
            }
        }

        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: e.status || 500 });
    }
});

router.get('/vendor/products/:id', async (req, env) => {
    injectEnv(req, env);
    const authHeader = req.headers.get('authorization');
    const token = authHeader ? authHeader.replace('Bearer ', '') : null;
    const userId = getUserIdFromRequest(req);

    if (!userId || !token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const api = new FetchClient(env, 'wc', token);
    try {
        const id = req.params.id;
        const data = await api.get(`/products/${id}`);
        // If we get here, the user has access.
        // If they didn't, WC would likely return 401/403/404.

        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: e.status || 500 });
    }
});

// Vendor Orders (Protected)
router.get('/vendor/orders', async (req, env) => {
    injectEnv(req, env);
    const authHeader = req.headers.get('authorization');
    const token = authHeader ? authHeader.replace('Bearer ', '') : null;
    const userId = req.query.vendor_id || getUserIdFromRequest(req);

    if (!userId || !token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    // Use WCFM API with Vendor Token
    const api = new FetchClient(env, 'wcfm', token);

    try {
        const params = { ...req.query };
        if (params.vendor_id) delete params.vendor_id;

        const data = await api.get('/orders', params);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: e.status || 500 });
    }
});

// Vendor Single Order (Protected)
router.get('/vendor/orders/:id', async (req, env) => {
    injectEnv(req, env);
    const authHeader = req.headers.get('authorization');
    const token = authHeader ? authHeader.replace('Bearer ', '') : null;
    const userId = getUserIdFromRequest(req);

    if (!userId || !token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const api = new FetchClient(env, 'wcfm', token);
    try {
        const id = req.params.id;
        const data = await api.get(`/orders/${id}`);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: e.status || 500 });
    }
});

// Vendor Settings/Profile (Protected)
router.get('/vendor/settings', async (req, env) => {
    injectEnv(req, env);
    const authHeader = req.headers.get('authorization');
    const token = authHeader ? authHeader.replace('Bearer ', '') : null;
    const userId = getUserIdFromRequest(req);

    if (!userId || !token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const api = new FetchClient(env, 'wcfm', token);
    try {
        const data = await api.get(`/settings/${userId}`);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: 500 });
    }
});

router.post('/vendor/settings', async (req, env) => {
    injectEnv(req, env);
    const authHeader = req.headers.get('authorization');
    const token = authHeader ? authHeader.replace('Bearer ', '') : null;
    const userId = getUserIdFromRequest(req);

    if (!userId || !token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const api = new FetchClient(env, 'wcfm', token);
    try {
        const body = await req.json();
        const data = await api.post(`/settings/${userId}`, body);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: 500 });
    }
});

// Vendor Sales Stats
router.get('/vendor/sales-stats', async (req, env) => {
    injectEnv(req, env);
    const authHeader = req.headers.get('authorization');
    const token = authHeader ? authHeader.replace('Bearer ', '') : null;
    const userId = getUserIdFromRequest(req);

    if (!userId || !token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const api = new FetchClient(env, 'wcfm', token);
    try {
        const params = { ...req.query };
        if (params.vendor_id) delete params.vendor_id;

        const data = await api.get('/sales-stats', params);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: 500 });
    }
});

// Public Single Vendor
router.get('/vendor/:id', async (req, env) => {
    injectEnv(req, env);
    const api = new FetchClient(env, 'wcfm');
    try {
        const id = req.params.id;
        // Check if numeric (ID) or string (slug)
        // WCFM API might handle both or have specific endpoint
        const data = await api.get(`/store-vendors/${id}`);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Vendor not found' }), { status: 404 });
    }
});

// Auth
router.post('/auth/login', async (req, env) => {
    injectEnv(req, env);
    try {
        const { username, password } = await req.json();

        // Debug
        // console.log('Attempting login for:', username);

        const api = new FetchClient(env, 'jwt');
        const data = await api.post('/token', { username, password });

        // Enrich response with ID and single Role
        if (data.token) {
            const decoded = decodeJwt(data.token);
            if (decoded && decoded.data && decoded.data.user) {
                data.id = decoded.data.user.id;
            }
            if (!data.id && data.store_id) {
                data.id = data.store_id;
            }

            // Flatten roles
            if (data.roles && Array.isArray(data.roles)) {
                if (data.roles.includes('wcfm_vendor')) {
                    data.role = 'wcfm_vendor';
                } else if (data.roles.includes('administrator')) {
                    data.role = 'administrator';
                } else {
                    data.role = data.roles[0];
                }
            }

            // Add user object and user_id for compatibility
            data.user_id = data.id;
            data.user = {
                id: data.id,
                username: data.user_nicename || username,
                email: data.user_email || username,
                role: data.role,
                firstName: data.user_display_name ? data.user_display_name.split(' ')[0] : '',
                lastName: data.user_display_name ? data.user_display_name.split(' ').slice(1).join(' ') : ''
            };
        }

        return new Response(JSON.stringify(data));
    } catch (e) {
        console.error('Login Error:', e.message);
        return new Response(JSON.stringify(e.data || { error: e.message || 'Login failed' }), { status: 401 });
    }
});

router.post('/auth/register', async (req, env) => {
    injectEnv(req, env);
    const body = await req.json().catch(() => ({}));
    const isVendor = body.isVendor === true || body.role === 'wcfm_vendor';

    if (isVendor) {
        // Vendor registration: forward to WordPress custom endpoint that creates user with wcfm_vendor role.
        const path = env.JWT_REGISTER_PATH || '/wp-json/shopwice/v1/auth/register';
        const WC_URL = env.WC_URL || process.env.WC_URL;
        if (!WC_URL) {
            return new Response(JSON.stringify({ error: 'Server configuration error' }), { status: 500 });
        }
        try {
            const res = await fetch(WC_URL + path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: body.email,
                    username: body.username || body.email,
                    password: body.password,
                    firstName: body.firstName,
                    lastName: body.lastName,
                    first_name: body.firstName || body.first_name,
                    last_name: body.lastName || body.last_name,
                    shopName: body.shopName,
                    phone: body.phone,
                    address: body.address,
                    role: 'wcfm_vendor',
                    isVendor: true
                })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                return new Response(JSON.stringify(data && data.message ? { error: data.message } : data), { status: res.status >= 400 ? res.status : 400 });
            }
            return new Response(JSON.stringify({
                id: data.id || data.user_id,
                email: data.email || body.email,
                username: data.username || body.username,
                role: 'wcfm_vendor',
                message: 'Vendor registration successful'
            }), { status: 201 });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message || 'Vendor registration failed' }), { status: 400 });
        }
    }

    // Customer registration via WooCommerce API
    const api = new FetchClient(env, 'wc');
    try {
        const data = {
            email: body.email,
            username: body.username || body.email,
            password: body.password,
            first_name: body.firstName || body.first_name,
            last_name: body.lastName || body.last_name
        };

        const response = await api.post('/customers', data);

        return new Response(JSON.stringify({
            id: response.id,
            email: response.email,
            username: response.username,
            role: response.role || 'customer',
            message: 'Registration successful'
        }), { status: 201 });
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: 'Registration failed' }), { status: 400 });
    }
});

router.get('/auth/verify', async (req, env) => {
    injectEnv(req, env);
    const token = req.headers.get('authorization');
    const api = new FetchClient(env, 'jwt');
    // api.post headers automatically include Basic Auth, but here we need Bearer token validation?
    // The legacy code uses `axios.post(..., {}, { headers: { Authorization: token } })`.
    // My FetchClient adds Basic Auth if type != 'wp'. 'jwt' type adds base url.
    // I need to override Authorization header.

    try {
        const res = await fetch(api.baseURL + '/token/validate', {
            method: 'POST',
            headers: {
                'Authorization': token,
                'Content-Type': 'application/json'
            }
        });
        if (!res.ok) throw new Error('Invalid token');
        const data = await res.json();
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify({ valid: false }), { status: 401 });
    }
});

router.post('/auth/forgot-password', async (req, env) => {
    injectEnv(req, env);
    const path = env.JWT_RESET_PASSWORD_REQUEST_PATH || '/wp-json/shopwice/v1/auth/password-reset/request';
    const WC_URL = env.WC_URL || process.env.WC_URL;

    try {
        const body = await req.json();
        // Forward body including app so WordPress can send the reset link to the right app.
        // app: 'vendor' | 'storefront' | 'mobile' (vendor PWA, headless frontend, Android/iOS)
        const res = await fetch(WC_URL + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.message || 'Request failed');
        }
        const data = await res.json();
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400 });
    }
});

router.post('/auth/reset-password', async (req, env) => {
    injectEnv(req, env);
    const path = env.JWT_RESET_PASSWORD_CONFIRM_PATH || '/wp-json/shopwice/v1/auth/password-reset/confirm';
    const WC_URL = env.WC_URL || process.env.WC_URL;

    try {
        const body = await req.json();
        const res = await fetch(WC_URL + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.message || 'Request failed');
        }
        const data = await res.json();
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400 });
    }
});

// Social Auth Routes
router.post('/auth/google', async (req, env) => {
    injectEnv(req, env);
    const { token: idToken } = await req.json();

    if (!idToken) return new Response(JSON.stringify({ error: 'ID Token is required' }), { status: 400 });

    try {
        const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
        if (!googleRes.ok) throw new Error('Invalid Google Token');

        const payload = await googleRes.json();
        const { email, given_name, family_name, picture } = payload;

        const api = new FetchClient(env, 'wc');

        let customer;
        const searchRes = await api.get('/customers', { email });
        if (searchRes.length > 0) customer = searchRes[0];

        if (!customer) {
            customer = await api.post('/customers', {
                email,
                first_name: given_name,
                last_name: family_name,
                username: email.split('@')[0] + '_' + Math.floor(Math.random() * 1000),
                password: Math.random().toString(36).slice(-12)
            });
        }

        const jwtPayload = {
            id: customer.id,
            email: customer.email,
            username: customer.username,
            role: customer.role || 'customer'
        };

        const secret = env.JWT_SECRET || process.env.JWT_SECRET;
        const token = await signJwt(jwtPayload, secret);

        return new Response(JSON.stringify({
            token,
            user: {
                id: customer.id,
                email: customer.email,
                username: customer.username,
                firstName: customer.first_name,
                lastName: customer.last_name,
                role: customer.role,
                picture: picture
            }
        }));

    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 401 });
    }
});

router.post('/auth/facebook', async (req, env) => {
    injectEnv(req, env);
    const { accessToken } = await req.json();

    if (!accessToken) return new Response(JSON.stringify({ error: 'Access Token is required' }), { status: 400 });

    try {
        const fbRes = await fetch(`https://graph.facebook.com/me?fields=id,email,first_name,last_name,picture&access_token=${accessToken}`);
        if (!fbRes.ok) throw new Error('Invalid Facebook Token');

        const { email, first_name, last_name, picture } = await fbRes.json();

        if (!email) return new Response(JSON.stringify({ error: 'Email permission is required' }), { status: 400 });

        const api = new FetchClient(env, 'wc');

        let customer;
        const searchRes = await api.get('/customers', { email });
        if (searchRes.length > 0) customer = searchRes[0];

        if (!customer) {
            customer = await api.post('/customers', {
                email,
                first_name,
                last_name,
                username: email.split('@')[0] + '_fb' + Math.floor(Math.random() * 1000),
                password: Math.random().toString(36).slice(-12)
            });
        }

        const jwtPayload = {
            id: customer.id,
            email: customer.email,
            username: customer.username,
            role: customer.role || 'customer'
        };

        const secret = env.JWT_SECRET || process.env.JWT_SECRET;
        const token = await signJwt(jwtPayload, secret);

        return new Response(JSON.stringify({
            token,
            user: {
                id: customer.id,
                email: customer.email,
                username: customer.username,
                firstName: customer.first_name,
                lastName: customer.last_name,
                role: customer.role,
                picture: picture?.data?.url
            }
        }));

    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 401 });
    }
});

// Checkout & Orders
router.get('/orders', async (req, env) => {
    injectEnv(req, env);
    const token = req.headers.get('authorization');
    if (!token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const api = new FetchClient(env, 'wc');
    try {
        const data = await api.get('/orders', req.query);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: e.status || 500 });
    }
});

router.get('/payment-gateways', async (req, env) => {
    injectEnv(req, env);
    const api = new FetchClient(env, 'wc');
    try {
        const data = await api.get('/payment_gateways');
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: 500 });
    }
});

router.post('/orders', async (req, env) => {
    injectEnv(req, env);
    const api = new FetchClient(env, 'wc');
    try {
        const body = await req.json();
        const data = await api.post('/orders', body);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: e.status || 500 });
    }
});

router.post('/checkout', async (req, env) => {
    injectEnv(req, env);
    const api = new FetchClient(env, 'store');

    const nonce = req.headers.get('x-wc-store-api-nonce');
    if (nonce) api.headers['Nonce'] = nonce;

    const auth = req.headers.get('authorization');
    if (auth) api.headers['Authorization'] = auth;

    const cartToken = req.headers.get('cart-token');
    if (cartToken) api.headers['Cart-Token'] = cartToken;

    const cookie = req.headers.get('cookie');
    if (cookie) api.headers['Cookie'] = cookie;

    try {
        const body = await req.json();
        const response = await fetch(api.baseURL + '/checkout', {
            method: 'POST',
            headers: api.headers,
            body: JSON.stringify(body)
        });

        const data = await response.json();
        const res = new Response(JSON.stringify(data), { status: response.status });

        const upstreamNonce = response.headers.get('x-wc-store-api-nonce') || response.headers.get('nonce');
        if (upstreamNonce) res.headers.set('X-WC-Store-API-Nonce', upstreamNonce);

        return res;
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
});

router.post('/checkout/cart/update-customer', async (req, env) => {
    injectEnv(req, env);
    const api = new FetchClient(env, 'store');

    const nonce = req.headers.get('x-wc-store-api-nonce');
    if (nonce) api.headers['Nonce'] = nonce;

    const auth = req.headers.get('authorization');
    if (auth) api.headers['Authorization'] = auth;

    const cartToken = req.headers.get('cart-token');
    if (cartToken) api.headers['Cart-Token'] = cartToken;

    const cookie = req.headers.get('cookie');
    if (cookie) api.headers['Cookie'] = cookie;

    try {
        const body = await req.json();
        const response = await fetch(api.baseURL + '/cart/update-customer', {
            method: 'POST',
            headers: api.headers,
            body: JSON.stringify(body)
        });

        const data = await response.json();
        const res = new Response(JSON.stringify(data), { status: response.status });

        const upstreamNonce = response.headers.get('x-wc-store-api-nonce') || response.headers.get('nonce');
        if (upstreamNonce) res.headers.set('X-WC-Store-API-Nonce', upstreamNonce);

        return res;
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
});

router.get('/checkout/state', async (req, env) => {
    injectEnv(req, env);
    const api = new FetchClient(env, 'store');

    const nonce = req.headers.get('x-wc-store-api-nonce');
    if (nonce) api.headers['Nonce'] = nonce;

    const auth = req.headers.get('authorization');
    if (auth) api.headers['Authorization'] = auth;

    const cartToken = req.headers.get('cart-token');
    if (cartToken) api.headers['Cart-Token'] = cartToken;

    const cookie = req.headers.get('cookie');
    if (cookie) api.headers['Cookie'] = cookie;

    try {
        const response = await fetch(api.baseURL + '/cart', { headers: api.headers });
        const cart = await response.json();

        const state = {
            billing_address: cart.billing_address,
            shipping_address: cart.shipping_address,
            payment_methods: [
                { id: "cod", title: "Cash on Delivery", description: "Pay with cash upon delivery." },
                { id: "bacs", title: "Direct Bank Transfer", description: "Make your payment directly into our bank account." }
            ],
            totals: cart.totals,
            items: cart.items,
            shipping_rates: cart.shipping_rates || []
        };

        const res = new Response(JSON.stringify(state));

        const upstreamNonce = response.headers.get('x-wc-store-api-nonce') || response.headers.get('nonce');
        if (upstreamNonce) res.headers.set('X-WC-Store-API-Nonce', upstreamNonce);

        return res;
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
});

router.post('/cart/:action', async (req, env) => {
    injectEnv(req, env);
    const { action } = req.params;
    const api = new FetchClient(env, 'store');

    const nonce = req.headers.get('x-wc-store-api-nonce');
    if (nonce) api.headers['Nonce'] = nonce;

    const auth = req.headers.get('authorization');
    if (auth) api.headers['Authorization'] = auth;

    const cartToken = req.headers.get('cart-token');
    if (cartToken) api.headers['Cart-Token'] = cartToken;

    const cookie = req.headers.get('cookie');
    if (cookie) api.headers['Cookie'] = cookie;

    let endpoint = '';
    if (action === 'add') endpoint = '/cart/add-item';
    else if (action === 'remove') endpoint = '/cart/remove-item';
    else if (action === 'update') endpoint = '/cart/update-item';
    else return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400 });

    try {
        const body = await req.json();
        const response = await fetch(api.baseURL + endpoint, {
            method: 'POST',
            headers: api.headers,
            body: JSON.stringify(body)
        });

        const data = await response.json();
        const res = new Response(JSON.stringify(data), { status: response.status });

        const upstreamNonce = response.headers.get('x-wc-store-api-nonce') || response.headers.get('nonce');
        if (upstreamNonce) res.headers.set('X-WC-Store-API-Nonce', upstreamNonce);

        return res;
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
});

router.get('/cart', async (req, env) => {
    injectEnv(req, env);
    const api = new FetchClient(env, 'store');

    const nonce = req.headers.get('x-wc-store-api-nonce');
    if (nonce) api.headers['Nonce'] = nonce;

    const auth = req.headers.get('authorization');
    if (auth) api.headers['Authorization'] = auth;

    const cartToken = req.headers.get('cart-token');
    if (cartToken) api.headers['Cart-Token'] = cartToken;

    const cookie = req.headers.get('cookie');
    if (cookie) api.headers['Cookie'] = cookie;

    try {
        const response = await fetch(api.baseURL + '/cart', { headers: api.headers });
        const data = await response.json();

        const res = new Response(JSON.stringify(data));

        const upstreamNonce = response.headers.get('x-wc-store-api-nonce') || response.headers.get('nonce');
        if (upstreamNonce) res.headers.set('X-WC-Store-API-Nonce', upstreamNonce);

        return res;
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
});

// Google Places
router.get('/places/autocomplete', async (req, env) => {
    injectEnv(req, env);
    const GOOGLE_PLACES_API_KEY = env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_PLACES_API_KEY;

    if (!GOOGLE_PLACES_API_KEY) {
        return new Response(JSON.stringify({ error: 'Server configuration error: Google Places API Key missing' }), { status: 500 });
    }

    const { input } = req.query;
    if (!input) {
        return new Response(JSON.stringify({ error: 'Input is required' }), { status: 400 });
    }

    try {
        const response = await fetch(`https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&key=${GOOGLE_PLACES_API_KEY}&components=country:gh`);
        const data = await response.json();
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
});

router.get('/places/details', async (req, env) => {
    injectEnv(req, env);
    const GOOGLE_PLACES_API_KEY = env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_PLACES_API_KEY;

    if (!GOOGLE_PLACES_API_KEY) {
        return new Response(JSON.stringify({ error: 'Server configuration error: Google Places API Key missing' }), { status: 500 });
    }

    const { place_id } = req.query;
    if (!place_id) {
        return new Response(JSON.stringify({ error: 'place_id is required' }), { status: 400 });
    }

    try {
        const response = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(place_id)}&key=${GOOGLE_PLACES_API_KEY}`);
        const data = await response.json();
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
});



// ==========================================
// MEDIA UPLOAD
// ==========================================

// Shared upload handler
const handleMediaUpload = async (req, env) => {
    injectEnv(req, env);
    const authHeader = req.headers.get('authorization');
    const token = authHeader ? authHeader.replace('Bearer ', '') : null;
    const userId = getUserIdFromRequest(req);

    // Allow if valid token exists (even if getUserId fails for some token types, verify via API if needed)
    // But we need userId for ownership.
    if (!userId && token) {
        // Try to validate token
        const api = new FetchClient(env, 'jwt');
        try {
            // Validate token
        } catch (e) { }
    }

    if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    try {
        const formData = await req.formData();
        const file = formData.get('file') || formData.get('image');

        if (!file) {
            return new Response(JSON.stringify({ error: 'No file uploaded' }), { status: 400 });
        }

        if (typeof file === 'string') {
            return new Response(JSON.stringify({ error: 'Invalid file format. Please upload a binary file.' }), { status: 400 });
        }

        // Ensure it has stream method (sanity check)
        if (typeof file.stream !== 'function') {
            return new Response(JSON.stringify({ error: 'File object missing stream method' }), { status: 400 });
        }

        const fileName = file.name || `upload-${Date.now()}.jpg`;
        const fileType = file.type || 'image/jpeg';

        // Use R2 binding - Check for R2 binding
        // In Pages Functions, bindings are available on env
        if (!env.R2) {
            console.error('R2 binding not found on env object');
            return new Response(JSON.stringify({ error: 'Media storage not configured' }), { status: 500 });
        }

        // Generate unique key
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const key = `images/${userId}_${uniqueSuffix}_${fileName}`;

        // Get file as buffer for uploading to both R2 and WordPress
        const fileBuffer = await file.arrayBuffer();

        // Upload to R2
        await env.R2.put(key, fileBuffer, {
            httpMetadata: { contentType: fileType }
        });

        // Public URL (R2 Pub Domain)
        const R2_PUBLIC_URL = env.R2_PUBLIC_URL || 'https://pub-3da318373ea74e3289271edc63013603.r2.dev';
        const publicUrl = `${R2_PUBLIC_URL}/${key}`;

        // Also upload to WordPress Media Library so WooCommerce can validate the image
        let wpMediaId = null;
        try {
            const WC_URL = env.WC_URL || process.env.WC_URL;
            const wpFormData = new FormData();
            wpFormData.append('file', new Blob([fileBuffer], { type: fileType }), fileName);

            const wpRes = await fetch(`${WC_URL}/wp-json/wp/v2/media`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
                body: wpFormData
            });

            if (wpRes.ok) {
                const wpMedia = await wpRes.json();
                wpMediaId = wpMedia.id;
                console.log('Image uploaded to WordPress with ID:', wpMediaId);
            } else {
                console.warn('WordPress upload failed, will use R2 URL only');
            }
        } catch (wpError) {
            console.warn('WordPress upload error:', wpError.message);
        }

        // Insert into DB
        const dbConfig = require('../../src/config/db.js');
        dbConfig.init(env);

        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const slug = fileName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

        // Insert into wp_posts using standard query. D1/MySQL compatibility.
        await dbConfig.query(`
            INSERT INTO wp_posts (
                post_author, post_date, post_date_gmt, post_content, post_title, 
                post_excerpt, post_status, comment_status, ping_status, post_name, 
                post_modified, post_modified_gmt, post_parent, guid, post_type, post_mime_type, to_ping, pinged, post_content_filtered
            ) VALUES (
                ?, ?, ?, '', ?, 
                '', 'inherit', 'open', 'closed', ?, 
                ?, ?, 0, ?, 'attachment', ?, '', '', ''
            )
        `, [
            userId, now, now, fileName,
            slug,
            now, now, publicUrl, fileType
        ]);

        // Fetch ID
        const result = await dbConfig.query("SELECT ID FROM wp_posts WHERE guid = ? ORDER BY ID DESC LIMIT 1", [publicUrl]);
        const rows = result.results || result;
        let newId = rows.length ? rows[0].ID : 0;

        if (newId) {
            // Insert required metadata for WooCommerce image compatibility
            await dbConfig.query(
                "INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_wp_attached_file', ?)",
                [newId, key]
            );

            await dbConfig.query(
                "INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_wcfm_product_author', ?)",
                [newId, userId]
            );

            // Add image dimensions metadata (required by WooCommerce)
            await dbConfig.query(
                "INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_wp_attachment_metadata', ?)",
                [newId, JSON.stringify({
                    width: 800,
                    height: 600,
                    file: key,
                    sizes: {},
                    image_meta: {}
                })]
            );

            // Store WordPress media ID if available
            if (wpMediaId) {
                await dbConfig.query(
                    "INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_wp_media_id', ?)",
                    [newId, wpMediaId]
                );
            }
        }

        // Return WordPress media ID if available, otherwise use local ID
        const responseId = wpMediaId || newId;

        return new Response(JSON.stringify({
            id: responseId,
            source_url: publicUrl,
            link: publicUrl,
            src: publicUrl,
            title: { raw: fileName, rendered: fileName },
            media_details: { file: key },
            wp_media_id: wpMediaId
        }));

    } catch (e) {
        console.error('Upload Error:', e);
        return new Response(JSON.stringify({
            error: 'Media upload failed',
            details: e.message || String(e),
            stack: e.stack
        }), { status: 500 });
    }
};

// Multiple upload endpoints for compatibility
router.post('/upload', handleMediaUpload);
router.post('/media', handleMediaUpload);
router.post('/vendor/media', handleMediaUpload);

// ==========================================
// Main Handler
// ==========================================

export const onRequest = async (context) => {
    const { request, env } = context;

    // Handle OPTIONS (CORS Preflight)
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const response = await router.handle(request, env);

        // Add CORS headers to all responses
        const newHeaders = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
};
