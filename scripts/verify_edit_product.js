const BASE_URL = 'http://127.0.0.1:8788';
const USERNAME = 'kwessi@gmail.com';
const PASSWORD = 'Black25';

async function verifyEditProduct() {
    console.log('1. Logging in...');
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: USERNAME, password: PASSWORD })
    });
    
    const loginData = await loginRes.json();
    if (!loginRes.ok || !loginData.token) {
        console.error('Login Failed:', loginData);
        return;
    }
    const token = loginData.token;
    console.log('Login Successful. Token obtained.');

    // 2. Fetch Existing Products to find one to edit
    console.log('\n2. Fetching Vendor Products...');
    const productsRes = await fetch(`${BASE_URL}/api/vendor/products`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!productsRes.ok) {
        console.error('Fetch Products Failed:', await productsRes.text());
        return;
    }
    
    const products = await productsRes.json();
    if (products.length === 0) {
        console.error('No products found for this vendor. Cannot test edit.');
        return;
    }
    
    const productToEdit = products[0];
    console.log(`Found product to edit: ID ${productToEdit.id}, Name: ${productToEdit.name}`);
    
    // 2b. Fetch Categories to find a valid one
    const catsRes = await fetch(`${BASE_URL}/api/categories`);
    const cats = await catsRes.json();
    if (cats.length === 0) { console.error('No categories found'); return; }
    
    // Pick a category that is NOT currently assigned (or just the first one if none)
    const currentCatId = productToEdit.categories && productToEdit.categories.length > 0 ? productToEdit.categories[0].id : -1;
    const newCat = cats.find(c => c.id !== currentCatId) || cats[0];
    
    console.log(`Current Category: ${currentCatId}`);
    console.log(`Switching to Category: ${newCat.id} (${newCat.name})`);

    // 3. Edit the Product
    const newName = `Edited Product ${Date.now()}`;
    // Use a reliable public image
    const newImage = "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Image_created_with_a_mobile_phone.png/220px-Image_created_with_a_mobile_phone.png";
    console.log(`\n3. Editing Product ${productToEdit.id} -> New Name: ${newName}, Category: ${newCat.id}, Image: ${newImage}`);
    
    const editRes = await fetch(`${BASE_URL}/api/vendor/products/${productToEdit.id}`, {
        method: 'POST',
        headers: { 
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: newName,
            regular_price: '199.99',
            categories: [{ id: newCat.id }],
            images: [{ src: newImage, name: "Test Image" }]
        })
    });
    
    if (editRes.ok) {
        const editedProduct = await editRes.json();
        console.log('✅ Edit Successful (Response from WC)!');
        console.log('Returned Name:', editedProduct.name);
        console.log('Returned Categories:', JSON.stringify(editedProduct.categories));
        console.log('Returned Images:', JSON.stringify(editedProduct.images));
        
        // 4. Verify D1 Sync
        console.log('\n4. Verifying D1 Sync (Fetching from Public/Vendor API)...');
        
        const checkRes = await fetch(`${BASE_URL}/api/vendor/products/${productToEdit.id}`, {
             headers: { 'Authorization': `Bearer ${token}` }
        });
        const checkData = await checkRes.json();
        console.log('Fetched from API Name:', checkData.name);
        console.log('Fetched from API Categories:', JSON.stringify(checkData.categories));
        console.log('Fetched from API Images:', JSON.stringify(checkData.images));
        
        const hasCat = checkData.categories && checkData.categories.some(c => c.id === newCat.id);
         // Check if image ID matches (URL might change due to CDN/upload)
         const hasImg = checkData.images && checkData.images.length > 0 && 
                        editedProduct.images && editedProduct.images.length > 0 &&
                        checkData.images[0].id === editedProduct.images[0].id;
         
         if (checkData.name === newName && hasCat && hasImg) {
            console.log('✅ D1 Sync Verified! Data matches.');
        } else {
            console.error('❌ D1 Sync FAILED! Data mismatch.');
            if (checkData.name !== newName) console.log('Name Mismatch');
            if (!hasCat) console.log('Category Mismatch');
            if (!hasImg) console.log('Image Mismatch');
        }

    } else {
        console.error('❌ Edit FAILED:', editRes.status);
        console.error('Response:', await editRes.text());
    }
}

verifyEditProduct();
