// src/graphql/dataloaders.js
const db = require('../config/db');
const DataLoader = require('dataloader');

function createLoaders() {
    const skuLoader = new DataLoader(async (productIds) => {
        const [rows] = await db.query(
            `SELECT post_id, meta_value FROM wp_postmeta WHERE meta_key = '_sku' AND post_id IN (?)`,
            [productIds]
        );
        const map = {};
        rows.forEach(r => { map[r.post_id] = r.meta_value; });
        return productIds.map(id => map[id] || null);
    });

    const imageLoader = new DataLoader(async (productIds) => {
        const [rows] = await db.query(
            `SELECT post_id, meta_value FROM wp_postmeta WHERE meta_key = '_thumbnail_id' AND post_id IN (?)`,
            [productIds]
        );
        const map = {};
        rows.forEach(r => { map[r.post_id] = r.meta_value; });
        return productIds.map(id => map[id] || null);
    });

    const galleryLoader = new DataLoader(async (productIds) => {
        const [rows] = await db.query(
            `SELECT post_id, meta_value FROM wp_postmeta WHERE meta_key = '_product_image_gallery' AND post_id IN (?)`,
            [productIds]
        );
        const map = {};
        rows.forEach(r => { map[r.post_id] = r.meta_value; });
        return productIds.map(id => map[id] || null);
    });

    const taxonomyLoader = new DataLoader(async (productIds) => {
        const [rows] = await db.query(`
            SELECT tr.object_id, t.term_id as id, t.name, t.slug, tt.taxonomy
            FROM wp_term_relationships tr
            JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
            JOIN wp_terms t ON tt.term_id = t.term_id
            WHERE tr.object_id IN (?)
        `, [productIds]);

        const map = {};
        rows.forEach(r => {
            if (!map[r.object_id]) map[r.object_id] = [];
            map[r.object_id].push({ id: r.id, name: r.name, slug: r.slug, taxonomy: r.taxonomy });
        });
        return productIds.map(id => map[id] || []);
    });

    const metaLoader = new DataLoader(async (productIds) => {
        const [rows] = await db.query(
            `SELECT post_id, meta_key, meta_value FROM wp_postmeta WHERE post_id IN (?) AND meta_key IN ('_product_attributes', '_short_description', '_price', '_regular_price', '_sale_price', 'total_sales', '_stock', '_stock_status', '_manage_stock', '_type', '_average_rating', '_rating_count', '_upsell_ids', '_crosssell_ids')`,
            [productIds]
        );
        const map = {};
        rows.forEach(r => {
            if (!map[r.post_id]) map[r.post_id] = {};
            map[r.post_id][r.meta_key] = r.meta_value;
        });
        return productIds.map(id => map[id] || {});
    });

    const excerptLoader = new DataLoader(async (productIds) => {
        const [rows] = await db.query(
            `SELECT ID, post_excerpt FROM wp_posts WHERE ID IN (?)`,
            [productIds]
        );
        const map = {};
        rows.forEach(r => { map[r.ID] = r.post_excerpt; });
        return productIds.map(id => map[id] || '');
    });

    const productSummaryLoader = new DataLoader(async (ids) => {
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
            WHERE p.ID IN (?) AND p.post_type IN ('product', 'product_variation')
        `, [ids]);

        const imgMap = {};
        const imgIds = pRows.map(r => r.imageId).filter(Boolean);
        if (imgIds.length) {
            const [imgRows] = await db.query(`SELECT ID, guid FROM wp_posts WHERE ID IN (?)`, [imgIds]);
            imgRows.forEach(i => { imgMap[i.ID] = i.guid; });
        }

        const productMap = {};
        pRows.forEach(p => {
            const featuredImage = p.imageId && imgMap[p.imageId]
                ? { src: imgMap[p.imageId], sourceUrl: imgMap[p.imageId] }
                : null;

            productMap[p.id] = {
                id: p.id,
                databaseId: p.id,
                name: p.name,
                slug: p.slug,
                price: p.price ? p.price.toString() : "0",
                regularPrice: p.regularPrice ? p.regularPrice.toString() : "0",
                image: featuredImage,
                featuredImage: featuredImage,
                images: featuredImage ? [featuredImage] : [],
                galleryImages: { nodes: featuredImage ? [featuredImage] : [] }
            };
        });
        return ids.map(id => productMap[id] || null);
    });

    const imageDetailsLoader = new DataLoader(async (imageIds) => {
        if (!imageIds.length) return [];
        const [rows] = await db.query(
            `SELECT ID, guid, post_title, post_excerpt FROM wp_posts WHERE ID IN (?)`,
            [imageIds]
        );
        const map = {};
        rows.forEach(r => {
            map[r.ID] = {
                id: r.ID,
                src: r.guid,
                sourceUrl: r.guid,
                title: r.post_title,
                altText: r.post_excerpt || r.post_title
            };
        });
        return imageIds.map(id => map[id] || null);
    });

    const variationAttributeLoader = new DataLoader(async (variationIds) => {
        const [rows] = await db.query(
            `SELECT post_id, meta_key, meta_value FROM wp_postmeta WHERE post_id IN (?) AND meta_key LIKE 'attribute_%'`,
            [variationIds]
        );
        const map = {};
        rows.forEach(r => {
            if (!map[r.post_id]) map[r.post_id] = {};
            map[r.post_id][r.meta_key] = r.meta_value;
        });
        return variationIds.map(id => map[id] || {});
    });

    return { skuLoader, imageLoader, galleryLoader, taxonomyLoader, metaLoader, excerptLoader, productSummaryLoader, imageDetailsLoader, variationAttributeLoader };
}

module.exports = { createLoaders };
