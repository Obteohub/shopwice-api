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
    all(path, handler) { this.add('ALL', path, handler); }

    async handle(request, env) {
        const url = new URL(request.url);
        let path = url.pathname;
        if (this.base && path.startsWith(this.base)) {
            path = path.slice(this.base.length);
        }
        // Normalize path
        if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
        if (!path.startsWith('/')) path = '/' + path;

        for (const route of this.routes) {
            if (route.method !== 'ALL' && route.method !== request.method) continue;
            
            const match = this.matchPath(route.path, path);
            if (match) {
                request.params = match.params;
                request.query = Object.fromEntries(url.searchParams);
                return route.handler(request, env);
            }
        }
        
        return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    matchPath(routePath, actualPath) {
        if (routePath === '*') return { params: {} };
        
        const routeParts = routePath.split('/').filter(Boolean);
        const actualParts = actualPath.split('/').filter(Boolean);
        
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

    try {
        console.log(`Received Webhook: ${topic}`);
        if (topic === 'product.created' || topic === 'product.updated') {
            await SyncService.syncProduct(payload);
        } else if (topic === 'product.deleted') {
            await SyncService.deleteProduct(payload.id);
        }
        
        // Invalidate Cache
        if (env.shopwice_cache) {
             const key = `product_${payload.id}`;
             await env.shopwice_cache.delete(key);
             console.log(`Cache invalidated for ${key}`);
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
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
};

// Fetch Helper Class
class FetchClient {
    constructor(env, type) {
        this.env = env;
        const WC_URL = env.WC_URL || process.env.WC_URL;
        const WC_KEY = env.WC_CONSUMER_KEY || process.env.WC_CONSUMER_KEY;
        const WC_SECRET = env.WC_CONSUMER_SECRET || process.env.WC_CONSUMER_SECRET;

        this.headers = {
            'User-Agent': 'Shopwice-CF-Worker/1.0',
            'Content-Type': 'application/json'
        };

        if (type !== 'wp') {
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
    const api = new FetchClient(env, 'wc');
    try {
        const data = await api.get('/products', req.query);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: e.status || 500 });
    }
});

router.get('/cart', async (req, env) => {
    injectEnv(req, env);
    const api = new FetchClient(env, 'store');
    try {
        const data = await api.get('/cart', req.query);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: 500 });
    }
});

router.post('/cart/add-item', async (req, env) => {
    injectEnv(req, env);
    const api = new FetchClient(env, 'store');
    try {
        const body = await req.json();
        const data = await api.post('/cart/add-item', body);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: 500 });
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
    const api = new FetchClient(env, 'wc');
    try {
        const data = await api.get(`/products/${req.params.id}`);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Product not found' }), { status: 404 });
    }
});

// Collection Data
router.get('/collection-data', (req, env) => {
    injectEnv(req, env);
    return mockExpress(req, getCollectionData);
});

// Categories
router.get('/categories', async (req, env) => {
    injectEnv(req, env);
    const api = new FetchClient(env, 'wc');
    try {
        const data = await api.get('/products/categories', req.query);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: 500 });
    }
});

router.get('/categories/:id', async (req, env) => {
    injectEnv(req, env);
    const api = new FetchClient(env, 'wc');
    try {
        const data = await api.get(`/products/categories/${req.params.id}`);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Category not found' }), { status: 404 });
    }
});

// Tags
router.get('/tags', async (req, env) => {
    injectEnv(req, env);
    const api = new FetchClient(env, 'wc');
    try {
        const data = await api.get('/products/tags', req.query);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: 500 });
    }
});

router.get('/tags/:id', async (req, env) => {
    injectEnv(req, env);
    const api = new FetchClient(env, 'wc');
    try {
        const data = await api.get(`/products/tags/${req.params.id}`);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Tag not found' }), { status: 404 });
    }
});

// Attributes
router.get('/attributes', async (req, env) => {
    injectEnv(req, env);
    const api = new FetchClient(env, 'wc');
    try {
        const data = await api.get('/products/attributes', req.query);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: 500 });
    }
});

router.get('/attributes/:id', async (req, env) => {
    injectEnv(req, env);
    const api = new FetchClient(env, 'wc');
    try {
        const data = await api.get(`/products/attributes/${req.params.id}`);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Attribute not found' }), { status: 404 });
    }
});

router.get('/attributes/:id/terms', async (req, env) => {
    injectEnv(req, env);
    const api = new FetchClient(env, 'wc');
    try {
        const data = await api.get(`/products/attributes/${req.params.id}/terms`, req.query);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: 500 });
    }
});

// Brands
router.get('/brands', async (req, env) => {
    injectEnv(req, env);
    const api = new FetchClient(env, 'store'); // Use store API or WC API? Legacy used storeAxios for brands.
    try {
        const data = await api.get('/products/brands', req.query);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: 500 });
    }
});

// Locations
router.get('/locations', async (req, env) => {
    injectEnv(req, env);
    const api = new FetchClient(env, 'wp');
    try {
        const data = await api.get('/product_location', req.query);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: 500 });
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

// Vendor Products (Protected)
router.get('/vendor/products', async (req, env) => {
    injectEnv(req, env);
    const userId = req.query.vendor_id || getUserIdFromRequest(req);
    if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const api = new FetchClient(env, 'wcfm');
    try {
        // Pass vendor_id to filter products
        const params = { ...req.query, vendor_id: userId };
        const data = await api.get('/products', params);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: 500 });
    }
});

// Vendor Orders (Protected)
router.get('/vendor/orders', async (req, env) => {
    injectEnv(req, env);
    const userId = req.query.vendor_id || getUserIdFromRequest(req);
    if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const api = new FetchClient(env, 'wcfm');
    try {
        const params = { ...req.query, vendor_id: userId };
        const data = await api.get('/orders', params);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: 500 });
    }
});

// Vendor Settings/Profile (Protected)
router.get('/vendor/settings', async (req, env) => {
    injectEnv(req, env);
    const userId = getUserIdFromRequest(req);
    if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const api = new FetchClient(env, 'wcfm');
    try {
        const data = await api.get(`/settings/${userId}`);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: e.message }), { status: 500 });
    }
});

router.post('/vendor/settings', async (req, env) => {
    injectEnv(req, env);
    const userId = getUserIdFromRequest(req);
    if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const api = new FetchClient(env, 'wcfm');
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
    const userId = getUserIdFromRequest(req);
    if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const api = new FetchClient(env, 'wcfm');
    try {
        const params = { ...req.query, vendor_id: userId };
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
    const api = new FetchClient(env, 'jwt');
    try {
        const body = await req.json();
        const data = await api.post('/token', body);
        return new Response(JSON.stringify(data));
    } catch (e) {
        return new Response(JSON.stringify(e.data || { error: 'Login failed' }), { status: 401 });
    }
});

router.post('/auth/register', async (req, env) => {
    injectEnv(req, env);
    const api = new FetchClient(env, 'wc');
    try {
        const body = await req.json();
        const data = {
            email: body.email,
            username: body.username || body.email,
            password: body.password,
            first_name: body.firstName,
            last_name: body.lastName
        };
        
        const response = await api.post('/customers', data);
        
        return new Response(JSON.stringify({
            id: response.id,
            email: response.email,
            username: response.username,
            role: response.role,
            message: "Registration successful"
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
    // Custom endpoint path
    const path = env.JWT_RESET_PASSWORD_REQUEST_PATH || '/wp-json/shopwice/v1/auth/password-reset/request';
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

// Main Handler
export const onRequest = async (context) => {
    // Add Security Headers
    const securityHeaders = {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'X-XSS-Protection': '1; mode=block',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;",
    };

    if (context.request.method === 'OPTIONS') {
        const response = new Response(null, { headers: corsHeaders });
        Object.entries(securityHeaders).forEach(([k, v]) => response.headers.set(k, v));
        return response;
    }

    try {
        const response = await router.handle(context.request, context.env);
        // Merge CORS and Security headers
        Object.entries(corsHeaders).forEach(([k, v]) => response.headers.set(k, v));
        Object.entries(securityHeaders).forEach(([k, v]) => response.headers.set(k, v));
        return response;
    } catch (e) {
        // Fallback error handler
        const response = new Response(JSON.stringify({ error: 'Internal Server Error', details: e.message }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
        Object.entries(corsHeaders).forEach(([k, v]) => response.headers.set(k, v));
        return response;
    }
};
