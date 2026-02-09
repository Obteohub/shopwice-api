// src/graphql/resolvers.js
const db = require('../config/db');
const { signJwt } = require('../utils/auth');
const WooCommerceClient = require('../utils/wc-client');
const { parseProductAttributes } = require('./attributeParser');

// Helper to parse PHP serialized IDs (same as in routes)
const parseMetaIds = (str) => {
    if (!str) return [];
    if (str.includes('a:')) {
        // Serialized array like a:2:{i:0;i:123;i:1;i:456;}
        const matches = str.match(/i:(\d+);/g);
        if (!matches) return [];
        return matches.map(m => parseInt(m.match(/i:(\d+);/)[1]));
    }
    // Comma‑separated list
    return str.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
};

// Helper: Format Image for WPGraphQL compatibility
const formatImage = (img) => {
    const placeholder = 'https://shopwice.com/wp-content/uploads/woocommerce-placeholder.png';
    if (!img) return {
        id: 'placeholder',
        src: placeholder,
        sourceUrl: placeholder,
        srcSet: null,
        altText: 'Product Image',
        title: 'Product Image',
        node: null
    };

    const image = {
        id: img.id || null,
        src: img.src || img.sourceUrl || placeholder,
        sourceUrl: img.sourceUrl || img.src || placeholder,
        srcSet: img.srcSet || null,
        altText: img.altText || '',
        title: img.title || ''
    };
    image.node = image; // Self-reference for WPGraphQL compatibility
    return image;
};

// Helper: Format WooCommerce API response to GraphQL schema
const formatWcProduct = (p) => {
    const images = p.images ? p.images.map(i => formatImage({ src: i.src, altText: i.alt, title: i.name })) : [];
    const featuredImage = images.length > 0 ? images[0] : formatImage(null);

    return {
        id: p.id,
        databaseId: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        shortDescription: p.short_description,
        price: p.price ? p.price.toString() : "0",
        regularPrice: p.regular_price ? p.regular_price.toString() : "0",
        salePrice: p.sale_price ? p.sale_price.toString() : null,
        onSale: p.on_sale,
        sku: p.sku,
        stockQuantity: p.stock_quantity,
        stockStatus: p.stock_status,
        images: images,
        image: featuredImage,
        featuredImage: featuredImage,
        galleryImages: { nodes: images },
        categories: p.categories ? p.categories.map(c => ({ id: c.id, databaseId: c.id, name: c.name, slug: c.slug })) : [],
        productCategories: { nodes: p.categories ? p.categories.map(c => ({ id: c.id, databaseId: c.id, name: c.name, slug: c.slug })) : [] },
        tags: p.tags ? p.tags.map(t => ({ id: t.id, name: t.name, slug: t.slug })) : [],
        brands: [],
        productBrands: { nodes: [] },
        locations: [],
        productLocation: { nodes: [] },
        type: p.type,
        variants: [],
        upsellProducts: [],
        crossSellProducts: [],
        relatedProducts: [],
        bestSellers: [],
        averageRating: parseFloat(p.average_rating || 0),
        reviewCount: p.rating_count || 0,
        ratingCount: p.rating_count || 0,
        reviews: { nodes: [] }
    };
};

const resolvers = {
    Query: {
        // Single order by ID
        async order(_, { id }, { user, env }) {
            if (!user) throw new Error('Authentication required');
            const wcfm = require('../services/wcfm');
            
            try {
                // Assuming user.id is the vendor ID
                const order = await wcfm.getVendorOrder(user.id, id, env);
                return order;
            } catch (error) {
                console.error('Order resolver error:', error.message);
                return null;
            }
        },

        // Single product by ID or slug
        async product(_, { id }, { loaders, env, waitUntil }) {
            const cacheKey = `product_${id}`;
            let cached = null;
            if (env && env.CACHE) {
                try {
                    cached = await env.CACHE.get(cacheKey, { type: 'json' });
                } catch (e) {
                    console.error('KV Cache Error:', e);
                }
            }
            if (cached) return cached;

            // Base SQL (mirrors REST implementation)
            let sql = `
        SELECT
          p.ID as id,
          p.post_title as name,
          p.post_name as slug,
          p.post_content as description,
          p.post_excerpt as shortDescription,
          p.post_status as status,
          p.post_date as date,
          lookup.min_price as price,
          lookup.max_price as regularPrice,
          lookup.onsale as onSale,
          lookup.stock_quantity as stockQuantity,
          lookup.stock_status as stockStatus,
          lookup.total_sales as totalSales,
          lookup.average_rating as averageRating,
          lookup.rating_count as ratingCount,
          (SELECT meta_value FROM wp_postmeta WHERE post_id = p.ID AND meta_key = '_sale_price' LIMIT 1) as salePrice,
          (SELECT meta_value FROM wp_postmeta WHERE post_id = p.ID AND meta_key = '_manage_stock' LIMIT 1) as manageStock,
          (SELECT meta_value FROM wp_postmeta WHERE post_id = p.ID AND meta_key = '_upsell_ids' LIMIT 1) as upsellIds,
          (SELECT meta_value FROM wp_postmeta WHERE post_id = p.ID AND meta_key = '_crosssell_ids' LIMIT 1) as crossSellIds
        FROM wp_posts p
        LEFT JOIN wp_wc_product_meta_lookup lookup ON p.ID = lookup.product_id
        WHERE p.post_type IN ('product', 'product_variation')
      `;
            const params = [];
            if (/^\d+$/.test(id)) {
                sql += ` AND p.ID = ?`;
                params.push(id);
            } else {
                sql += ` AND p.post_name = ?`;
                params.push(id);
            }
            sql += ` LIMIT 1`;
            const [rows] = await db.query(sql, params);
            if (!rows.length) return null;
            const product = rows[0];

            // Load SKU, thumbnail, gallery via DataLoaders
            const [sku, thumbId, galleryStr] = await Promise.all([
                loaders.skuLoader.load(product.id),
                loaders.imageLoader.load(product.id),
                loaders.galleryLoader.load(product.id)
            ]);

            // Build images array
            const images = [];
            if (thumbId) {
                const [imgRows] = await db.query(`SELECT ID, guid, post_title, post_excerpt FROM wp_posts WHERE ID = ?`, [thumbId]);
                if (imgRows.length) {
                    images.push(formatImage({
                        id: imgRows[0].ID,
                        src: imgRows[0].guid,
                        sourceUrl: imgRows[0].guid,
                        title: imgRows[0].post_title,
                        altText: imgRows[0].post_excerpt || imgRows[0].post_title
                    }));
                }
            }
            if (galleryStr) {
                const galleryIds = galleryStr.split(',').filter(Boolean);
                if (galleryIds.length) {
                    const [galleryRows] = await db.query(`SELECT ID, guid, post_title, post_excerpt FROM wp_posts WHERE ID IN (?)`, [galleryIds]);
                    galleryRows.forEach(r => {
                        images.push(formatImage({
                            id: r.ID,
                            src: r.guid,
                            sourceUrl: r.guid,
                            title: r.post_title,
                            altText: r.post_excerpt || r.post_title
                        }));
                    });
                }
            }

            // Ensure at least one image exists to prevent frontend crashes
            const featuredImage = images.length > 0 ? images[0] : formatImage(null);

            // Taxonomies (categories, tags, brands, locations)
            const [terms] = await db.query(`
        SELECT t.term_id as id, t.name, t.slug, tt.taxonomy, tt.description, tt.parent, tt.count
        FROM wp_term_relationships tr
        JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
        JOIN wp_terms t ON tt.term_id = t.term_id
        WHERE tr.object_id = ?
      `, [product.id]);
            const categories = terms.filter(t => t.taxonomy === 'product_cat').map(t => ({
                id: t.id,
                databaseId: t.id,
                name: t.name,
                slug: t.slug,
                description: t.description,
                parent: t.parent,
                count: t.count
            }));
            const tags = terms.filter(t => t.taxonomy === 'product_tag').map(t => ({ id: t.id, databaseId: t.id, name: t.name, slug: t.slug }));
            const brands = terms.filter(t => ['product_brand', 'pwb-brand', 'yith_product_brand', 'brand', 'pa_brand'].includes(t.taxonomy))
                .map(t => ({ id: t.id, databaseId: t.id, name: t.name, slug: t.slug, taxonomy: t.taxonomy }));
            const locations = terms.filter(t => t.taxonomy === 'product_location').map(t => ({ id: t.id, databaseId: t.id, name: t.name, slug: t.slug }));

            // Fetch Product Attributes
            let attributes = [];
            const [attrMeta] = await db.query(`
                SELECT meta_value FROM wp_postmeta 
                WHERE post_id = ? AND meta_key = '_product_attributes'
                LIMIT 1
            `, [product.id]);

            if (attrMeta.length > 0 && attrMeta[0].meta_value) {
                try {
                    const attrData = attrMeta[0].meta_value;
                    const parsedAttrs = parseProductAttributes(attrData, terms);

                    for (const attr of parsedAttrs) {
                        const attrKey = attr.slug.replace('pa_', '');
                        const [attrInfo] = await db.query(`
                            SELECT attribute_label 
                            FROM wp_woocommerce_attribute_taxonomies 
                            WHERE attribute_name = ? 
                            LIMIT 1
                        `, [attrKey]);

                        const attrName = attrInfo.length > 0 && attrInfo[0].attribute_label
                            ? attrInfo[0].attribute_label
                            : attr.name;

                        attributes.push({
                            id: attr.slug,
                            name: attrName,
                            label: attrName,
                            slug: attr.slug,
                            options: attr.terms.map(t => t.name),
                            visible: attr.isVisible,
                            variation: attr.isVariation
                        });
                    }
                } catch (e) {
                    console.error('Error parsing attributes:', e);
                }
            }

            // Upsell / cross‑sell products
            const upsellIds = parseMetaIds(product.upsellIds);
            const crossSellIds = parseMetaIds(product.crossSellIds);

            const fetchSummaries = async (ids) => {
                if (!ids.length) return [];
                const [pRows] = await db.query(`
          SELECT
            p.ID as id,
            p.post_title as name,
            p.post_name as slug,
            lookup.min_price as price,
            lookup.max_price as regularPrice,
            (SELECT meta_value FROM wp_postmeta WHERE post_id = p.ID AND meta_key = '_thumbnail_id' LIMIT 1) as imageId
          FROM wp_posts p
          LEFT JOIN wp_wc_product_meta_lookup lookup ON p.ID = lookup.product_id
          WHERE p.ID IN (${ids.map(() => '?').join(',')})
        `, ids);
                const imgMap = {};
                const imgIds = pRows.map(r => r.imageId).filter(Boolean);
                if (imgIds.length) {
                    const [imgRows] = await db.query(`SELECT ID, guid FROM wp_posts WHERE ID IN (${imgIds.map(() => '?').join(',')})`, imgIds);
                    imgRows.forEach(i => { imgMap[i.ID] = i.guid; });
                }
                return pRows.map(p => {
                    const prodImgs = [];
                    if (p.imageId && imgMap[p.imageId]) {
                        prodImgs.push(formatImage({ src: imgMap[p.imageId] }));
                    } else {
                        prodImgs.push(formatImage(null));
                    }
                    return {
                        id: p.id,
                        databaseId: p.id,
                        name: p.name,
                        slug: p.slug,
                        price: p.price ? p.price.toString() : "0",
                        regularPrice: p.regularPrice ? p.regularPrice.toString() : "0",
                        image: prodImgs[0],
                        featuredImage: prodImgs[0],
                        images: prodImgs,
                        galleryImages: { nodes: prodImgs }
                    };
                });
            };

            const upsellProducts = await fetchSummaries(upsellIds);
            const crossSellProducts = await fetchSummaries(crossSellIds);

            // Reviews (latest 5)
            const [reviewRows] = await db.query(`
        SELECT
            c.comment_ID as id,
            c.comment_author as author,
            c.comment_content as content,
            c.comment_date as date,
            (SELECT meta_value FROM wp_commentmeta WHERE comment_id = c.comment_ID AND meta_key = 'rating' LIMIT 1) as rating
        FROM wp_comments c
        JOIN wp_posts p ON c.comment_post_ID = p.ID
        WHERE c.comment_post_ID = ? 
        AND c.comment_approved = '1' 
        AND c.comment_type = 'review'
        AND p.post_type = 'product'
        ORDER BY c.comment_date DESC
        LIMIT 5
      `, [product.id]);

            const reviews = reviewRows.map(r => ({
                id: r.id,
                author: { node: { name: r.author } },
                content: r.content,
                date: r.date,
                rating: parseInt(r.rating || 0)
            }));

            // Related products (fallback to category related)
            let relatedIds = [];
            if (upsellIds.length) relatedIds = upsellIds;
            else if (categories.length) {
                const catIds = categories.map(c => c.id);
                const [relRows] = await db.query(`
          SELECT tr.object_id 
          FROM wp_term_relationships tr
          JOIN wp_posts p ON tr.object_id = p.ID
          WHERE tr.term_taxonomy_id IN (
            SELECT term_taxonomy_id FROM wp_term_taxonomy WHERE term_id IN (?)
          ) AND tr.object_id != ?
          AND p.post_type = 'product'
          AND p.post_status = 'publish'
          LIMIT 4
        `, [catIds, product.id]);
                relatedIds = relRows.map(r => r.object_id);
            }
            const relatedProducts = await fetchSummaries(relatedIds);

            // Best sellers (top 5 by total_sales)
            const [bestRows] = await db.query(`SELECT product_id FROM wp_wc_product_meta_lookup ORDER BY total_sales DESC LIMIT 5`);
            const bestSellerIds = bestRows.map(r => r.product_id);
            const bestSellers = await fetchSummaries(bestSellerIds);

            // Variations
            let variationNodes = [];
            const [childRows] = await db.query(`
                SELECT p.ID as id, p.post_title as name, 
                       lookup.sku, lookup.stock_status, lookup.stock_quantity,
                       lookup.min_price as price, lookup.max_price as regularPrice,
                       (SELECT meta_value FROM wp_postmeta WHERE post_id = p.ID AND meta_key = '_sale_price' LIMIT 1) as salePrice,
                       (SELECT meta_value FROM wp_postmeta WHERE post_id = p.ID AND meta_key = '_thumbnail_id' LIMIT 1) as imageId
                FROM wp_posts p 
                LEFT JOIN wp_wc_product_meta_lookup lookup ON p.ID = lookup.product_id
                WHERE p.post_parent = ? AND p.post_type = 'product_variation' AND p.post_status = 'publish'
            `, [product.id]);

            if (childRows.length > 0) {
                variationNodes = childRows.map(v => ({
                    id: v.id,
                    databaseId: v.id,
                    name: v.name,
                    sku: v.sku,
                    stockStatus: v.stock_status,
                    stockQuantity: v.stock_quantity,
                    purchasable: true,
                    onSale: v.salePrice ? true : false,
                    salePrice: v.salePrice ? v.salePrice.toString() : null,
                    regularPrice: v.regularPrice ? v.regularPrice.toString() : "0",
                    price: v.price ? v.price.toString() : "0",
                }));
            }

            const finalProduct = {
                id: product.id,
                databaseId: product.id,
                productId: product.id,
                name: product.name,
                slug: product.slug,
                link: `https://shopwice.com/product/${product.slug}/`,
                description: product.description,
                shortDescription: product.shortDescription,
                price: product.price ? product.price.toString() : "0",
                regularPrice: product.regularPrice ? product.regularPrice.toString() : "0",
                salePrice: product.salePrice ? product.salePrice.toString() : null,
                onSale: product.onSale === 1,
                sku,
                stockQuantity: product.stockQuantity,
                stockStatus: product.stockStatus,
                manageStock: product.manageStock === 'yes',
                status: product.status,
                date: product.date,
                totalSales: product.totalSales || 0,
                averageRating: parseFloat(product.averageRating || 0),
                reviewCount: product.ratingCount || 0,
                ratingCount: product.ratingCount || 0,
                image: featuredImage,
                featuredImage: featuredImage,
                images: images,
                galleryImages: { nodes: images },
                categories,
                productCategories: { nodes: categories },
                tags,
                brands,
                productBrands: { nodes: brands },
                locations,
                productLocation: { nodes: locations },
                attributes: { nodes: attributes },
                galleryStr, // Pass to field resolvers
                type: product.type || 'simple',
                // Variations will be handled by field-level resolvers
                bestSellers,
                reviews: { nodes: reviews },
                seo: {
                    title: product.name,
                    description: product.shortDescription,
                    fullHead: ""
                }
            };

            if (env && env.CACHE) {
                const ttl = 3600;
                const putPromise = env.CACHE.put(cacheKey, JSON.stringify(finalProduct), { expirationTtl: ttl });
                if (waitUntil) waitUntil(putPromise);
                else await putPromise;
            }

            return finalProduct;
        },

        // List products with pagination (Connection)
        async products(_, args, { loaders, env, waitUntil }) {
            // Generate Cache Key (basic)
            const cacheKey = `products_${JSON.stringify(args)}`;
            let cached = null;
            if (env && env.CACHE) {
                try {
                    cached = await env.CACHE.get(cacheKey, { type: 'json' });
                } catch (e) {
                    console.error('KV Cache Error:', e);
                }
            }
            if (cached) return cached;

            // Support both old style (direct args) and new WPGraphQL style (where arg)
            const where = args.where || {};

            // Merge where args with direct args (direct args take precedence for backward compatibility)
            const {
                page = 1,
                perPage = 10,
                first,
                after,
                search = where.search,
                category = where.categoryId || (where.categoryIn && where.categoryIn[0]),
                categoryName = where.categoryName,
                minPrice = where.minPrice,
                maxPrice = where.maxPrice,
                status = where.status || 'publish',
                tag = where.tag || (where.tagIn && where.tagIn[0]),
                brands = where.brands,
                locations = where.locations,
                attributes = where.attributes,
                vendorId = args.vendorId
            } = args;

            // Calculate limit/offset based on args
            let limit = perPage;
            let offset = (page - 1) * perPage;

            if (first) {
                limit = first;
                if (after) {
                    try {
                        const decoded = Buffer.from(after, 'base64').toString('utf-8');
                        if (decoded.startsWith('cursor:')) {
                            offset = parseInt(decoded.split(':')[1]) + 1;
                        }
                    } catch (e) { }
                } else {
                    offset = 0;
                }
            }

            let joins = [];
            let whereClauses = ["p.post_type = 'product'", "p.post_status = ?"];
            let params = [status];

            if (search) {
                whereClauses.push("(p.post_title LIKE ? OR p.post_content LIKE ?)");
                params.push(`%${search}%`, `%${search}%`);
            }
            if (category) {
                joins.push(`JOIN wp_term_relationships tr_cat ON p.ID = tr_cat.object_id`);
                joins.push(`JOIN wp_term_taxonomy tt_cat ON tr_cat.term_taxonomy_id = tt_cat.term_taxonomy_id`);
                whereClauses.push(`tt_cat.taxonomy = 'product_cat' AND tt_cat.term_id = ?`);
                params.push(category);
            } else if (categoryName) {
                joins.push(`JOIN wp_term_relationships tr_cat ON p.ID = tr_cat.object_id`);
                joins.push(`JOIN wp_term_taxonomy tt_cat ON tr_cat.term_taxonomy_id = tt_cat.term_taxonomy_id`);
                joins.push(`JOIN wp_terms t_cat ON tt_cat.term_id = t_cat.term_id`);
                whereClauses.push(`tt_cat.taxonomy = 'product_cat' AND t_cat.slug = ?`);
                params.push(categoryName);
            }

            if (minPrice) { whereClauses.push('lookup.min_price >= ?'); params.push(minPrice); }
            if (maxPrice) { whereClauses.push('lookup.max_price <= ?'); params.push(maxPrice); }

            // Vendor Filtering
            if (vendorId) {
                joins.push(`JOIN wp_postmeta pm_vendor ON p.ID = pm_vendor.post_id`);
                whereClauses.push(`pm_vendor.meta_key = '_wcfm_product_author' AND pm_vendor.meta_value = ?`);
                params.push(vendorId);
            }

            // Attribute Filtering (e.g. Color, Size)
            if (args.attributes && args.attributes.length > 0) {
                args.attributes.forEach((attr, index) => {
                    const aliasTR = `tr_attr_${index}`;
                    const aliasTT = `tt_attr_${index}`;
                    joins.push(`JOIN wp_term_relationships ${aliasTR} ON p.ID = ${aliasTR}.object_id`);
                    joins.push(`JOIN wp_term_taxonomy ${aliasTT} ON ${aliasTR}.term_taxonomy_id = ${aliasTT}.term_taxonomy_id`);

                    whereClauses.push(`${aliasTT}.taxonomy = ?`);
                    params.push(attr.taxonomy);

                    if (attr.terms && attr.terms.length > 0) {
                        // Filter by slugs (most common for APIs)
                        const placeholders = attr.terms.map(() => '?').join(',');
                        joins.push(`JOIN wp_terms t_attr_${index} ON ${aliasTT}.term_id = t_attr_${index}.term_id`);
                        whereClauses.push(`t_attr_${index}.slug IN (${placeholders})`);
                        params.push(...attr.terms);
                    }
                });
            }

            // Brands Filtering
            if (brands && brands.length > 0) {
                const aliasTR = `tr_brand`;
                const aliasTT = `tt_brand`;
                const aliasT = `t_brand`;
                joins.push(`JOIN wp_term_relationships ${aliasTR} ON p.ID = ${aliasTR}.object_id`);
                joins.push(`JOIN wp_term_taxonomy ${aliasTT} ON ${aliasTR}.term_taxonomy_id = ${aliasTT}.term_taxonomy_id`);
                joins.push(`JOIN wp_terms ${aliasT} ON ${aliasTT}.term_id = ${aliasT}.term_id`);

                // Check multiple possible brand taxonomies
                whereClauses.push(`${aliasTT}.taxonomy IN ('product_brand', 'pwb-brand', 'yith_product_brand', 'brand', 'pa_brand')`);

                const placeholders = brands.map(() => '?').join(',');
                whereClauses.push(`${aliasT}.slug IN (${placeholders})`);
                params.push(...brands);
            }

            // Locations Filtering
            if (locations && locations.length > 0) {
                const aliasTR = `tr_loc`;
                const aliasTT = `tt_loc`;
                const aliasT = `t_loc`;
                joins.push(`JOIN wp_term_relationships ${aliasTR} ON p.ID = ${aliasTR}.object_id`);
                joins.push(`JOIN wp_term_taxonomy ${aliasTT} ON ${aliasTR}.term_taxonomy_id = ${aliasTT}.term_taxonomy_id`);
                joins.push(`JOIN wp_terms ${aliasT} ON ${aliasTT}.term_id = ${aliasT}.term_id`);

                whereClauses.push(`${aliasTT}.taxonomy = 'product_location'`);

                const placeholders = locations.map(() => '?').join(',');
                whereClauses.push(`${aliasT}.slug IN (${placeholders})`);
                params.push(...locations);
            }

            // Count Query
            const countSql = `
                SELECT COUNT(DISTINCT p.ID) as total
                FROM wp_posts p
                ${joins.join(' ')}
                LEFT JOIN wp_wc_product_meta_lookup lookup ON p.ID = lookup.product_id
                WHERE ${whereClauses.join(' AND ')}
            `;
            const [countRows] = await db.query(countSql, params);
            const totalCount = countRows[0].total;

            // Main Query
            const sql = `
                SELECT
                  p.ID as id,
                  p.post_title as name,
                  p.post_name as slug,
                  p.post_date as date,
                  lookup.min_price as price,
                  lookup.max_price as regularPrice,
                  lookup.stock_quantity as stockQuantity,
                  lookup.onsale as onSale,
                  lookup.average_rating as averageRating,
                  lookup.rating_count as ratingCount
                FROM wp_posts p
                ${joins.join(' ')}
                LEFT JOIN wp_wc_product_meta_lookup lookup ON p.ID = lookup.product_id
                WHERE ${whereClauses.join(' AND ')}
                ORDER BY p.post_date DESC
                LIMIT ? OFFSET ?
            `;

            params.push(limit, offset);
            const [rows] = await db.query(sql, params);

            const productIds = rows.map(r => r.id);

            // Batch load all necessary data
            const [
                skus,
                thumbIds,
                taxonomiesArr,
                metaArr,
                excerpts
            ] = await Promise.all([
                loaders.skuLoader.loadMany(productIds),
                loaders.imageLoader.loadMany(productIds),
                loaders.taxonomyLoader.loadMany(productIds),
                loaders.metaLoader.loadMany(productIds),
                loaders.excerptLoader.loadMany(productIds)
            ]);

            // Resolve image GUIDs in batch for thumbnails
            const imageIds = thumbIds.filter(Boolean);
            const imageMap = {};
            if (imageIds.length) {
                const [imgRows] = await db.query(`SELECT ID, guid FROM wp_posts WHERE ID IN (${imageIds.map(() => '?').join(',')})`, imageIds);
                imgRows.forEach(i => { imageMap[i.ID] = i.guid; });
            }

            const nodes = rows.map((r, i) => {
                const terms = taxonomiesArr[i] || [];
                const meta = metaArr[i] || {};
                const thumbId = thumbIds[i];
                const imageSrc = thumbId && imageMap[thumbId] ? imageMap[thumbId] : null;
                // Use formatImage to ensure all fields are present
                const featuredImage = formatImage(imageSrc ? { src: imageSrc, sourceUrl: imageSrc } : null);
                const images = [featuredImage];

                const categories = terms.filter(t => t.taxonomy === 'product_cat').map(t => ({ id: t.id, databaseId: t.id, name: t.name, slug: t.slug }));
                const tags = terms.filter(t => t.taxonomy === 'product_tag').map(t => ({ id: t.id, name: t.name, slug: t.slug }));
                const brands = terms.filter(t => ['product_brand', 'pwb-brand', 'yith_product_brand', 'brand', 'pa_brand'].includes(t.taxonomy))
                    .map(t => ({ id: t.id, databaseId: t.id, name: t.name, slug: t.slug, taxonomy: t.taxonomy }));
                const locations = terms.filter(t => t.taxonomy === 'product_location').map(t => ({ id: t.id, databaseId: t.id, name: t.name, slug: t.slug }));

                // Parse attributes if available
                let attributes = [];
                if (meta._product_attributes) {
                    try {
                        const parsedAttrs = parseProductAttributes(meta._product_attributes, terms);
                        attributes = parsedAttrs.map(attr => ({
                            id: attr.slug,
                            name: attr.name,
                            label: attr.name,
                            slug: attr.slug,
                            options: attr.terms.map(t => t.name),
                            visible: attr.isVisible,
                            variation: attr.isVariation
                        }));
                    } catch (e) { }
                }

                return {
                    id: r.id,
                    productId: r.id,
                    databaseId: r.id,
                    name: r.name,
                    slug: r.slug,
                    link: `https://shopwice.com/product/${r.slug}/`,
                    price: r.price ? r.price.toString() : "0",
                    regularPrice: r.regularPrice ? r.regularPrice.toString() : "0",
                    salePrice: meta._sale_price ? meta._sale_price.toString() : null,
                    onSale: r.onSale === 1,
                    shortDescription: excerpts[i] || meta._short_description || '',
                    sku: skus[i],
                    stockQuantity: r.stockQuantity || null,
                    stockStatus: meta._stock_status || 'instock',
                    manageStock: meta._manage_stock === 'yes',
                    status: meta._status || 'publish',
                    date: r.date || null,
                    type: meta._type || 'simple',
                    images,
                    image: featuredImage,
                    featuredImage: featuredImage,
                    galleryImages: { nodes: images },
                    categories,
                    productCategories: { nodes: categories },
                    tags,
                    brands,
                    productBrands: { nodes: brands },
                    locations,
                    productLocation: { nodes: locations },
                    attributes: {
                        nodes: attributes
                    },
                    totalSales: parseInt(meta.total_sales || 0),
                    averageRating: parseFloat(r.averageRating || 0),
                    reviewCount: parseInt(r.ratingCount || 0),
                    ratingCount: parseInt(r.ratingCount || 0),
                    // Store raw meta for field resolvers to avoid extra DB hits
                    _upsell_ids: meta._upsell_ids,
                    _crosssell_ids: meta._crosssell_ids,
                    _product_image_gallery: meta._product_image_gallery,
                    // These fields will be handled by Product field resolvers if requested
                    bestSellers: [],
                    reviews: { nodes: [] }
                };
            });

            const edges = nodes.map((node, index) => ({
                cursor: Buffer.from(`cursor:${offset + index}`).toString('base64'),
                node
            }));

            const result = {
                edges,
                nodes,
                totalCount,
                pageInfo: {
                    hasNextPage: offset + nodes.length < totalCount,
                    hasPreviousPage: offset > 0,
                    startCursor: edges.length > 0 ? edges[0].cursor : null,
                    endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null
                }
            };

            if (env && env.CACHE) {
                // Cache for 15 minutes for lists (shorter than single items)
                const ttl = 900;
                const putPromise = env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: ttl });
                if (waitUntil) waitUntil(putPromise);
                else await putPromise;
            }

            return result;
        },

        // Simple categories list with Caching
        async categories(_, __, { env, waitUntil }) {
            const cacheKey = 'all_categories';
            let cached = null;
            if (env && env.CACHE) {
                try {
                    cached = await env.CACHE.get(cacheKey, { type: 'json' });
                } catch (e) {
                    console.error('KV Cache Error:', e);
                }
            }
            if (cached) return cached;

            const [rows] = await db.query(`
        SELECT
          t.term_id as id,
          t.name,
          t.slug,
          tt.description,
          tt.parent,
          tt.count
        FROM wp_terms t
        JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
        WHERE tt.taxonomy = 'product_cat'
        ORDER BY t.name ASC
      `);
            const result = rows.map(c => ({
                id: c.id,
                databaseId: c.id,
                name: c.name,
                slug: c.slug,
                description: c.description,
                parent: c.parent,
                count: c.count
            }));
            
            if (env && env.CACHE && waitUntil) {
                // Cache for 1 hour
                waitUntil(env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 3600 }));
            } else if (env && env.CACHE) {
                 // Fallback if waitUntil is not available
                 await env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 3600 });
            }
            
            return result;
        },

        // New nested categories query (WPGraphQL compatible)
        async productCategories(_, { where }, { env, waitUntil }) {
            // Try to serve from cache if available
            const cacheKey = where ? `product_categories_${JSON.stringify(where)}` : 'all_product_categories';
            let cached = null;
            
            if (env && env.CACHE) {
                try {
                    cached = await env.CACHE.get(cacheKey, { type: 'json' });
                } catch (e) {
                    console.error('KV Cache Error:', e);
                }
            }
            if (cached) return cached;

            let sql = `
                SELECT t.term_id as id, t.name, t.slug, tt.description, tt.parent, tt.count
                FROM wp_terms t
                JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
                WHERE tt.taxonomy = 'product_cat'
            `;
            const params = [];
            if (where && where.slug) {
                const slugs = Array.isArray(where.slug) ? where.slug : [where.slug];
                const placeholders = slugs.map(() => '?').join(',');
                sql += ` AND t.slug IN (${placeholders})`;
                params.push(...slugs);
            }
            sql += ` ORDER BY t.name ASC`;

            const [rows] = await db.query(sql, params);
            const result = {
                nodes: rows.map(c => ({
                    id: c.id,
                    databaseId: c.id,
                    name: c.name,
                    slug: c.slug,
                    description: c.description,
                    parent: c.parent,
                    count: c.count
                }))
            };

            // Cache the result
            if (env && env.CACHE) {
                const ttl = 3600; // 1 hour
                const putPromise = env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: ttl });
                if (waitUntil) {
                    waitUntil(putPromise);
                } else {
                    await putPromise;
                }
            }

            return result;
        },

        // Get single vendor by ID or slug
        async vendor(_, { id, slug }, { env, waitUntil }) {
            const cacheKey = id ? `vendor_id_${id}` : `vendor_slug_${slug}`;
            let cached = null;
            if (env && env.CACHE) {
                try {
                    cached = await env.CACHE.get(cacheKey, { type: 'json' });
                } catch (e) {
                    console.error('KV Cache Error:', e);
                }
            }
            if (cached) return cached;

            const wcfm = require('../services/wcfm');

            try {
                let vendorData;

                if (id) {
                    vendorData = await wcfm.getVendor(id);
                } else if (slug) {
                    vendorData = await wcfm.getVendorBySlug(slug);
                } else {
                    return null;
                }

                if (!vendorData) return null;

                // Get vendor statistics
                let stats = { total_sales: 0, product_count: 0 };
                try {
                    stats = await wcfm.getVendorStats(vendorData.id || vendorData.ID);
                } catch (e) {
                    // Stats endpoint might not be available
                }

                // Map WCFM API response to GraphQL schema
                const result = {
                    id: vendorData.id || vendorData.ID,
                    shopName: vendorData.store_name || vendorData.shop_name || vendorData.display_name,
                    shopSlug: vendorData.store_slug || vendorData.user_nicename,
                    shopDescription: vendorData.store_description || vendorData.shop_description || null,
                    shopUrl: vendorData.store_url || `${process.env.WC_URL}/store/${vendorData.store_slug || vendorData.user_nicename}`,
                    email: vendorData.store_email || vendorData.user_email,
                    phone: vendorData.phone || vendorData.store_phone || null,
                    address: {
                        street: vendorData.address?.street_1 || vendorData.address?.address || null,
                        city: vendorData.address?.city || null,
                        state: vendorData.address?.state || null,
                        country: vendorData.address?.country || null,
                        zip: vendorData.address?.zip || vendorData.address?.postcode || null,
                        latitude: vendorData.geolocation?.latitude ? parseFloat(vendorData.geolocation.latitude) : null,
                        longitude: vendorData.geolocation?.longitude ? parseFloat(vendorData.geolocation.longitude) : null
                    },
                    logo: vendorData.gravatar || vendorData.store_logo || null,
                    banner: vendorData.banner || vendorData.store_banner || null,
                    social: {
                        facebook: vendorData.social?.fb || vendorData.social?.facebook || null,
                        twitter: vendorData.social?.twitter || null,
                        instagram: vendorData.social?.instagram || null,
                        linkedin: vendorData.social?.linkedin || null,
                        youtube: vendorData.social?.youtube || null
                    },
                    rating: vendorData.rating ? parseFloat(vendorData.rating) : 0,
                    reviewCount: vendorData.review_count || 0,
                    totalSales: stats.total_sales || 0,
                    productCount: stats.product_count || vendorData.product_count || 0,
                    memberSince: vendorData.registered || vendorData.member_since,
                    isEnabled: vendorData.status === 'approved' || vendorData.is_store_offline === false
                };

                if (env && env.CACHE) {
                    const ttl = 3600;
                    const putPromise = env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: ttl });
                    if (waitUntil) waitUntil(putPromise);
                    else await putPromise;
                }

                return result;
            } catch (error) {
                console.error('Vendor resolver error:', error.message);
                return null;
            }
        },

        // List vendors with pagination
        async vendors(_, args) {
            const wcfm = require('../services/wcfm');
            const where = args.where || {};
            // TODO: Implement pagination and filtering via WCFM service
            // For now, return empty or implement basic
            return { nodes: [] }; 
        }
    },

    Mutation: {
        async createProduct(_, { input }, { user, env }) {
            if (!user) throw new Error('Authentication required');
            const wcApi = new WooCommerceClient(env);
            const vendorId = user.id;

            const data = {
                name: input.name,
                type: input.type || 'simple',
                regular_price: input.regularPrice,
                sale_price: input.salePrice,
                description: input.description,
                short_description: input.shortDescription,
                sku: input.sku,
                stock_quantity: input.stockQuantity,
                manage_stock: input.stockQuantity !== undefined ? true : undefined,
                status: 'pending', // Vendors usually create pending products
                categories: input.categories,
                images: input.images || input.galleryImages ? [
                    ...(input.images || []),
                    ...(input.galleryImages || [])
                ] : undefined
            };

            // Remove undefined keys
            Object.keys(data).forEach(key => data[key] === undefined && delete data[key]);

            try {
                const product = await wcApi.post("/products", data);

                // Sync with WCFM if we have a vendor ID
                if (product && product.id && vendorId) {
                    await db.query(
                        "INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_wcfm_product_author', ?) ON DUPLICATE KEY UPDATE meta_value = ?",
                        [product.id, vendorId, vendorId]
                    );
                    await db.query(
                        "INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_wcfm_product_views', '0') ON DUPLICATE KEY UPDATE meta_value = meta_value", // Don't reset if exists
                        [product.id]
                    );
                    // Update post_author in wp_posts
                    await db.query("UPDATE wp_posts SET post_author = ? WHERE ID = ?", [vendorId, product.id]);
                }

                return formatWcProduct(product);
            } catch (error) {
                console.error("WooCommerce API Error:", error.data || error.message);
                throw new Error(error.data?.message || "Failed to create product");
            }
        },

        async updateProduct(_, { id, input }, { user, env }) {
            if (!user) throw new Error('Authentication required');
            // TODO: Add ownership check: if (user) verify user.id === product.post_author
            const wcApi = new WooCommerceClient(env);

            const data = {
                name: input.name,
                type: input.type,
                regular_price: input.regularPrice,
                sale_price: input.salePrice,
                description: input.description,
                short_description: input.shortDescription,
                sku: input.sku,
                stock_quantity: input.stockQuantity,
                manage_stock: input.stockQuantity !== undefined ? true : undefined,
                status: input.status,
                categories: input.categories,
                images: input.images || input.galleryImages ? [
                    ...(input.images || []),
                    ...(input.galleryImages || [])
                ] : undefined,
                stock_status: input.stockStatus
            };

            // Remove undefined keys
            Object.keys(data).forEach(key => data[key] === undefined && delete data[key]);

            try {
                const response = await wcApi.post(`/products/${id}`, data); // Note: WC v3 uses POST for update usually, or PUT. V3 supports PUT.
                return formatWcProduct(response);
            } catch (error) {
                console.error("WooCommerce API Error:", error.data || error.message);
                throw new Error(error.data?.message || "Failed to update product");
            }
        },

        async deleteProduct(_, { id }, { user, env }) {
            if (!user) throw new Error('Authentication required');
            const wcApi = new WooCommerceClient(env);
            try {
                await wcApi.request('DELETE', `/products/${id}`, { force: true });
                return true;
            } catch (error) {
                console.error("WooCommerce API Error:", error.data || error.message);
                return false;
            }
        },

        async registerCustomer(_, { input }, { env }) {
            const wcApi = new WooCommerceClient(env);
            const data = {
                email: input.email,
                username: input.username || input.email, // Use email as username if not provided
                password: input.password,
                first_name: input.firstName,
                last_name: input.lastName
            };

            try {
                const customer = await wcApi.post("/customers", data);
                return {
                    id: customer.id,
                    email: customer.email,
                    username: customer.username,
                    firstName: customer.first_name,
                    lastName: customer.last_name,
                    role: customer.role
                };
            } catch (error) {
                console.error("WooCommerce Customer Registration Error:", error.data || error.message);
                if (error.data && error.data.message) {
                    throw new Error(error.data.message);
                }
                throw new Error("Failed to register customer");
            }
        },

        async loginWithSocial(_, { input }, { env }) {
            const { provider, accessToken } = input;
            const wcApi = new WooCommerceClient(env);

            if (provider === "google") {
                try {
                    // Verify token with Google
                    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${accessToken}`);
                    if (!res.ok) throw new Error('Invalid Google token');
                    const payload = await res.json();
                    
                    if (payload.aud !== env.GOOGLE_CLIENT_ID && payload.aud !== process.env.GOOGLE_CLIENT_ID) {
                         // warning: aud mismatch, but continue for now if strict check needed
                    }

                    const { email, given_name, family_name } = payload;
                    const first_name = given_name;
                    const last_name = family_name;

                    let customer;
                    try {
                        const searchResponse = await wcApi.get("/customers", { email });
                        if (searchResponse && searchResponse.length > 0) {
                            customer = searchResponse[0];
                        }
                    } catch (err) { }

                    if (!customer) {
                        const createResponse = await wcApi.post("/customers", {
                            email,
                            first_name,
                            last_name,
                            username: email.split("@")[0] + "_" + Math.floor(Math.random() * 1000),
                            password: Math.random().toString(36).slice(-12)
                        });
                        customer = createResponse;
                    }

                    const jwtPayload = {
                        id: customer.id,
                        email: customer.email,
                        username: customer.username,
                        role: customer.role || "customer"
                    };

                    const token = await signJwt(jwtPayload, env.JWT_SECRET || process.env.JWT_SECRET);

                    return {
                        token,
                        user: {
                            id: customer.id,
                            email: customer.email,
                            username: customer.username,
                            firstName: customer.first_name,
                            lastName: customer.last_name,
                            role: customer.role
                        }
                    };
                } catch (error) {
                    console.error("Google Auth Error:", error.message);
                    throw new Error("Invalid Google token");
                }
            } else if (provider === "facebook") {
                try {
                    const fbResponse = await fetch(`https://graph.facebook.com/me?fields=id,email,first_name,last_name,picture&access_token=${accessToken}`);
                    if (!fbResponse.ok) throw new Error("Invalid Facebook token");
                    const { email, first_name, last_name } = await fbResponse.json();

                    if (!email) throw new Error("Email permission required");

                    let customer;
                    try {
                        const searchResponse = await wcApi.get("/customers", { email });
                        if (searchResponse && searchResponse.length > 0) {
                            customer = searchResponse[0];
                        }
                    } catch (err) { }

                    if (!customer) {
                        const createResponse = await wcApi.post("/customers", {
                            email,
                            first_name,
                            last_name,
                            username: email.split("@")[0] + "_fb" + Math.floor(Math.random() * 1000),
                            password: Math.random().toString(36).slice(-12)
                        });
                        customer = createResponse;
                    }

                    const jwtPayload = {
                        id: customer.id,
                        email: customer.email,
                        username: customer.username,
                        role: customer.role || "customer"
                    };

                    const token = await signJwt(jwtPayload, env.JWT_SECRET || process.env.JWT_SECRET);

                    return {
                        token,
                        user: {
                            id: customer.id,
                            email: customer.email,
                            username: customer.username,
                            firstName: customer.first_name,
                            lastName: customer.last_name,
                            role: customer.role
                        }
                    };
                } catch (error) {
                    console.error("Facebook Auth Error:", error.message);
                    throw new Error("Invalid Facebook token");
                }
            }

            throw new Error(`Provider ${provider} not supported`);
        }
    },

    Product: {
        allPaColor: (parent) => {
            const attributes = parent.attributes?.nodes || [];
            const colorAttr = attributes.find(a => a.id === 'pa_color' || a.slug === 'pa_color');
            if (!colorAttr) return { nodes: [] };
            return { nodes: colorAttr.options.map(name => ({ name })) };
        },
        allPaSize: (parent) => {
            const attributes = parent.attributes?.nodes || [];
            const sizeAttr = attributes.find(a => a.id === 'pa_size' || a.slug === 'pa_size');
            if (!sizeAttr) return { nodes: [] };
            return { nodes: sizeAttr.options.map(name => ({ name })) };
        },
        upsellProducts: async (parent, _, { loaders }) => {
            if (parent.upsellProducts && parent.upsellProducts.length > 0) return parent.upsellProducts;
            const ids = parseMetaIds(parent.upsellIds || parent._upsell_ids);
            if (!ids.length) return [];
            const summaries = await loaders.productSummaryLoader.loadMany(ids);
            return summaries.filter(Boolean);
        },
        crossSellProducts: async (parent, _, { loaders }) => {
            if (parent.crossSellProducts && parent.crossSellProducts.length > 0) return parent.crossSellProducts;
            const ids = parseMetaIds(parent.crossSellIds || parent._crosssell_ids);
            if (!ids.length) return [];
            const summaries = await loaders.productSummaryLoader.loadMany(ids);
            return summaries.filter(Boolean);
        },
        crossSell: async (parent, _, { loaders }) => {
            if (parent.crossSell && parent.crossSell.nodes && parent.crossSell.nodes.length > 0) return parent.crossSell;
            const ids = parseMetaIds(parent.crossSellIds || parent._crosssell_ids);
            if (!ids.length) return { nodes: [] };
            const summaries = await loaders.productSummaryLoader.loadMany(ids);
            return { nodes: summaries.filter(Boolean) };
        },
        relatedProducts: async (parent, _, { loaders }) => {
            if (parent.relatedProducts && parent.relatedProducts.length > 0) return parent.relatedProducts;

            // Try upsells first as related
            const upsellIds = parseMetaIds(parent.upsellIds || parent._upsell_ids);
            if (upsellIds.length > 0) {
                const summaries = await loaders.productSummaryLoader.loadMany(upsellIds);
                return summaries.filter(Boolean);
            }

            // Fallback: Same category products
            let categories = parent.categories || (parent.productCategories && parent.productCategories.nodes);
            if (!categories && parent.id) {
                const terms = await loaders.taxonomyLoader.load(parent.id);
                categories = terms.filter(t => t.taxonomy === 'product_cat');
            }

            if (!categories || categories.length === 0) return [];

            const catIds = categories.map(c => c.id || c.databaseId);
            const [relRows] = await db.query(`
                SELECT tr.object_id 
                FROM wp_term_relationships tr
                JOIN wp_posts p ON tr.object_id = p.ID
                WHERE tr.term_taxonomy_id IN (
                  SELECT term_taxonomy_id FROM wp_term_taxonomy WHERE term_id IN (?)
                ) AND tr.object_id != ?
                AND p.post_type = 'product'
                AND p.post_status = 'publish'
                LIMIT 4
            `, [catIds, parent.id || parent.databaseId || parent.productId]);

            const relatedIds = relRows.map(r => r.object_id);
            const summaries = await loaders.productSummaryLoader.loadMany(relatedIds);
            return summaries.filter(Boolean);
        },
        galleryImages: async (parent, _, { loaders }) => {
            // If already fully populated with more than 1 image (or explicitly populated)
            if (parent.galleryImages && parent.galleryImages.nodes && parent.galleryImages.nodes.length > 1) {
                return parent.galleryImages;
            }

            let galleryStr = parent.galleryStr || parent._product_image_gallery;
            if (galleryStr === undefined && parent.id) {
                galleryStr = await loaders.galleryLoader.load(parent.id);
            }

            if (!galleryStr) {
                const featured = parent.image || parent.featuredImage;
                return { nodes: featured ? [featured] : [] };
            }

            const ids = galleryStr.split(',').filter(Boolean);
            const details = await loaders.imageDetailsLoader.loadMany(ids);
            const nodes = details.filter(Boolean).map(img => formatImage(img));

            // Prepend featured image if not already in gallery
            const featured = parent.image || parent.featuredImage;
            if (featured && !nodes.find(n => n.src === featured.src)) {
                nodes.unshift(featured);
            }

            return { nodes };
        },
        images: async (parent, _, { loaders }) => {
            if (parent.images && parent.images.length > 1) return parent.images;

            let galleryStr = parent.galleryStr || parent._product_image_gallery;
            if (galleryStr === undefined && parent.id) {
                galleryStr = await loaders.galleryLoader.load(parent.id);
            }

            if (!galleryStr) {
                const featured = parent.image || parent.featuredImage;
                return featured ? [featured] : [];
            }

            const ids = galleryStr.split(',').filter(Boolean);
            const details = await loaders.imageDetailsLoader.loadMany(ids);
            const nodes = details.filter(Boolean).map(img => formatImage(img));

            // Prepend featured image
            const featured = parent.image || parent.featuredImage;
            if (featured && !nodes.find(n => n.src === featured.src)) {
                nodes.unshift(featured);
            }

            return nodes;
        },
        variations: async (parent, _, { loaders }) => {
            const productId = parent.id || parent.databaseId || parent.productId;
            if (!productId) return { nodes: [] };

            const [rows] = await db.query(`
                SELECT p.ID as id, p.post_title as name, 
                       lookup.sku, lookup.stock_status, lookup.stock_quantity,
                       lookup.min_price as price, lookup.max_price as regularPrice,
                       (SELECT meta_value FROM wp_postmeta WHERE post_id = p.ID AND meta_key = '_sale_price' LIMIT 1) as salePrice,
                       (SELECT meta_value FROM wp_postmeta WHERE post_id = p.ID AND meta_key = '_thumbnail_id' LIMIT 1) as imageId
                FROM wp_posts p 
                LEFT JOIN wp_wc_product_meta_lookup lookup ON p.ID = lookup.product_id
                WHERE p.post_parent = ? AND p.post_type = 'product_variation' AND p.post_status = 'publish'
            `, [productId]);

            const nodes = rows.map(v => ({
                id: v.id,
                databaseId: v.id,
                name: v.name,
                sku: v.sku,
                stockStatus: v.stock_status,
                stockQuantity: v.stock_quantity,
                purchasable: true,
                onSale: v.salePrice ? true : false,
                salePrice: v.salePrice ? v.salePrice.toString() : null,
                regularPrice: v.regularPrice ? v.regularPrice.toString() : "0",
                price: v.price ? v.price.toString() : "0",
                imageId: v.imageId
            }));

            return { nodes };
        },
        variants: async (parent, args, context) => {
            const res = await resolvers.Product.variations(parent, args, context);
            return res.nodes;
        }
    },

    ProductVariation: {
        attributes: async (variation, _, { loaders }) => {
            const meta = await loaders.variationAttributeLoader.load(variation.id || variation.databaseId);
            const nodes = [];
            for (const key in meta) {
                if (key.startsWith('attribute_')) {
                    const slug = key.replace('attribute_', '');
                    const value = meta[key];
                    nodes.push({
                        name: slug,
                        label: slug.replace('pa_', '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                        options: [value]
                    });
                }
            }
            return { nodes: nodes.length > 0 ? nodes : null };
        },
        image: async (variation, _, { loaders }) => {
            let thumbId = variation.imageId;
            if (!thumbId) {
                thumbId = await loaders.imageLoader.load(variation.id || variation.databaseId);
            }
            if (!thumbId) return null;
            const details = await loaders.imageDetailsLoader.load(thumbId);
            return formatImage(details);
        }
    },

    Category: {
        ancestors: (category) => {
            // For now, return empty nodes as we don't have deep taxonomy support in this middleware yet
            // This prevents GraphQL errors on the frontend which expects this field.
            return { nodes: [] };
        }
    }
};

module.exports = { resolvers };
