const BASE_URL = 'http://127.0.0.1:8788';
const GRAPHQL_URL = `${BASE_URL}/graphql`;

async function testProductPage() {
    console.log('🚀 Testing Single Product Fetch (Product Page)...');

    // Use a known product ID (from previous list_products.js run)
    // ID: 207137 | Name: Apple USB C Travel Adaptor
    const productId = "207137"; 

    const productQuery = `
        query GetProduct($id: ID!) {
            product(id: $id) {
                id
                databaseId
                name
                slug
                sku
                price
                regularPrice
                salePrice
                onSale
                stockStatus
                stockQuantity
                shortDescription
                description
                date
                averageRating
                reviewCount
                
                # Images
                image {
                    sourceUrl
                    altText
                }
                galleryImages {
                    nodes {
                        sourceUrl
                        altText
                    }
                }

                # Taxonomy
                categories {
                    id
                    name
                    slug
                }
                brands {
                    id
                    name
                    slug
                }

                # Attributes (for display)
                attributes {
                    nodes {
                        id
                        name
                        options
                        visible
                        variation
                    }
                }

                # Variations (if variable product)
                variations {
                    nodes {
                        id
                        name
                        price
                        regularPrice
                        salePrice
                        stockStatus
                        attributes {
                            nodes {
                                name
                                options
                            }
                        }
                    }
                }

                # Related / Upsells
                relatedProducts {
                    id
                    name
                    price
                    image {
                        sourceUrl
                    }
                }
                upsellProducts {
                    id
                    name
                    price
                }
            }
        }
    `;

    try {
        console.log(`\n--- Fetching Product ID: ${productId} ---`);
        const res = await fetch(GRAPHQL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                query: productQuery,
                variables: { id: productId }
            })
        });
        
        const json = await res.json();
        
        if (json.errors) {
            console.error('❌ Product Query Errors:', JSON.stringify(json.errors, null, 2));
        } else {
            const product = json.data.product;
            if (product) {
                console.log('✅ Product Fetched Successfully!');
                console.log(`   Name: ${product.name}`);
                console.log(`   Price: ${product.price}`);
                console.log(`   Slug: ${product.slug}`);
                console.log(`   Stock: ${product.stockStatus} (${product.stockQuantity || 'N/A'})`);
                console.log(`   Images: ${product.galleryImages.nodes.length + (product.image ? 1 : 0)}`);
                console.log(`   Categories: ${product.categories.map(c => c.name).join(', ')}`);
                
                if (product.variations && product.variations.nodes.length > 0) {
                    console.log(`   Variations: ${product.variations.nodes.length}`);
                }
            } else {
                console.error('❌ Product is null (Not Found)');
            }
        }

    } catch (e) {
        console.error('❌ Request Error:', e.message);
    }
}

testProductPage();
