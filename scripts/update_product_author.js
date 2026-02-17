require('dotenv').config();
const WooCommerceClient = require('../src/utils/wc-client');

async function updateProductAuthor() {
    const wc = new WooCommerceClient({
        WC_URL: process.env.WC_URL,
        WC_CONSUMER_KEY: process.env.WC_CONSUMER_KEY,
        WC_CONSUMER_SECRET: process.env.WC_CONSUMER_SECRET
    });

    const productId = 207143;
    const vendorId = 16533;

    try {
        console.log(`Updating Product ${productId} author to ${vendorId}...`);
        
        // Try to update just the author
        const data = {
            author: vendorId // Standard WC API field
        };

        const product = await wc.post(`/products/${productId}`, data);
        
        console.log('Update response:');
        console.log('ID:', product.id);
        // Author is write-only usually, so it might not come back in response or might come back as 'post_author'
        console.log('Post Author:', product.post_author); 
        
        // Also verify via meta if it added any
        if (product.meta_data) {
             const wcfmMeta = product.meta_data.find(m => m.key === '_wcfm_product_author');
             console.log('_wcfm_product_author meta:', wcfmMeta ? wcfmMeta.value : 'Not found');
        }

    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
        if (error.data) console.error('Full Error Data:', JSON.stringify(error.data, null, 2));
    }
}

updateProductAuthor();
