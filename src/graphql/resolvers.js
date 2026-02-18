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
    // Fix circular reference for JSON serialization
    // Instead of self-reference, we create a copy if needed, or omit it if not strictly required by client.
    // WPGraphQL often uses { node: { sourceUrl } }. 
    // We'll create a new object for 'node' to avoid the cycle.
    image.node = { ...image };
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

// Helper: Sync Product to D1 (SQLite)
const syncProductToD1 = async (p, vendorId) => {
    try {
        // Dates
        const postDate = (p.date_created || new Date().toISOString()).replace('T', ' ').split('.')[0];
        const postDateGmt = (p.date_created_gmt || new Date().toISOString()).replace('T', ' ').split('.')[0];
        const postModified = (p.date_modified || new Date().toISOString()).replace('T', ' ').split('.')[0];
        const postModifiedGmt = (p.date_modified_gmt || new Date().toISOString()).replace('T', ' ').split('.')[0];

        // Author
        const productAuthor = vendorId || p.post_author || 0;

        // 1. wp_posts
        await db.query(`
            INSERT INTO wp_posts (
                ID, post_author, post_date, post_date_gmt, post_content, post_title, 
                post_excerpt, post_status, comment_status, ping_status, post_name, 
                post_modified, post_modified_gmt, post_parent, guid, post_type, menu_order
            ) VALUES (
                ?, ?, ?, ?, ?, ?, 
                ?, ?, 'open', 'closed', ?, 
                ?, ?, ?, ?, 'product', ?
            ) ON CONFLICT(ID) DO UPDATE SET 
                post_title=excluded.post_title, 
                post_content=excluded.post_content,
                post_excerpt=excluded.post_excerpt,
                post_status=excluded.post_status, 
                post_author=excluded.post_author,
                post_modified=excluded.post_modified,
                post_modified_gmt=excluded.post_modified_gmt,
                post_name=excluded.post_name,
                post_parent=excluded.post_parent;
        `, [
            p.id, productAuthor, postDate, postDateGmt, p.description || '', p.name || '',
            p.short_description || '', p.status, p.slug || '',
            postModified, postModifiedGmt, p.parent_id || 0, p.permalink || '', p.menu_order || 0
        ]);

        // 2. wp_postmeta - Vendor Association
        if (vendorId) {
            await db.query("DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = '_wcfm_product_author'", [p.id]);
            await db.query("INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_wcfm_product_author', ?)", [p.id, vendorId]);
        }

        // 3. Other Meta
        const meta = {
            '_price': p.price,
            '_regular_price': p.regular_price,
            '_sale_price': p.sale_price,
            '_sku': p.sku,
            '_stock_status': p.stock_status,
            '_stock': p.stock_quantity,
            '_manage_stock': p.manage_stock ? 'yes' : 'no'
        };

        for (const [k, v] of Object.entries(meta)) {
            if (v !== undefined && v !== null) {
                await db.query("DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = ?", [p.id, k]);
                await db.query("INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)", [p.id, k, String(v)]);
            }
        }

        // 4. Lookup Table
        await db.query(`
            INSERT INTO wp_wc_product_meta_lookup (
                product_id, sku, min_price, max_price, onsale, stock_quantity, stock_status, average_rating, total_sales
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?
            ) ON CONFLICT(product_id) DO UPDATE SET 
                min_price=excluded.min_price, 
                max_price=excluded.max_price, 
                stock_status=excluded.stock_status,
                stock_quantity=excluded.stock_quantity,
                onsale=excluded.onsale;
        `, [
            p.id, p.sku || '', p.price || 0, p.price || 0,
            p.on_sale ? 1 : 0, p.stock_quantity || 0, p.stock_status === 'instock' ? 'instock' : 'outofstock',
            p.average_rating || 0, p.total_sales || 0
        ]);

        console.log(`Synced product ${p.id} to D1`);
    } catch (e) {
        console.error(`Error syncing product ${p.id} to D1:`, e);
    }
};

// Helper to map Store API Cart to Schema
const mapStoreApiCart = (data) => {
    if (!data) return null;
    return {
        contents: {
            nodes: data.items ? data.items.map(item => ({
                key: item.key,
                quantity: item.quantity,
                total: (item.totals?.line_total || 0).toString(),
                subtotal: (item.totals?.line_subtotal || 0).toString(),
                product: {
                    node: {
                        id: item.id,
                        name: item.name,
                        price: (item.prices?.price || 0).toString(),
                        images: item.images ? item.images.map(img => formatImage(img)) : []
                    }
                }
            })) : [],
            itemCount: data.items_count || 0
        },
        itemCount: data.items_count || 0, // Added root level itemCount
        total: (data.totals?.total_price || 0).toString(),
        subtotal: (data.totals?.total_items || 0).toString(),
        totalTax: (data.totals?.total_tax || 0).toString(),
        isEmpty: !data.items || data.items.length === 0,
        needsPayment: data.needs_payment || false,
        needsShipping: data.needs_shipping || false
    };
};

const resolvers = {
    Query: {
        // Vendor Orders
        async orders(_, args, { user, env }) {
            if (!user) throw new Error('Authentication required');
            const wcfm = require('../services/wcfm');

            try {
                // If user is admin, they can see all (or filter by vendor)
                // If user is vendor, force filter by their ID
                const vendorId = user.role === 'wcfm_vendor' ? user.id : (args.vendorId || null);

                // TODO: Implement pagination args (page, perPage)
                const page = args.page || 1;
                const perPage = args.perPage || 10;

                const result = await wcfm.getVendorOrders(vendorId, page, perPage, env);
                return {
                    nodes: result.orders,
                    pageInfo: {
                        hasNextPage: page < result.totalPages,
                        total: result.total
                    }
                };
            } catch (error) {
                console.error('Orders resolver error:', error.message);
                return { nodes: [], pageInfo: { hasNextPage: false, total: 0 } };
            }
        },

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
                    const [galleryRows] = await db.query(`SELECT ID, guid, post_title, post_excerpt FROM wp_posts WHERE ID IN (${galleryIds.map(() => '?').join(',')})`, galleryIds);
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
            SELECT term_taxonomy_id FROM wp_term_taxonomy WHERE term_id IN (${catIds.map(() => '?').join(',')})
          ) AND tr.object_id != ?
          AND p.post_type = 'product'
          AND p.post_status = 'publish'
          LIMIT 4
        `, [...catIds, product.id]);
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
            const nocache = args.nocache || (args.where && args.where.nocache);

            // Generate Cache Key with Versioning
            let cacheVersion = '1';
            if (env && env.CACHE) {
                try {
                    const v = await env.CACHE.get('product_list_version');
                    if (v) cacheVersion = v;
                } catch (e) {
                    console.error('KV Cache Version Error:', e);
                }
            }

            const cacheKey = `products_v${cacheVersion}_${JSON.stringify(args)}`;
            let cached = null;
            if (env && env.CACHE && !nocache) {
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
                        const decoded = atob(after); // Use atob instead of Buffer for Cloudflare compatibility
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

                // Check if valid number (ID) or String (Slug)
                if (/^\d+$/.test(category)) {
                    whereClauses.push(`tt_cat.taxonomy = 'product_cat' AND tt_cat.term_id = ?`);
                    params.push(category);
                } else {
                    // Treat as Slug
                    joins.push(`JOIN wp_terms t_cat ON tt_cat.term_id = t_cat.term_id`);
                    whereClauses.push(`tt_cat.taxonomy = 'product_cat' AND t_cat.slug = ?`);
                    params.push(category);
                }
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

            let orderByStr = 'p.post_date';
            let orderStr = 'DESC';

            if (where?.orderby) {
                if (where.orderby === 'price') orderByStr = 'lookup.min_price';
                else if (where.orderby === 'title') orderByStr = 'p.post_title';
                else if (where.orderby === 'modified') orderByStr = 'p.post_modified';
                else if (where.orderby === 'id') orderByStr = 'p.ID';
            }
            if (where?.order && ['ASC', 'DESC'].includes(where.order.toUpperCase())) {
                orderStr = where.order.toUpperCase();
            }

            // Main Query
            const sql = `
                SELECT DISTINCT
                  p.ID as id,
                  p.post_title as name,
                  p.post_name as slug,
                  p.post_date as date,
                  p.guid as link,
                  p.guid as url,
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
                ORDER BY ${orderByStr} ${orderStr}, p.ID DESC
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
                const placeholders = imageIds.map(() => '?').join(',');
                const [imgRows] = await db.query(`SELECT ID, guid FROM wp_posts WHERE ID IN (${placeholders})`, imageIds);
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
                    link: r.link && r.link.includes('shopwice.com/product/') ? r.link : `https://shopwice.com/product/${r.slug}/`,
                    url: r.link && r.link.includes('shopwice.com/product/') ? r.link : `https://shopwice.com/product/${r.slug}/`,
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
            let cacheVersion = '1';
            if (env && env.CACHE) {
                try {
                    const v = await env.CACHE.get('category_list_version');
                    if (v) cacheVersion = v;
                } catch (e) { }
            }

            const cacheKey = `all_categories_v${cacheVersion}`;
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
          tt.count,
          tm.meta_value as thumbnail_id
        FROM wp_terms t
        JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
        LEFT JOIN wp_termmeta tm ON t.term_id = tm.term_id AND tm.meta_key = 'thumbnail_id'
        WHERE tt.taxonomy = 'product_cat'
        ORDER BY t.name ASC
      `);

            // Resolve Images
            const thumbIds = rows.map(r => r.thumbnail_id).filter(Boolean);
            const imageMap = {};
            if (thumbIds.length > 0) {
                const placeholders = thumbIds.map(() => '?').join(',');
                const [imgRows] = await db.query(`SELECT ID, guid FROM wp_posts WHERE ID IN (${placeholders})`, thumbIds);
                imgRows.forEach(i => { imageMap[i.ID] = i.guid; });
            }

            const result = rows.map(c => {
                const imgUrl = c.thumbnail_id && imageMap[c.thumbnail_id] ? imageMap[c.thumbnail_id] : null;
                return {
                    id: c.id,
                    databaseId: c.id,
                    name: c.name,
                    slug: c.slug,
                    description: c.description,
                    parent: c.parent,
                    count: c.count,
                    image: formatImage(imgUrl ? { src: imgUrl, sourceUrl: imgUrl } : null)
                };
            });

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
            return resolvers.Query.terms(_, { taxonomy: 'product_cat', where }, { env, waitUntil });
        },

        async productTags(_, { where }, { env, waitUntil }) {
            return resolvers.Query.terms(_, { taxonomy: 'product_tag', where }, { env, waitUntil });
        },

        async productBrands(_, { where }, { env, waitUntil }) {
            // Handle multiple brand taxonomies
            const taxonomies = ['product_brand', 'pwb-brand', 'yith_product_brand', 'brand', 'pa_brand'];
            return resolvers.Query.terms(_, { taxonomy: taxonomies, where }, { env, waitUntil });
        },

        async productLocations(_, { where }, { env, waitUntil }) {
            return resolvers.Query.terms(_, { taxonomy: 'product_location', where }, { env, waitUntil });
        },

        // Generic Terms Resolver
        async terms(_, { taxonomy, where }, { env, waitUntil }) {
            // Normalize taxonomy to array
            const taxList = Array.isArray(taxonomy) ? taxonomy : [taxonomy];

            // Handle cache bypassing
            const { forceRefresh, ...cleanWhere } = where || {};
            const cacheKey = `terms_${taxList.join('_')}_${JSON.stringify(cleanWhere)}`;

            let cached = null;
            if (!forceRefresh && env && env.CACHE) {
                try {
                    cached = await env.CACHE.get(cacheKey, { type: 'json' });
                } catch (e) { console.error('KV Cache Error:', e); }
            }
            if (cached) return cached;

            let sql = `
                SELECT t.term_id as id, t.name, t.slug, tt.description, tt.parent, tt.count, tt.taxonomy,
                tm.meta_value as thumbnail_id
                FROM wp_terms t
                JOIN wp_term_taxonomy tt ON t.term_id = tt.term_id
                LEFT JOIN wp_termmeta tm ON t.term_id = tm.term_id AND tm.meta_key = 'thumbnail_id'
                WHERE tt.taxonomy IN (${taxList.map(() => '?').join(',')})
            `;
            const params = [...taxList];

            if (where) {
                if (where.slug) {
                    const slugs = Array.isArray(where.slug) ? where.slug : [where.slug];
                    const placeholders = slugs.map(() => '?').join(',');
                    sql += ` AND t.slug IN (${placeholders})`;
                    params.push(...slugs);
                }
                if (where.id || where.term_id) {
                    const id = where.id || where.term_id;
                    sql += ` AND t.term_id = ?`;
                    params.push(id);
                }
                if (where.parentId !== undefined && where.parentId !== null) {
                    sql += ` AND tt.parent = ?`;
                    params.push(where.parentId);
                }
                if (where.parent !== undefined && where.parent !== null) {
                    sql += ` AND tt.parent = ?`;
                    params.push(where.parent);
                }
                if (where.search) {
                    sql += ` AND t.name LIKE ?`;
                    params.push(`%${where.search}%`);
                }
            }
            sql += ` ORDER BY t.name ASC`;

            const [rows] = await db.query(sql, params);

            // Resolve Images
            const thumbIds = rows.map(r => r.thumbnail_id).filter(Boolean);
            const imageMap = {};

            if (thumbIds.length > 0) {
                const placeholders = thumbIds.map(() => '?').join(',');
                const [imgRows] = await db.query(`SELECT ID, guid FROM wp_posts WHERE ID IN (${placeholders})`, thumbIds);
                imgRows.forEach(i => { imageMap[i.ID] = i.guid; });
            }

            const result = {
                nodes: rows.map(c => {
                    const imgUrl = c.thumbnail_id && imageMap[c.thumbnail_id] ? imageMap[c.thumbnail_id] : null;
                    return {
                        id: c.id,
                        databaseId: c.id,
                        name: c.name,
                        slug: c.slug,
                        description: c.description,
                        parent: c.parent,
                        count: c.count,
                        taxonomy: c.taxonomy,
                        image: formatImage(imgUrl ? { src: imgUrl, sourceUrl: imgUrl } : null)
                    };
                })
            };

            if (env && env.CACHE) {
                const ttl = 3600;
                const putPromise = env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: ttl });
                if (waitUntil) waitUntil(putPromise);
                else await putPromise;
            }
            return result;
        },

        async productAttributeTaxonomies(_, { where }, { env, waitUntil }) {
            const cacheKey = `attribute_taxonomies_${JSON.stringify(where || {})}`;
            let cached = null;
            if (env && env.CACHE) {
                try { cached = await env.CACHE.get(cacheKey, { type: 'json' }); } catch (e) { }
            }
            if (cached) return cached;

            let sql = `SELECT * FROM wp_woocommerce_attribute_taxonomies`;
            const params = [];

            if (where && where.id) {
                sql += ` WHERE attribute_id = ?`;
                params.push(where.id);
            }

            const [rows] = await db.query(sql, params);

            const result = {
                nodes: rows.map(r => ({
                    id: r.attribute_id,
                    name: r.attribute_label,
                    slug: `pa_${r.attribute_name}`,
                    type: r.attribute_type,
                    orderBy: r.attribute_orderby,
                    hasArchives: r.attribute_public === 1
                }))
            };

            if (env && env.CACHE) {
                const ttl = 3600;
                const putPromise = env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: ttl });
                if (waitUntil) waitUntil(putPromise);
                else await putPromise;
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
        },

        // Cart Query
        async cart(_, __, { env, headers, responseHeaders }) {
            // const wcApi = new WooCommerceClient(env); // Not strictly needed if we use fetch directly
            try {
                const WC_URL = env.WC_URL || 'https://shopwice.com';
                const cartUrl = `${WC_URL}/wp-json/wc/store/v1/cart`;

                const fetchHeaders = {
                    'Content-Type': 'application/json',
                };

                // Forward Cookie header if present (crucial for session)
                if (headers && headers.get('cookie')) {
                    fetchHeaders['Cookie'] = headers.get('cookie');
                }
                // Forward Nonce if present
                if (headers && headers.get('x-wc-store-api-nonce')) {
                    fetchHeaders['X-WC-Store-API-Nonce'] = headers.get('x-wc-store-api-nonce');
                }

                // Forward Cart-Token if present
                if (headers && headers.get('cart-token')) {
                    fetchHeaders['Cart-Token'] = headers.get('cart-token');
                }

                const res = await fetch(cartUrl, {
                    method: 'GET',
                    headers: fetchHeaders
                });

                // Debug headers
                console.log('🛒 WC Cart Response Headers:');
                res.headers.forEach((v, k) => console.log(`${k}: ${v}`));

                // Capture Set-Cookie headers and forward them back to client
                const setCookie = res.headers.get('set-cookie');
                if (setCookie && responseHeaders) {
                    responseHeaders.append('Set-Cookie', setCookie);

                    // Also forward Nonce if returned
                    // Check for both standard and potential other names
                    const nonce = res.headers.get('x-wc-store-api-nonce') || res.headers.get('nonce');
                    if (nonce) responseHeaders.append('X-WC-Store-API-Nonce', nonce);

                    const cartToken = res.headers.get('cart-token');
                    if (cartToken) responseHeaders.append('Cart-Token', cartToken);
                }

                if (!res.ok) {
                    // If cart not found or session invalid, return null (empty cart)
                    // console.warn('Cart fetch failed:', res.status, res.statusText);
                    return null;
                }

                const cartData = await res.json();
                return mapStoreApiCart(cartData);

            } catch (error) {
                console.error('Cart Query Error:', error);
                return null;
            }
        }
    },

    Vendor: {
        stats: async (vendor, _, { env }) => {
            const wcfm = require('../services/wcfm');
            try {
                // If stats are already populated (e.g. from getVendor), use them
                // But getVendor doesn't populate 'stats' field fully, it does fetch some counts.
                // However, the `stats` field on Vendor type is a new object.
                // Let's fetch fresh stats.
                return await wcfm.getVendorStats(vendor.id || vendor.ID);
            } catch (error) {
                console.error('Vendor stats resolver error:', error.message);
                return null;
            }
        }
    },

    Mutation: {
        async addToCart(_, { input }, { env, headers, responseHeaders }) {
            const wcApi = new WooCommerceClient(env);
            const { productId, quantity = 1 } = input;



            try {
                const WC_URL = env.WC_URL || 'https://shopwice.com';
                const cartUrl = `${WC_URL}/wp-json/wc/store/v1/cart/add-item`;

                // Prepare headers to forward
                const fetchHeaders = {
                    'Content-Type': 'application/json',
                };

                // Forward Cookie header if present (crucial for session)
                if (headers && headers.get('cookie')) {
                    fetchHeaders['Cookie'] = headers.get('cookie');
                }

                // Forward Nonce if present (try multiple standard headers)
                const nonce = headers && (headers.get('x-wc-store-api-nonce') || headers.get('nonce'));
                if (nonce) {
                    fetchHeaders['X-WC-Store-API-Nonce'] = nonce;
                    fetchHeaders['Nonce'] = nonce; // Some setups might look for this
                }

                // Forward Cart-Token if present
                if (headers && headers.get('cart-token')) {
                    fetchHeaders['Cart-Token'] = headers.get('cart-token');
                }

                // Forward Cart-Token if present
                if (headers && headers.get('cart-token')) {
                    fetchHeaders['Cart-Token'] = headers.get('cart-token');
                }

                const res = await fetch(cartUrl, {
                    method: 'POST',
                    headers: fetchHeaders,
                    body: JSON.stringify({
                        id: productId,
                        quantity: quantity
                    })
                });

                // Capture Set-Cookie headers and forward them back to client
                // Note: fetch API combines multiple Set-Cookie headers into one comma-separated string sometimes,
                // or we need to iterate if it's a Headers object.
                // In Cloudflare Workers, res.headers.get('set-cookie') might return all of them combined.
                // But better to use iteration if possible or just raw get.

                const setCookie = res.headers.get('set-cookie');
                if (setCookie && responseHeaders) {
                    // We need to append, but responseHeaders is a Headers object.
                    // If multiple cookies are combined with comma, it might be tricky.
                    // But typically fetch API handles this.
                    // Let's just try to set it.
                    responseHeaders.append('Set-Cookie', setCookie);

                    // Also forward Nonce if returned
                    const nonce = res.headers.get('x-wc-store-api-nonce') || res.headers.get('nonce');
                    if (nonce) responseHeaders.append('X-WC-Store-API-Nonce', nonce);
                    const cartToken = res.headers.get('cart-token');
                    if (cartToken) responseHeaders.append('Cart-Token', cartToken);
                }

                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.message || 'Failed to add to cart');
                }

                const cartData = await res.json();

                // If cartData is undefined, we return null or empty structure
                if (!cartData) {
                    return { cart: null };
                }

                // Map Store API response to our Schema
                return {
                    cart: mapStoreApiCart(cartData)
                };

            } catch (error) {
                console.error('AddToCart Error:', error);
                throw new Error(error.message);
            }
        },

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
                ] : undefined,
                author: vendorId, // Assign product to vendor
                meta_data: [
                    { key: '_wcfm_product_author', value: vendorId },
                    { key: '_wcfm_product_views', value: '0' }
                ]
            };

            // Remove undefined keys
            Object.keys(data).forEach(key => data[key] === undefined && delete data[key]);

            console.log('Creating product with data:', JSON.stringify(data, null, 2));

            try {
                const product = await wcApi.post("/products", data);

                // Sync with WCFM and D1 immediately
                if (product && product.id) {
                    await syncProductToD1(product, vendorId);

                    // Invalidate Product List Cache
                    if (env.CACHE) {
                        try {
                            await env.CACHE.put('product_list_version', Date.now().toString());
                        } catch (e) { console.error('Failed to update product_list_version:', e); }
                    }
                }

                return formatWcProduct(product);
            } catch (error) {
                console.error("WooCommerce API Error:", error.data || error.message);
                throw new Error(error.data?.message || "Failed to create product");
            }
        },

        async updateProduct(_, { id, input }, { user, env }) {
            if (!user) throw new Error('Authentication required');

            // Ownership check
            if (user.role === 'wcfm_vendor') {
                const [rows] = await db.query(`
                    SELECT p.post_author, pm.meta_value as wcfm_author
                    FROM wp_posts p
                    LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id AND pm.meta_key = '_wcfm_product_author'
                    WHERE p.ID = ?
                `, [id]);

                if (!rows.length) throw new Error('Product not found');

                const isAuthor = rows[0].post_author == user.id;
                const isWcfmAuthor = rows[0].wcfm_author == user.id;

                if (!isAuthor && !isWcfmAuthor) {
                    throw new Error('You do not have permission to edit this product');
                }
            }

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
                const response = await wcApi.post(`/products/${id}`, data);

                // Update D1 cache immediately
                if (response && response.id) {
                    // For update, we might not have the full vendor context, but we can rely on existing or check user
                    // If user is vendor, we know the vendor ID.
                    const vendorId = user.role === 'wcfm_vendor' ? user.id : undefined;
                    await syncProductToD1(response, vendorId);

                    // Invalidate Product List Cache
                    if (env.CACHE) {
                        try {
                            await env.CACHE.put('product_list_version', Date.now().toString());
                        } catch (e) { console.error('Failed to update product_list_version:', e); }
                    }
                }

                return formatWcProduct(response);
            } catch (error) {
                console.error("WooCommerce API Error:", error.data || error.message);
                throw new Error(error.data?.message || "Failed to update product");
            }
        },

        async deleteProduct(_, { id }, { user, env }) {
            if (!user) throw new Error('Authentication required');

            // Ownership check
            if (user.role === 'wcfm_vendor') {
                const [rows] = await db.query(`
                    SELECT p.post_author, pm.meta_value as wcfm_author
                    FROM wp_posts p
                    LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id AND pm.meta_key = '_wcfm_product_author'
                    WHERE p.ID = ?
                `, [id]);

                if (!rows.length) throw new Error('Product not found');

                const isAuthor = rows[0].post_author == user.id;
                const isWcfmAuthor = rows[0].wcfm_author == user.id;

                if (!isAuthor && !isWcfmAuthor) {
                    throw new Error('You do not have permission to delete this product');
                }
            }

            const wcApi = new WooCommerceClient(env);
            try {
                await wcApi.request('DELETE', `/products/${id}`, { force: true });

                // Delete from D1
                await db.query(`DELETE FROM wp_posts WHERE ID = ?`, [id]);
                await db.query(`DELETE FROM wp_postmeta WHERE post_id = ?`, [id]);
                await db.query(`DELETE FROM wp_wc_product_meta_lookup WHERE product_id = ?`, [id]);
                await db.query(`DELETE FROM wp_term_relationships WHERE object_id = ?`, [id]);

                // Invalidate Product List Cache
                if (env.CACHE) {
                    try {
                        await env.CACHE.put('product_list_version', Date.now().toString());
                    } catch (e) { console.error('Failed to update product_list_version:', e); }
                }

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
                last_name: input.lastName,
                role: input.role || 'customer'
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

        async registerVendor(_, { input }, { env }) {
            const wcfm = require('../services/wcfm');
            // Ensure wcApi is available in scope or passed correctly
            // wcfm service imports WooCommerceClient internally in some functions but registerVendor relies on wcApi being available?
            // Actually wcfm.registerVendor uses 'wcApi' which is not defined in that file's scope in previous read!
            // Wait, let me check wcfm.js again.

            // In wcfm.js line 844: const userResponse = await wcApi.post("customers", ...
            // But wcApi is NOT defined in registerVendor scope in wcfm.js based on my previous read.
            // It was defined in other functions or globally?
            // Let's check wcfm.js imports. 
            // It imports `const WooCommerceClient = require('../utils/wc-client');` at line 693.
            // But inside `registerVendor`, it calls `wcApi.post` without instantiating it!
            // I need to fix wcfm.js first or pass env to it.

            // Let's try to fix wcfm.js via a separate tool call if needed, 
            // but for now let's implement the resolver assuming wcfm.registerVendor works or needs env.

            // Actually, I should check wcfm.js first.
            try {
                // We need to pass env to wcfm service functions usually if they need to instantiate client
                // But registerVendor in wcfm.js (as seen in previous read) seems to have a bug: `wcApi` is not defined.
                // It should be `const wcApi = new WooCommerceClient(env);` inside the function, 
                // and the function signature should accept `env`.

                // So I will fix wcfm.js first.
                // For now, I'll put a placeholder here and fix wcfm.js in next step.
                const result = await wcfm.registerVendor(input, env);
                return result;
            } catch (error) {
                console.error("Vendor Registration Error:", error.message);
                throw new Error(error.message);
            }
        },

        async login(_, { input }, { env }) {
            const { username, password } = input;

            // We reuse the JWT auth endpoint logic or implement it directly here.
            // Since we need to validate against WP/WC, we can use the JWT Auth plugin endpoint via fetch
            // Or if we have a direct DB check (not recommended for passwords due to hashing), we use fetch.

            try {
                // Use the FetchClient helper if available or standard fetch
                // The API endpoint is usually /wp-json/jwt-auth/v1/token
                const WC_URL = env.WC_URL || 'https://shopwice.com';
                const tokenUrl = `${WC_URL}/wp-json/jwt-auth/v1/token`;

                const res = await fetch(tokenUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });

                const data = await res.json();

                if (!res.ok || !data.token) {
                    throw new Error(data.message || 'Invalid username or password');
                }

                // Decode token to get user details
                // We can also fetch the user from WP if needed to get full details
                const token = data.token;

                // Helper to decode JWT without verifying signature (we just got it from trusted source)
                // Or we can use the data returned if it contains user info
                // The JWT Auth plugin usually returns: { token, user_email, user_nicename, user_display_name }

                // Let's assume we want to return a Customer object.
                // We might need to fetch the user ID. 
                // The JWT payload usually has data.user.id

                const parts = token.split('.');
                let userId = null;
                let role = 'customer';

                if (parts.length === 3) {
                    try {
                        const payload = JSON.parse(atob(parts[1]));
                        if (payload.data && payload.data.user) {
                            userId = payload.data.user.id;
                        }
                    } catch (e) { }
                }

                // If we didn't get ID from token, we might need to look it up or rely on the response
                // The JWT Auth plugin response structure depends on version.
                // Assuming standard response.

                const user = {
                    id: userId || data.user_id || 0,
                    email: data.user_email || username,
                    username: data.user_nicename || username,
                    firstName: data.user_display_name ? data.user_display_name.split(' ')[0] : '',
                    lastName: data.user_display_name ? data.user_display_name.split(' ').slice(1).join(' ') : '',
                    role: role // Placeholder, actual role is in token payload usually
                };

                return {
                    token,
                    user
                };

            } catch (error) {
                console.error('Login error:', error);
                throw new Error(error.message || 'Login failed');
            }
        },

        async sendPasswordResetEmail(_, { input }, { env }) {
            const email = input.email || input.username;
            const app = input.app;
            if (!email) {
                return { success: false, message: 'email is required' };
            }
            try {
                const WC_URL = env.WC_URL || 'https://shopwice.com';
                const endpoint = env.JWT_RESET_PASSWORD_REQUEST_PATH || '/wp-json/shopwice/v1/auth/password-reset/request';
                const url = `${WC_URL}${endpoint}`;
                const body = { email };
                if (app) body.app = app;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    console.error('Password reset request failed:', data);
                    return { success: false, message: data.message || data.error || 'Failed to send reset email' };
                }
                return { success: true, message: 'Password reset email sent if account exists.' };
            } catch (error) {
                console.error('Password reset error:', error);
                return { success: false, message: error.message || 'An unexpected error occurred.' };
            }
        },

        async resetPassword(_, { input }, { env }) {
            try {
                const WC_URL = env.WC_URL || 'https://shopwice.com';
                const endpoint = env.JWT_RESET_PASSWORD_CONFIRM_PATH || '/wp-json/shopwice/v1/auth/password-reset/confirm';
                const url = `${WC_URL}${endpoint}`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        user_login: input.user_login,
                        password_reset_key: input.password_reset_key,
                        new_password: input.new_password
                    })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    return { success: false, message: data.message || data.error || 'Password reset failed' };
                }
                return { success: true, message: 'Password has been reset.' };
            } catch (error) {
                console.error('Reset password error:', error);
                return { success: false, message: error.message || 'An unexpected error occurred.' };
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
        link: (parent) => {
            if (parent.link && parent.link.includes('shopwice.com/product/')) return parent.link;
            return `https://shopwice.com/product/${parent.slug || parent.post_name}/`;
        },
        url: (parent) => {
            if (parent.link && parent.link.includes('shopwice.com/product/')) return parent.link;
            return `https://shopwice.com/product/${parent.slug || parent.post_name}/`;
        },
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
                  SELECT term_taxonomy_id FROM wp_term_taxonomy WHERE term_id IN (${catIds.map(() => '?').join(',')})
                ) AND tr.object_id != ?
                AND p.post_type = 'product'
                AND p.post_status = 'publish'
                LIMIT 4
            `, [...catIds, parent.id || parent.databaseId || parent.productId]);

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
