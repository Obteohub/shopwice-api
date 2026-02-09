const db = require('../config/db');

/**
 * Sync Service
 * Handles synchronization between WooCommerce Webhooks and D1 Database
 */

const SyncService = {
    /**
     * Sync a Product from WooCommerce JSON to D1
     * @param {Object} product - The product JSON object from WooCommerce
     */
    async syncProduct(product) {
        console.log(`🔄 Syncing Product ID: ${product.id}`);

        try {
            // 1. Update/Insert into wp_posts
            await this.upsertPost(product);

            // 2. Update/Insert Meta (Price, SKU, etc.)
            await this.upsertProductMeta(product);

            // 3. Update Categories (Terms)
            if (product.categories) {
                await this.syncTerms(product.id, product.categories, 'product_cat');
            }
            
            // 4. Update Tags
            if (product.tags) {
                await this.syncTerms(product.id, product.tags, 'product_tag');
            }

            // 5. Sync Images (Attachments)
            if (product.images && product.images.length > 0) {
                await this.syncImages(product.images, product.id);
            }

            // 6. Update Lookup Table (Critical for filtering)
            await this.updateLookupTable(product);

            console.log(`✅ Product ${product.id} synced successfully`);
            return true;
        } catch (error) {
            console.error(`❌ Failed to sync product ${product.id}:`, error);
            throw error;
        }
    },

    async upsertPost(p) {
        const sql = `
            INSERT INTO wp_posts (
                ID, post_author, post_date, post_date_gmt, post_content, post_title, 
                post_excerpt, post_status, comment_status, ping_status, post_name, 
                post_modified, post_modified_gmt, post_parent, guid, post_type, menu_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'product', ?)
            ON CONFLICT(ID) DO UPDATE SET
                post_title = excluded.post_title,
                post_content = excluded.post_content,
                post_excerpt = excluded.post_excerpt,
                post_status = excluded.post_status,
                post_name = excluded.post_name,
                post_modified = excluded.post_modified,
                post_modified_gmt = excluded.post_modified_gmt,
                post_parent = excluded.post_parent,
                menu_order = excluded.menu_order
        `;

        const values = [
            p.id,
            1, // Default author (admin)
            p.date_created || new Date().toISOString(),
            p.date_created_gmt || new Date().toISOString(),
            p.description || '',
            p.name || '',
            p.short_description || '',
            p.status || 'publish',
            'open', // comment_status
            'closed', // ping_status
            p.slug || '',
            p.date_modified || new Date().toISOString(),
            p.date_modified_gmt || new Date().toISOString(),
            p.parent_id || 0,
            p.permalink || '',
            p.menu_order || 0
        ];

        await db.query(sql, values);
    },

    async upsertProductMeta(p) {
        const meta = {
            '_sku': p.sku,
            '_regular_price': p.regular_price,
            '_sale_price': p.sale_price,
            '_price': p.price,
            '_stock': p.stock_quantity,
            '_stock_status': p.stock_status,
            '_manage_stock': p.manage_stock ? 'yes' : 'no',
            '_virtual': p.virtual ? 'yes' : 'no',
            '_downloadable': p.downloadable ? 'yes' : 'no',
            '_weight': p.weight,
            '_length': p.dimensions?.length,
            '_width': p.dimensions?.width,
            '_height': p.dimensions?.height,
            '_thumbnail_id': p.images?.[0]?.id
        };

        for (const [key, value] of Object.entries(meta)) {
            if (value === undefined || value === null) continue;
            
            // Delete existing meta for this key (ensure single value in replica)
            await db.query("DELETE FROM wp_postmeta WHERE post_id = ? AND meta_key = ?", [p.id, key]);
            
            // Insert new value
            await db.query("INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)", [p.id, key, String(value)]);
        }
    },

    async syncTerms(objectId, terms, taxonomy) {
        // Clear existing relationships for this taxonomy
        // Note: This is a simplification. Ideally we check diffs.
        // But for D1, deleting and re-inserting is okay for consistency.
        // However, we need to be careful not to delete ALL relationships, just for this taxonomy.
        // Since SQL doesn't support JOIN in DELETE easily in SQLite (sometimes), 
        // we might need to find the term_taxonomy_ids first.
        
        // 1. Get term_taxonomy_ids for this object and taxonomy
        const findSql = `
            SELECT tr.term_taxonomy_id 
            FROM wp_term_relationships tr
            JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
            WHERE tr.object_id = ? AND tt.taxonomy = ?
        `;
        const [rows] = await db.query(findSql, [objectId, taxonomy]);
        const idsToDelete = rows.map(r => r.term_taxonomy_id);

        if (idsToDelete.length > 0) {
            const placeholders = idsToDelete.map(() => '?').join(',');
            await db.query(`DELETE FROM wp_term_relationships WHERE object_id = ? AND term_taxonomy_id IN (${placeholders})`, [objectId, ...idsToDelete]);
        }

        // 2. Insert new terms
        for (const term of terms) {
            // Ensure term exists in wp_terms
            // We might not have the term ID from WP if it's new, but usually webhook sends ID.
            // If the term doesn't exist in our D1, we should probably create it.
            // For now, let's assume terms are synced or we just use the ID provided.
            
            // Check if term exists
            let [termRows] = await db.query("SELECT term_id FROM wp_terms WHERE term_id = ?", [term.id]);
            if (termRows.length === 0) {
                 await db.query("INSERT INTO wp_terms (term_id, name, slug) VALUES (?, ?, ?)", [term.id, term.name, term.slug]);
            }

            // Check if taxonomy exists
            let [taxRows] = await db.query("SELECT term_taxonomy_id FROM wp_term_taxonomy WHERE term_id = ? AND taxonomy = ?", [term.id, taxonomy]);
            let termTaxonomyId;
            
            if (taxRows.length === 0) {
                // Create taxonomy entry
                // Note: term_taxonomy_id is usually same as term_id in WP for standard cats, but not always.
                // We'll let SQLite auto-increment or try to use term_id if possible? 
                // No, we should rely on the auto-increment or try to fetch from upstream if we really cared.
                // For this MVP, we insert.
                // WAIT: If we auto-increment, it won't match WP ID. 
                // Ideally, we need the term_taxonomy_id from WP. 
                // The Product Webhook usually provides `categories: [{id, name, slug}]`. It doesn't always give `term_taxonomy_id`.
                // In 99% of cases, term_id == term_taxonomy_id for categories.
                
                await db.query("INSERT INTO wp_term_taxonomy (term_id, taxonomy, description) VALUES (?, ?, '')", [term.id, taxonomy]);
                const [newRow] = await db.query("SELECT last_insert_rowid() as id");
                termTaxonomyId = newRow[0].id;
            } else {
                termTaxonomyId = taxRows[0].term_taxonomy_id;
            }

            // Link Object
            await db.query(`
                INSERT INTO wp_term_relationships (object_id, term_taxonomy_id)
                VALUES (?, ?)
                ON CONFLICT(object_id, term_taxonomy_id) DO NOTHING
            `, [objectId, termTaxonomyId]);
        }
    },

    async syncImages(images, parentId) {
        for (const img of images) {
            if (!img.id) continue;

            const sql = `
                INSERT INTO wp_posts (
                    ID, post_author, post_date, post_date_gmt, post_content, post_title, 
                    post_excerpt, post_status, comment_status, ping_status, post_name, 
                    post_modified, post_modified_gmt, post_parent, guid, post_type, post_mime_type
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'attachment', 'image/jpeg')
                ON CONFLICT(ID) DO UPDATE SET
                    guid = excluded.guid,
                    post_title = excluded.post_title,
                    post_modified = excluded.post_modified,
                    post_modified_gmt = excluded.post_modified_gmt
            `;

            const values = [
                img.id,
                1, // Author
                img.date_created || new Date().toISOString(),
                img.date_created_gmt || new Date().toISOString(),
                '', // content
                img.name || '',
                '', // excerpt
                'inherit', // status
                'open',
                'closed',
                (img.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'), // slug/post_name
                img.date_modified || new Date().toISOString(),
                img.date_modified_gmt || new Date().toISOString(),
                parentId || 0,
                img.src || '',
            ];

            await db.query(sql, values);

            // Also update _wp_attached_file if possible, though strictly guid is most important for our frontend
            // But for completeness:
             const metaSql = `
                INSERT INTO wp_postmeta (post_id, meta_key, meta_value) 
                VALUES (?, '_wp_attached_file', ?)
                ON CONFLICT(post_id, meta_key) DO UPDATE SET meta_value = excluded.meta_value
            `;
            // We'll use the src as the value or a relative path if we could parse it. 
            // For external CDN, full URL in guid is key. _wp_attached_file usually stores relative path.
            // We will just store the full src here to be safe or part of it.
            await db.query(metaSql, [img.id, img.src]);
        }
    },

    async updateLookupTable(p) {
        // wp_wc_product_meta_lookup is crucial for filtering
        const sql = `
            INSERT INTO wp_wc_product_meta_lookup (
                product_id, sku, virtual, downloadable, min_price, max_price, 
                onsale, stock_quantity, stock_status, average_rating, total_sales, tax_status, tax_class
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(product_id) DO UPDATE SET
                min_price = excluded.min_price,
                max_price = excluded.max_price,
                stock_quantity = excluded.stock_quantity,
                stock_status = excluded.stock_status,
                onsale = excluded.onsale
        `;
        
        const values = [
            p.id,
            p.sku || '',
            p.virtual ? 1 : 0,
            p.downloadable ? 1 : 0,
            p.price || 0, // Simplified min/max
            p.price || 0,
            p.on_sale ? 1 : 0,
            p.stock_quantity || 0,
            p.stock_status === 'instock' ? 'instock' : 'outofstock',
            p.average_rating || 0,
            p.total_sales || 0,
            p.tax_status || 'taxable',
            p.tax_class || ''
        ];

        await db.query(sql, values);
    },
    
    /**
     * Delete a product
     */
    async deleteProduct(id) {
        console.log(`🗑️ Deleting Product ID: ${id}`);
        await db.query("DELETE FROM wp_posts WHERE ID = ?", [id]);
        await db.query("DELETE FROM wp_postmeta WHERE post_id = ?", [id]);
        await db.query("DELETE FROM wp_term_relationships WHERE object_id = ?", [id]);
        await db.query("DELETE FROM wp_wc_product_meta_lookup WHERE product_id = ?", [id]);
        return true;
    }
};

module.exports = SyncService;
