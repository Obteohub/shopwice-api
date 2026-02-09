// src/services/wcfm.js
const db = require('../config/db');
const PHPUnserializer = require('php-serialize');

/**
 * Parse PHP serialized data
 */
function parseSerializedData(str) {
    if (!str) return {};
    try {
        // Try PHP Unserialize first
        return PHPUnserializer.unserialize(str);
    } catch (e) {
        try {
            // Fallback to JSON
            return JSON.parse(str);
        } catch (e2) {
            return {};
        }
    }
}

/**
 * Update vendor profile settings
 * @param {string|number} vendorId - Vendor User ID
 * @param {Object} data - Profile data to update
 * @returns {Promise<Object>} Updated profile
 */
async function updateVendorProfile(vendorId, data) {
    try {
        // 1. Update Basic Fields
        const updates = [];
        const params = [];

        if (data.description !== undefined) {
            await db.query(`INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES (?, 'wcfmmp_store_description', ?) ON CONFLICT(user_id, meta_key) DO UPDATE SET meta_value = ?`, [vendorId, data.description, data.description]);
        }

        if (data.phone !== undefined) {
            await db.query(`INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES (?, 'wcfmmp_store_phone', ?) ON CONFLICT(user_id, meta_key) DO UPDATE SET meta_value = ?`, [vendorId, data.phone, data.phone]);
        }

        // 2. Update Profile Settings (Store Name)
        if (data.shop_name) {
            const [rows] = await db.query("SELECT meta_value FROM wp_usermeta WHERE user_id = ? AND meta_key = 'wcfmmp_profile_settings'", [vendorId]);
            let settings = {};
            if (rows.length && rows[0].meta_value) {
                settings = parseSerializedData(rows[0].meta_value);
            }
            // Ensure object
            if (typeof settings !== 'object') settings = {};

            settings.store_name = data.shop_name;
            const serialized = PHPUnserializer.serialize(settings);

            await db.query(`INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES (?, 'wcfmmp_profile_settings', ?) ON CONFLICT(user_id, meta_key) DO UPDATE SET meta_value = ?`, [vendorId, serialized, serialized]);

            // Also update Display Name
            await db.query("UPDATE wp_users SET display_name = ? WHERE ID = ?", [data.shop_name, vendorId]);
        }

        // 3. Update Address (Serialized)
        if (data.address) {
            const [rows] = await db.query("SELECT meta_value FROM wp_usermeta WHERE user_id = ? AND meta_key = 'wcfmmp_store_location'", [vendorId]);
            let address = {};
            if (rows.length && rows[0].meta_value) {
                address = parseSerializedData(rows[0].meta_value);
            }
            if (typeof address !== 'object') address = {};

            // Merge
            Object.assign(address, data.address); // Expects { street_1, city, zip, country, state }

            const serialized = PHPUnserializer.serialize(address);
            await db.query(`INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES (?, 'wcfmmp_store_location', ?) ON CONFLICT(user_id, meta_key) DO UPDATE SET meta_value = ?`, [vendorId, serialized, serialized]);
        }

        // 4. Update Social (Serialized)
        if (data.social) {
            const [rows] = await db.query("SELECT meta_value FROM wp_usermeta WHERE user_id = ? AND meta_key = 'wcfmmp_social_profiles'", [vendorId]);
            let social = {};
            if (rows.length && rows[0].meta_value) {
                social = parseSerializedData(rows[0].meta_value);
            }
            if (typeof social !== 'object') social = {};

            Object.assign(social, data.social);

            const serialized = PHPUnserializer.serialize(social);
            await db.query(`INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES (?, 'wcfmmp_social_profiles', ?) ON CONFLICT(user_id, meta_key) DO UPDATE SET meta_value = ?`, [vendorId, serialized, serialized]);
        }

        // 5. Update Logo & Banner
        if (data.store_logo !== undefined) {
            await db.query(`INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES (?, 'wcfmmp_store_logo', ?) ON CONFLICT(user_id, meta_key) DO UPDATE SET meta_value = ?`, [vendorId, data.store_logo, data.store_logo]);
        }
        if (data.store_banner !== undefined) {
            await db.query(`INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES (?, 'wcfmmp_store_banner', ?) ON CONFLICT(user_id, meta_key) DO UPDATE SET meta_value = ?`, [vendorId, data.store_banner, data.store_banner]);
        }

        return getVendor(vendorId);
    } catch (error) {
        console.error("Update Vendor Profile Error:", error.message);
        throw error;
    }
}


/**
 * Get all vendors from database
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} Vendors data
 */
async function getVendors(params = {}) {
    try {
        const page = params.page || 1;
        const perPage = params.perPage || 10;
        const search = params.search || '';
        const status = params.status || 'approved';

        const offset = (page - 1) * perPage;

        let whereClauses = [];
        let queryParams = [];

        // Filter by vendor role
        whereClauses.push(`
            EXISTS (
                SELECT 1 FROM wp_usermeta um_role 
                WHERE um_role.user_id = u.ID 
                AND um_role.meta_key = 'wp_capabilities'
                AND (
                    um_role.meta_value LIKE '%wcfm_vendor%' 
                    OR um_role.meta_value LIKE '%seller%'
                    OR um_role.meta_value LIKE '%vendor%'
                )
            )
        `);

        if (search) {
            whereClauses.push(`(
                u.user_login LIKE ? 
                OR u.user_email LIKE ? 
                OR u.display_name LIKE ?
                OR um_shop_slug.meta_value LIKE ?
            )`);
            queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (status === 'approved') {
            whereClauses.push(`(um_enabled.meta_value = 'yes' OR um_enabled.meta_value IS NULL)`);
        } else if (status === 'pending') {
            whereClauses.push(`um_enabled.meta_value = 'no'`);
        }

        // Count query
        const countSql = `
            SELECT COUNT(DISTINCT u.ID) as total
            FROM wp_users u
            LEFT JOIN wp_usermeta um_shop_slug ON u.ID = um_shop_slug.user_id AND um_shop_slug.meta_key = 'store_slug'
            LEFT JOIN wp_usermeta um_enabled ON u.ID = um_enabled.user_id AND um_enabled.meta_key = 'wcfm_enable_status'
            WHERE ${whereClauses.join(' AND ')}
        `;
        const [countRows] = await db.query(countSql, queryParams);
        const total = countRows[0].total;

        // Main query
        const sql = `
            SELECT 
                u.ID as id,
                u.user_login as user_nicename,
                u.user_email as user_email,
                u.display_name as display_name,
                u.user_registered as registered,
                um_shop_slug.meta_value as store_slug,
                um_shop_name.meta_value as store_name,
                um_logo.meta_value as store_logo,
                um_enabled.meta_value as is_enabled
            FROM wp_users u
            LEFT JOIN wp_usermeta um_shop_slug ON u.ID = um_shop_slug.user_id AND um_shop_slug.meta_key = 'store_slug'
            LEFT JOIN wp_usermeta um_shop_name ON u.ID = um_shop_name.user_id AND um_shop_name.meta_key = 'wcfmmp_profile_settings'
            LEFT JOIN wp_usermeta um_logo ON u.ID = um_logo.user_id AND um_logo.meta_key = 'wcfmmp_store_logo'
            LEFT JOIN wp_usermeta um_enabled ON u.ID = um_enabled.user_id AND um_enabled.meta_key = 'wcfm_enable_status'
            WHERE ${whereClauses.join(' AND ')}
            ORDER BY u.user_registered DESC
            LIMIT ? OFFSET ?
        `;

        queryParams.push(perPage, offset);
        const [rows] = await db.query(sql, queryParams);

        // Parse store names from serialized data
        const vendors = rows.map(v => {
            let storeName = v.display_name;
            if (v.store_name) {
                const parsed = parseSerializedData(v.store_name);
                storeName = parsed.store_name || v.display_name;
            }

            return {
                id: v.id,
                ID: v.id,
                user_nicename: v.user_nicename,
                user_email: v.user_email,
                display_name: v.display_name,
                store_slug: v.store_slug || v.user_nicename,
                store_name: storeName,
                store_logo: v.store_logo,
                gravatar: v.store_logo,
                registered: v.registered,
                member_since: v.registered,
                status: (v.is_enabled === 'yes' || v.is_enabled === null) ? 'approved' : 'pending',
                is_store_offline: v.is_enabled === 'no'
            };
        });

        return {
            vendors,
            total,
            totalPages: Math.ceil(total / perPage)
        };
    } catch (error) {
        console.error('WCFM Get Vendors Error:', error.message);
        throw error;
    }
}

/**
 * Get single vendor by ID from database
 * @param {string|number} vendorId - Vendor user ID
 * @returns {Promise<Object>} Vendor data
 */
async function getVendor(vendorId) {
    try {
        const sql = `
            SELECT 
                u.ID as id,
                u.user_login as user_nicename,
                u.user_email as user_email,
                u.display_name as display_name,
                u.user_registered as registered,
                um_shop_slug.meta_value as store_slug,
                um_shop_name.meta_value as store_name,
                um_shop_desc.meta_value as store_description,
                um_phone.meta_value as store_phone,
                um_address.meta_value as address,
                um_logo.meta_value as store_logo,
                um_banner.meta_value as store_banner,
                um_social.meta_value as social,
                um_enabled.meta_value as is_enabled
            FROM wp_users u
            LEFT JOIN wp_usermeta um_shop_slug ON u.ID = um_shop_slug.user_id AND um_shop_slug.meta_key = 'store_slug'
            LEFT JOIN wp_usermeta um_shop_name ON u.ID = um_shop_name.user_id AND um_shop_name.meta_key = 'wcfmmp_profile_settings'
            LEFT JOIN wp_usermeta um_shop_desc ON u.ID = um_shop_desc.user_id AND um_shop_desc.meta_key = 'wcfmmp_store_description'
            LEFT JOIN wp_usermeta um_phone ON u.ID = um_phone.user_id AND um_phone.meta_key = 'wcfmmp_store_phone'
            LEFT JOIN wp_usermeta um_address ON u.ID = um_address.user_id AND um_address.meta_key = 'wcfmmp_store_location'
            LEFT JOIN wp_usermeta um_logo ON u.ID = um_logo.user_id AND um_logo.meta_key = 'wcfmmp_store_logo'
            LEFT JOIN wp_usermeta um_banner ON u.ID = um_banner.user_id AND um_banner.meta_key = 'wcfmmp_store_banner'
            LEFT JOIN wp_usermeta um_social ON u.ID = um_social.user_id AND um_social.meta_key = 'wcfmmp_social_profiles'
            LEFT JOIN wp_usermeta um_enabled ON u.ID = um_enabled.user_id AND um_enabled.meta_key = 'wcfm_enable_status'
            WHERE u.ID = ?
            AND EXISTS (
                SELECT 1 FROM wp_usermeta um_role 
                WHERE um_role.user_id = u.ID 
                AND um_role.meta_key = 'wp_capabilities'
                AND (
                    um_role.meta_value LIKE '%wcfm_vendor%' 
                    OR um_role.meta_value LIKE '%seller%'
                    OR um_role.meta_value LIKE '%vendor%'
                )
            )
            LIMIT 1
        `;

        const [rows] = await db.query(sql, [vendorId]);

        if (!rows.length) {
            console.log(`Vendor ${vendorId} not found or missing capability`);
            return null;
        }

        const v = rows[0];
        // console.log('Raw vendor data:', JSON.stringify(v));

        // Parse serialized data
        let storeName = v.display_name;
        let addressData = {};
        let socialData = {};

        if (v.store_name) {
            const parsed = parseSerializedData(v.store_name);
            storeName = parsed.store_name || v.display_name;
        }

        if (v.address) {
            addressData = parseSerializedData(v.address);
        }

        if (v.social) {
            socialData = parseSerializedData(v.social);
        }

        return {
            id: v.id,
            ID: v.id,
            user_nicename: v.user_nicename,
            user_email: v.user_email,
            store_email: v.user_email,
            display_name: v.display_name,
            store_slug: v.store_slug || v.user_nicename,
            store_name: storeName,
            shop_name: storeName,
            store_description: v.store_description,
            shop_description: v.store_description,
            phone: v.store_phone,
            store_phone: v.store_phone,
            address: addressData,
            geolocation: {
                latitude: addressData.latitude || null,
                longitude: addressData.longitude || null
            },
            store_logo: v.store_logo,
            gravatar: v.store_logo,
            banner: v.store_banner,
            store_banner: v.store_banner,
            social: socialData,
            registered: v.registered,
            member_since: v.registered,
            status: (v.is_enabled === 'yes' || v.is_enabled === null) ? 'approved' : 'pending',
            is_store_offline: v.is_enabled === 'no'
        };
    } catch (error) {
        console.error('WCFM Get Vendor Error:', error.message);
        throw error;
    }
}

/**
 * Get vendor products from database
 * @param {string|number} vendorId - Vendor user ID
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} Products data
 */
async function getVendorProducts(vendorId, params = {}) {
    try {
        const page = params.page || 1;
        const perPage = params.perPage || 10;
        const offset = (page - 1) * perPage;

        // Count query
        const countSql = `
            SELECT COUNT(DISTINCT p.ID) as total
            FROM wp_posts p
            INNER JOIN wp_postmeta pm ON p.ID = pm.post_id
            WHERE p.post_type = 'product'
            AND p.post_status = 'publish'
            AND pm.meta_key = '_wcfm_product_author'
            AND pm.meta_value = ?
        `;
        const [countRows] = await db.query(countSql, [vendorId]);
        const total = countRows[0].total;

        // Main query
        const sql = `
            SELECT
                p.ID as id,
                p.post_title as name,
                p.post_name as slug,
                lookup.min_price as price,
                lookup.max_price as regular_price,
                (SELECT meta_value FROM wp_postmeta WHERE post_id = p.ID AND meta_key = '_thumbnail_id' LIMIT 1) as imageId
            FROM wp_posts p
            INNER JOIN wp_postmeta pm ON p.ID = pm.post_id
            LEFT JOIN wp_wc_product_meta_lookup lookup ON p.ID = lookup.product_id
            WHERE p.post_type = 'product'
            AND p.post_status = 'publish'
            AND pm.meta_key = '_wcfm_product_author'
            AND pm.meta_value = ?
            ORDER BY p.post_date DESC
            LIMIT ? OFFSET ?
        `;

        const [rows] = await db.query(sql, [vendorId, perPage, offset]);

        // Resolve images
        const imageIds = rows.map(r => r.imageId).filter(Boolean);
        const imageMap = {};
        if (imageIds.length) {
            const [imgRows] = await db.query(`SELECT ID, guid FROM wp_posts WHERE ID IN (?)`, [imageIds]);
            imgRows.forEach(i => { imageMap[i.ID] = i.guid; });
        }

        const products = rows.map(p => ({
            id: p.id,
            name: p.name,
            slug: p.slug,
            price: p.price,
            regular_price: p.regular_price,
            images: p.imageId && imageMap[p.imageId] ? [{ src: imageMap[p.imageId] }] : []
        }));

        return {
            products,
            total,
            totalPages: Math.ceil(total / perPage)
        };
    } catch (error) {
        console.error('WCFM Get Vendor Products Error:', error.message);
        throw error;
    }
}

/**
 * Get vendor by store slug from database
 * @param {string} slug - Store slug
 * @returns {Promise<Object>} Vendor data
 */
async function getVendorBySlug(slug) {
    try {
        const sql = `
            SELECT u.ID
            FROM wp_users u
            LEFT JOIN wp_usermeta um ON u.ID = um.user_id AND um.meta_key = 'store_slug'
            WHERE um.meta_value = ? OR u.user_login = ?
            LIMIT 1
        `;

        const [rows] = await db.query(sql, [slug, slug]);
        if (!rows.length) return null;

        return getVendor(rows[0].ID);
    } catch (error) {
        console.error('WCFM Get Vendor By Slug Error:', error.message);
        throw error;
    }
}


/**
 * Get vendor statistics from database
 * @param {string|number} vendorId - Vendor user ID
 * @param {Object} params - Query parameters (start_date, end_date)
 * @returns {Promise<Object>} Vendor statistics
 */
async function getVendorStats(vendorId, params = {}) {
    try {
        // 1. Product Count (Global)
        const [productCount] = await db.query(`
            SELECT COUNT(*) as count 
            FROM wp_posts p
            INNER JOIN wp_postmeta pm ON p.ID = pm.post_id
            WHERE p.post_type = 'product' 
            AND p.post_status = 'publish'
            AND pm.meta_key = '_wcfm_product_author'
            AND pm.meta_value = ?
        `, [vendorId]);

        // 2. Sales Stats (Date Range Support)
        let timeFilter = "";
        const queryParams = [vendorId];

        // Only include completed/paid orders for stats usually
        // But WCFM might include pending. Let's stick to commission_status or order_status.
        // Usually we care about commission.

        if (params.start_date) {
            timeFilter += " AND created >= ?";
            queryParams.push(params.start_date);
        }
        if (params.end_date) {
            timeFilter += " AND created <= ?";
            queryParams.push(params.end_date);
        }

        /* 
           wp_wcfm_marketplace_orders columns: 
           total_commission (vendor earning), 
           product_price * quantity (gross sales)
        */

        const sql = `
            SELECT 
                COUNT(DISTINCT order_id) as total_orders,
                SUM(total_commission) as total_earnings,
                SUM(product_price * quantity) as gross_sales,
                SUM(quantity) as items_sold
            FROM wp_wcfm_marketplace_orders
            WHERE vendor_id = ?
            ${timeFilter}
        `;

        const [salesData] = await db.query(sql, queryParams);
        const data = salesData[0];

        return {
            product_count: productCount[0]?.count || 0,
            total_orders: data.total_orders || 0,
            total_sales: data.gross_sales || 0,
            total_earnings: data.total_earnings || 0,
            items_sold: data.items_sold || 0,
            period: {
                start: params.start_date || 'all-time',
                end: params.end_date || 'now'
            }
        };
    } catch (error) {
        console.error('WCFM Get Vendor Stats Error:', error.message);
        return {
            product_count: 0,
            total_sales: 0,
            total_orders: 0,
            total_earnings: 0
        };
    }
}

/**
 * Get vendor orders from database
 * @param {string|number} vendorId - Vendor user ID
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} Orders data
 */
async function getVendorOrders(vendorId, params = {}) {
    try {
        const page = params.page || 1;
        const perPage = params.perPage || 10;
        const offset = (page - 1) * perPage;
        const status = params.status;

        let whereClauses = ["vendor_id = ?"];
        let queryParams = [vendorId];

        if (status) {
            whereClauses.push("commission_status = ?");
            queryParams.push(status);
        }

        // Count query
        const countSql = `
            SELECT COUNT(*) as total
            FROM wp_wcfm_marketplace_orders
            WHERE ${whereClauses.join(' AND ')}
        `;
        const [countRows] = await db.query(countSql, queryParams);
        const total = countRows[0].total;

        // Main query
        // We aggregate by order_id because one order might have multiple products
        const sql = `
            SELECT 
                m.order_id,
                MAX(m.created) as date,
                m.order_status,
                m.commission_status,
                SUM(m.total_commission) as total_commission,
                SUM(m.product_price * m.quantity) as gross_total,
                p.post_date as order_date
            FROM wp_wcfm_marketplace_orders m
            LEFT JOIN wp_posts p ON m.order_id = p.ID
            WHERE ${whereClauses.join(' AND ')}
            GROUP BY m.order_id, m.order_status, m.commission_status, p.post_date
            ORDER BY date DESC
            LIMIT ? OFFSET ?
        `;

        // Need to add pagination params
        const mainQueryParams = [...queryParams, perPage, offset];

        const [rows] = await db.query(sql, mainQueryParams);

        // Fetch items for these orders
        const orders = await Promise.all(rows.map(async (order) => {
            const [items] = await db.query(`
                SELECT 
                    m.product_id, 
                    m.quantity, 
                    m.product_price,
                    p.post_title as name,
                    (SELECT meta_value FROM wp_postmeta WHERE post_id = m.product_id AND meta_key = '_thumbnail_id' LIMIT 1) as imageId
                FROM wp_wcfm_marketplace_orders m
                LEFT JOIN wp_posts p ON m.product_id = p.ID
                WHERE m.order_id = ? AND m.vendor_id = ?
            `, [order.order_id, vendorId]);

            // Resolve images
            const itemsWithImages = await Promise.all(items.map(async (item) => {
                let imageUrl = null;
                if (item.imageId) {
                    const [img] = await db.query('SELECT guid FROM wp_posts WHERE ID = ?', [item.imageId]);
                    if (img.length) imageUrl = img[0].guid;
                }
                return {
                    id: item.product_id,
                    name: item.name,
                    quantity: item.quantity,
                    price: item.product_price,
                    image: imageUrl
                };
            }));

            return {
                id: order.order_id,
                order_number: order.order_id,
                date_created: order.date || order.order_date,
                status: order.order_status,
                commission_status: order.commission_status,
                total: order.gross_total || 0,
                commission: order.total_commission || 0,
                items: itemsWithImages
            };
        }));

        return {
            orders,
            total,
            totalPages: Math.ceil(total / perPage)
        };
    } catch (error) {
        console.error('WCFM Get Vendor Orders Error:', error.message);
        throw error;
    }
}

/**
 * Get single vendor order by ID
 * @param {string|number} vendorId - Vendor User ID
 * @param {string|number} orderId - Order ID
 * @returns {Promise<Object>} Order data
 */
async function getVendorOrder(vendorId, orderId) {
    try {
        const sql = `
            SELECT 
                m.order_id,
                MAX(m.created) as date,
                m.order_status,
                m.commission_status,
                SUM(m.total_commission) as total_commission,
                SUM(m.product_price * m.quantity) as gross_total,
                p.post_date as order_date
            FROM wp_wcfm_marketplace_orders m
            LEFT JOIN wp_posts p ON m.order_id = p.ID
            WHERE m.vendor_id = ? AND m.order_id = ?
            GROUP BY m.order_id, m.order_status, m.commission_status, p.post_date
            LIMIT 1
        `;

        const [rows] = await db.query(sql, [vendorId, orderId]);

        if (!rows.length) return null;

        const order = rows[0];

        // Fetch items for this order
        const [items] = await db.query(`
            SELECT 
                m.product_id, 
                m.quantity, 
                m.product_price,
                p.post_title as name,
                (SELECT meta_value FROM wp_postmeta WHERE post_id = m.product_id AND meta_key = '_thumbnail_id' LIMIT 1) as imageId
            FROM wp_wcfm_marketplace_orders m
            LEFT JOIN wp_posts p ON m.product_id = p.ID
            WHERE m.order_id = ? AND m.vendor_id = ?
        `, [orderId, vendorId]);

        // Resolve images
        const itemsWithImages = await Promise.all(items.map(async (item) => {
            let imageUrl = null;
            if (item.imageId) {
                const [img] = await db.query('SELECT guid FROM wp_posts WHERE ID = ?', [item.imageId]);
                if (img.length) imageUrl = img[0].guid;
            }
            return {
                id: item.product_id,
                name: item.name,
                quantity: item.quantity,
                price: item.product_price,
                image: imageUrl
            };
        }));

        return {
            id: order.order_id,
            order_number: order.order_id,
            date_created: order.date || order.order_date,
            status: order.order_status,
            commission_status: order.commission_status,
            total: order.gross_total || 0,
            commission: order.total_commission || 0,
            items: itemsWithImages
        };
    } catch (error) {
        console.error('WCFM Get Vendor Order Error:', error.message);
        throw error;
    }
}

const WooCommerceClient = require('../utils/wc-client');

/**
 * Create a product for a vendor
 * @param {string|number} vendorId - Vendor User ID
 * @param {Object} productData - Product data (standard WC format)
 * @param {Object} env - Cloudflare environment variables
 * @returns {Promise<Object>} Created product
 */
async function createVendorProduct(vendorId, productData, env) {
    try {
        const wcApi = new WooCommerceClient(env);
        // 1. Create product using WC API (Admin context)
        // Default status to pending if not specified, for safety
        const data = {
            ...productData,
            status: productData.status || 'pending',
            author: parseInt(vendorId)
        };

        const product = await wcApi.post("products", data);

        // 2. Assign to vendor in Database and Force Status if requested
        if (product && product.id) {
            // If status was 'publish', force it in the DB as WC might have defaulted it to 'draft' or 'pending'
            let finalStatus = product.status;
            if (productData.status === 'publish') {
                finalStatus = 'publish';
            }

            await db.query(
                "UPDATE wp_posts SET post_author = ?, post_status = ? WHERE ID = ?",
                [vendorId, finalStatus, product.id]
            );

            // 3. Add WCFM meta
            await db.query(
                "INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_wcfm_product_author', ?) ON DUPLICATE KEY UPDATE meta_value = ?",
                [product.id, vendorId, vendorId]
            );

            // Add default views
            await db.query(
                "INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, '_wcfm_product_views', '0')",
                [product.id]
            );

            // Update local object to reflect DB change
            product.status = finalStatus;
        }

        return product;
    } catch (error) {
        console.error("Create Vendor Product Error:", error.response?.data || error.message);
        throw new Error(error.response?.data?.message || error.message);
    }
}

/**
 * Update a vendor product
 * @param {string|number} vendorId - Vendor User ID (for verification)
 * @param {string|number} productId - Product ID
 * @param {Object} productData - Data to update
 * @param {Object} env - Cloudflare environment variables
 * @returns {Promise<Object>} Updated product
 */
async function updateVendorProduct(vendorId, productId, productData, env) {
    try {
        const wcApi = new WooCommerceClient(env);
        // 1. Verify ownership
        const [rows] = await db.query(
            "SELECT ID FROM wp_posts WHERE ID = ? AND post_author = ?",
            [productId, vendorId]
        );

        if (!rows.length) {
            // Check via meta if post_author check fails
            const [metaRows] = await db.query(
                "SELECT post_id FROM wp_postmeta WHERE post_id = ? AND meta_key = '_wcfm_product_author' AND meta_value = ?",
                [productId, vendorId]
            );
            if (!metaRows.length) {
                throw new Error("Product not found or access denied");
            }
        }

        // 2. Update via WC API
        const product = await wcApi.post(`products/${productId}`, productData); // WC API uses POST for updates sometimes, or PUT
        return product;
    } catch (error) {
        console.error("Update Vendor Product Error:", error.response?.data || error.message);
        throw new Error(error.response?.data?.message || error.message);
    }
}

/**
 * Delete a vendor product
 * @param {string|number} vendorId - Vendor User ID
 * @param {string|number} productId - Product ID
 * @param {Object} env - Cloudflare environment variables
 * @returns {Promise<Object>} Result
 */
async function deleteVendorProduct(vendorId, productId, env) {
    try {
        const wcApi = new WooCommerceClient(env);
        // 1. Verify ownership
        const [rows] = await db.query(
            "SELECT ID FROM wp_posts WHERE ID = ? AND post_author = ?",
            [productId, vendorId]
        );

        if (!rows.length) {
            const [metaRows] = await db.query(
                "SELECT post_id FROM wp_postmeta WHERE post_id = ? AND meta_key = '_wcfm_product_author' AND meta_value = ?",
                [productId, vendorId]
            );
            if (!metaRows.length) {
                throw new Error("Product not found or access denied");
            }
        }

        // 2. Delete via WC API
        const product = await wcApi.delete(`products/${productId}`, { force: true });
        return product;
    } catch (error) {
        console.error("Delete Vendor Product Error:", error.response?.data || error.message);
        throw new Error(error.response?.data?.message || error.message);
    }
}


/**
 * Register a new Vendor
 * @param {Object} data - Vendor registration data
 * @returns {Promise<Object>} Created vendor
 */
async function registerVendor(data) {
    try {
        const {
            email,
            password,
            username,
            first_name,
            last_name,
            shop_name,
            phone,
            address
        } = data;

        // 1. Create User via WooCommerce API (Handles hashing & validation)
        // We create as 'customer' first to leverage WC's registration logic/hooks
        const userResponse = await wcApi.post("customers", {
            email,
            password,
            username: username || email.split('@')[0],
            first_name,
            last_name,
            billing: {
                first_name,
                last_name,
                email,
                phone: phone
            }
        });

        const user = userResponse.data;
        const userId = user.id;

        // 2. Update Role to 'wcfm_vendor'
        // WCFM Vendor capability: a:1:{s:11:"wcfm_vendor";b:1;}
        const capabilities = PHPUnserializer.serialize({ wcfm_vendor: true });
        await db.query("UPDATE wp_usermeta SET meta_value = ? WHERE user_id = ? AND meta_key = 'wp_capabilities'", [capabilities, userId]);

        // 3. Set WCFM Specific Meta
        const storeSlug = shop_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

        // Profile Settings
        const settings = {
            store_name: shop_name,
            store_email: email,
            phone: phone,
            address: address || {},
            store_slug: storeSlug
        };
        const serializedSettings = PHPUnserializer.serialize(settings);

        const metas = [
            // Store Name & Settings
            ['wcfmmp_profile_settings', serializedSettings],
            ['store_name', shop_name],
            ['wcfmmp_store_name', shop_name],
            ['store_slug', storeSlug],
            // Enable Status (yes = auto approve, pending = manual)
            ['wcfm_enable_status', 'yes'], // Setting to 'yes' for now.
            // Store Phone
            ['wcfmmp_store_phone', phone || '']
        ];

        // Batch insert meta
        for (const [key, value] of metas) {
            await db.query("INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES (?, ?, ?)", [userId, key, value]);
        }

        // 4. Update Display Name to Store Name (Optional but good for WCFM)
        await db.query("UPDATE wp_users SET display_name = ? WHERE ID = ?", [shop_name, userId]);

        return getVendor(userId);

    } catch (error) {
        console.error("Register Vendor Error:", error.response?.data || error.message);
        throw new Error(error.response?.data?.message || error.message);
    }
}

module.exports = {
    getVendors,
    getVendor,
    getVendorProducts,
    getVendorBySlug,
    getVendorStats,
    getVendorOrders,
    getVendorOrder,
    createVendorProduct,
    updateVendorProduct,
    deleteVendorProduct,
    updateVendorProfile,
    registerVendor
};
