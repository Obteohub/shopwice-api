require('dotenv').config();

async function assignVendor() {
    const baseUrl = process.env.WC_URL || 'https://shopwice.com';
    const consumerKey = process.env.WC_CONSUMER_KEY;
    const consumerSecret = process.env.WC_CONSUMER_SECRET;
    
    // Basic Auth
    const auth = btoa(`${consumerKey}:${consumerSecret}`);
    const headers = {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Shopwice-Script/1.0'
    };

    const productId = 207143;
    const vendorId = 16533;

    try {
        console.log(`Attempting to assign Product ${productId} to Vendor ${vendorId} via WCFM API...`);
        
        // Try WCFM Product Endpoint
        // Note: WCFM might use POST to update
        const url = `${baseUrl}/wp-json/wcfmmp/v1/products/${productId}`;
        
        // Payload: WCFM often accepts 'store_id' or 'vendor_id' or just 'author' if it wraps WP API
        // Let's try multiple fields
        const payload = {
            id: productId,
            author: vendorId,
            store_id: vendorId,
            vendor_id: vendorId,
            post_author: vendorId
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const data = await res.json();
            console.log('Success:', data);
        } else {
            console.log('Failed:', res.status, res.statusText);
            const text = await res.text();
            console.log('Response:', text);
            
            // If 404, maybe endpoint is wrong.
            // Try /wcfmmp/v1/product/
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

assignVendor();
