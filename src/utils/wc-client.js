const crypto = globalThis.crypto;

class WooCommerceClient {
    constructor(env) {
        this.env = env || {};
        // Fallback to process.env if available (Node.js)
        if (typeof process !== 'undefined' && process.env) {
            this.env = { ...process.env, ...this.env };
        }
        
        this.url = this.env.WC_URL || 'https://shopwice.com';
        this.consumerKey = this.env.WC_CONSUMER_KEY;
        this.consumerSecret = this.env.WC_CONSUMER_SECRET;
    }

    async get(endpoint, params = {}) {
        return this.request('GET', endpoint, params);
    }

    async post(endpoint, data = {}) {
        return this.request('POST', endpoint, {}, data);
    }

    async request(method, endpoint, params = {}, data = null) {
        const url = new URL(this.url + '/wp-json/wc/v3' + endpoint);
        Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

        // Basic Auth
        const auth = btoa(`${this.consumerKey}:${this.consumerSecret}`);
        
        const headers = {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Shopwice-CF-Worker/1.0'
        };

        const options = {
            method,
            headers,
            body: data ? JSON.stringify(data) : null
        };

        const res = await fetch(url.toString(), options);
        if (!res.ok) {
            const errorBody = await res.json().catch(() => ({}));
            const error = new Error(errorBody.message || res.statusText);
            error.status = res.status;
            error.data = errorBody;
            throw error;
        }

        return await res.json();
    }
}

module.exports = WooCommerceClient;
