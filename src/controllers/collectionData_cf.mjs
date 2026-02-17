import resolversPkg from '../graphql/resolvers.js';
const { resolvers } = resolversPkg;
import dataloadersPkg from '../graphql/dataloaders.js';
const { createLoaders } = dataloadersPkg;

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

        // Construct Args for GraphQL Resolver
        const args = {
            where: {}
        };

        if (category) args.where.categoryId = parseInt(category);
        if (search) args.where.search = search;
        if (minPrice) args.where.minPrice = parseFloat(minPrice);
        if (maxPrice) args.where.maxPrice = parseFloat(maxPrice);
        
        if (brand) args.where.brands = brand.split(',').map(s => s.trim());
        if (location) args.where.locations = location.split(',').map(s => s.trim());
        if (tag) args.where.tag = tag;

        // Context
        const env = req.env || (process && process.env) || {};
        const context = {
            env: { ...env, CACHE: env.shopwice_cache },
            loaders: createLoaders(),
            waitUntil: (promise) => { if(env.waitUntil) env.waitUntil(promise); }
        };

        // Call Resolver
        // We use Query.products which returns a connection
        const result = await resolvers.Query.products(null, args, context);
        const products = result.nodes || [];

        // Aggregate attributes from products
        const attributeMap = new Map();

        products.forEach(product => {
            // Process product attributes
            if (product.attributes?.nodes) {
                product.attributes.nodes.forEach(attr => {
                    // Use slug as taxonomy if available, otherwise derive
                    const taxonomy = attr.slug || (attr.name.toLowerCase().startsWith('pa_')
                        ? attr.name
                        : `pa_${attr.name.toLowerCase().replace(/\s+/g, '-')}`);
                    
                    const label = attr.label || attr.name;

                    if (!attributeMap.has(taxonomy)) {
                        attributeMap.set(taxonomy, {
                            taxonomy,
                            label: label,
                            terms: new Map()
                        });
                    }

                    const attrData = attributeMap.get(taxonomy);

                    // Count each option
                    // Resolver returns options as array of strings
                    if (attr.options && Array.isArray(attr.options)) {
                        attr.options.forEach(option => {
                            const slug = option.toLowerCase().replace(/\s+/g, '-');
                            if (!attrData.terms.has(slug)) {
                                attrData.terms.set(slug, {
                                    term_id: 0, // We don't have term ID for attribute options in this view
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
                        const id = brand.databaseId || brand.id;
                        brandData.terms.set(brand.slug, {
                            term_id: typeof id === 'string' ? parseInt(id.replace(/\D/g, '')) : id,
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
