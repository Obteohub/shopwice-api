// Web Crypto API based JWT implementation for Cloudflare Workers

const signJwt = async (payload, secret) => {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    
    // Set expiration if not present (default 7 days)
    if (!payload.exp) {
        payload.exp = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
    }
    
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
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        
        const base64Url = parts[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
};

const verifyJwt = async (token, secret) => {
    try {
        const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
        if (!encodedHeader || !encodedPayload || !encodedSignature) return false;

        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
        );

        const signature = Uint8Array.from(atob(encodedSignature.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        
        const valid = await crypto.subtle.verify(
            'HMAC',
            key,
            signature,
            encoder.encode(`${encodedHeader}.${encodedPayload}`)
        );

        if (!valid) return null;
        
        return decodeJwt(token);
    } catch (e) {
        return null;
    }
};

module.exports = { signJwt, decodeJwt, verifyJwt };
