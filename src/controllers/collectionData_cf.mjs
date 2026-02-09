/**
 * Collection Data Endpoint (Cloudflare Compatible)
 * Returns faceted attribute data for dynamic filtering
 */
export async function getCollectionData(req, res) {
    try {
        const {
            category,
            search,
            minPrice,
            maxPrice,
            brand,
            location,
            tag
        } = req.query;

        // Build GraphQL query
        const graphqlQuery = `
            query GetCollectionData($where: RootQueryToProductUnionConnectionWhereArgs) {
                products(first: 100, where: $where) {
                    nodes {
                        ... on SimpleProduct {
                            attributes {
                                nodes {
                                    name
                                    options
                                }
                            }
                        }
                        ... on VariableProduct {
                            attributes {
                                nodes {
                                    name
                                    options
                                }
                            }
                        }
                    }
                }
            }
        `;

        // Build where clause
        const where = {};
        if (category) where.categoryId = parseInt(category);
        if (search) where.search = search;
        if (minPrice) where.minPrice = parseFloat(minPrice);
        if (maxPrice) where.maxPrice = parseFloat(maxPrice);

        const variables = { where };

        // Query WordPress GraphQL endpoint
        const WC_URL = process.env.WC_URL; 

        const response = await fetch(
            WC_URL + '/graphql',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Shopwice-CF-Worker/1.0'
                },
                body: JSON.stringify({
                    query: graphqlQuery,
                    variables
                })
            }
        );

        const data = await response.json();

        if (data.errors) {
            console.error('GraphQL errors:', data.errors);
            return res.status(500).json({
                error: 'GraphQL query failed',
                details: data.errors
            });
        }

        const products = data.data.products.nodes;

        // Aggregate attributes from products
        const attributeMap = new Map();

        products.forEach(product => {
            // Process product attributes
            if (product.attributes?.nodes) {
                product.attributes.nodes.forEach(attr => {
                    const taxonomy = attr.name.toLowerCase().startsWith('pa_')
                        ? attr.name
                        : `pa_${attr.name.toLowerCase().replace(/\s+/g, '-')}`;

                    if (!attributeMap.has(taxonomy)) {
                        attributeMap.set(taxonomy, {
                            taxonomy,
                            label: attr.name,
                            terms: new Map()
                        });
                    }

                    const attrData = attributeMap.get(taxonomy);

                    // Count each option
                    if (attr.options && Array.isArray(attr.options)) {
                        attr.options.forEach(option => {
                            const slug = option.toLowerCase().replace(/\s+/g, '-');
                            if (!attrData.terms.has(slug)) {
                                attrData.terms.set(slug, {
                                    term_id: 0,
                                    name: option,
                                    slug,
                                    count: 0
                                });
                            }
                            attrData.terms.get(slug).count++;
                        });
                    }
                });
            }

            // Process brands
            if (product.productBrands?.nodes) {
                if (!attributeMap.has('pa_brand')) {
                    attributeMap.set('pa_brand', {
                        taxonomy: 'pa_brand',
                        label: 'Brand',
                        terms: new Map()
                    });
                }

                const brandData = attributeMap.get('pa_brand');

                product.productBrands.nodes.forEach(brand => {
                    if (!brandData.terms.has(brand.slug)) {
                        brandData.terms.set(brand.slug, {
                            term_id: parseInt(brand.id.replace(/\D/g, '')), // Extract numeric ID
                            name: brand.name,
                            slug: brand.slug,
                            count: 0
                        });
                    }
                    brandData.terms.get(brand.slug).count++;
                });
            }
        });

        // Convert to response format
        const attributes = Array.from(attributeMap.values()).map(attr => ({
            taxonomy: attr.taxonomy,
            label: attr.label,
            terms: Array.from(attr.terms.values())
                .filter(term => term.count > 0)
                .sort((a, b) => b.count - a.count) // Sort by count descending
        }));

        res.json({ attributes });

    } catch (error) {
         console.error('Collection data error:', error);
         return res.status(500).json({ error: error.message });
    }
}
