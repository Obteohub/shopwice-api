-- WordPress Tables adapted for SQLite (Cloudflare D1)

-- wp_posts
CREATE TABLE IF NOT EXISTS wp_posts (
    ID INTEGER PRIMARY KEY AUTOINCREMENT,
    post_author INTEGER NOT NULL DEFAULT 0,
    post_date TEXT NOT NULL DEFAULT '0000-00-00 00:00:00',
    post_date_gmt TEXT NOT NULL DEFAULT '0000-00-00 00:00:00',
    post_content TEXT NOT NULL DEFAULT '',
    post_title TEXT NOT NULL DEFAULT '',
    post_excerpt TEXT NOT NULL DEFAULT '',
    post_status TEXT NOT NULL DEFAULT 'publish',
    comment_status TEXT NOT NULL DEFAULT 'open',
    ping_status TEXT NOT NULL DEFAULT 'open',
    post_password TEXT NOT NULL DEFAULT '',
    post_name TEXT NOT NULL DEFAULT '',
    to_ping TEXT NOT NULL DEFAULT '',
    pinged TEXT NOT NULL DEFAULT '',
    post_modified TEXT NOT NULL DEFAULT '0000-00-00 00:00:00',
    post_modified_gmt TEXT NOT NULL DEFAULT '0000-00-00 00:00:00',
    post_content_filtered TEXT NOT NULL DEFAULT '',
    post_parent INTEGER NOT NULL DEFAULT 0,
    guid TEXT NOT NULL DEFAULT '',
    menu_order INTEGER NOT NULL DEFAULT 0,
    post_type TEXT NOT NULL DEFAULT 'post',
    post_mime_type TEXT NOT NULL DEFAULT '',
    comment_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS type_status_date ON wp_posts (post_type, post_status, post_date, ID);
CREATE INDEX IF NOT EXISTS post_parent ON wp_posts (post_parent);
CREATE INDEX IF NOT EXISTS post_author ON wp_posts (post_author);
CREATE INDEX IF NOT EXISTS post_name ON wp_posts (post_name);

-- wp_postmeta
CREATE TABLE IF NOT EXISTS wp_postmeta (
    meta_id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL DEFAULT 0,
    meta_key TEXT DEFAULT NULL,
    meta_value TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS post_id ON wp_postmeta (post_id);
CREATE INDEX IF NOT EXISTS meta_key ON wp_postmeta (meta_key);

-- wp_comments
CREATE TABLE IF NOT EXISTS wp_comments (
    comment_ID INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_post_ID INTEGER NOT NULL DEFAULT 0,
    comment_author TEXT NOT NULL DEFAULT '',
    comment_author_email TEXT NOT NULL DEFAULT '',
    comment_author_url TEXT NOT NULL DEFAULT '',
    comment_author_IP TEXT NOT NULL DEFAULT '',
    comment_date TEXT NOT NULL DEFAULT '0000-00-00 00:00:00',
    comment_date_gmt TEXT NOT NULL DEFAULT '0000-00-00 00:00:00',
    comment_content TEXT NOT NULL DEFAULT '',
    comment_karma INTEGER NOT NULL DEFAULT 0,
    comment_approved TEXT NOT NULL DEFAULT '1',
    comment_agent TEXT NOT NULL DEFAULT '',
    comment_type TEXT NOT NULL DEFAULT 'comment',
    comment_parent INTEGER NOT NULL DEFAULT 0,
    user_id INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS comment_post_ID ON wp_comments (comment_post_ID);
CREATE INDEX IF NOT EXISTS comment_approved_date_gmt ON wp_comments (comment_approved, comment_date_gmt);
CREATE INDEX IF NOT EXISTS comment_date_gmt ON wp_comments (comment_date_gmt);
CREATE INDEX IF NOT EXISTS comment_parent ON wp_comments (comment_parent);
CREATE INDEX IF NOT EXISTS comment_author_email ON wp_comments (comment_author_email);

-- wp_commentmeta
CREATE TABLE IF NOT EXISTS wp_commentmeta (
    meta_id INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id INTEGER NOT NULL DEFAULT 0,
    meta_key TEXT DEFAULT NULL,
    meta_value TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS comment_id ON wp_commentmeta (comment_id);
CREATE INDEX IF NOT EXISTS meta_key ON wp_commentmeta (meta_key);

-- wp_terms
CREATE TABLE IF NOT EXISTS wp_terms (
    term_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    slug TEXT NOT NULL DEFAULT '',
    term_group INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS slug ON wp_terms (slug);
CREATE INDEX IF NOT EXISTS name ON wp_terms (name);

-- wp_term_taxonomy
CREATE TABLE IF NOT EXISTS wp_term_taxonomy (
    term_taxonomy_id INTEGER PRIMARY KEY AUTOINCREMENT,
    term_id INTEGER NOT NULL DEFAULT 0,
    taxonomy TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    parent INTEGER NOT NULL DEFAULT 0,
    count INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS term_id_taxonomy ON wp_term_taxonomy (term_id, taxonomy);
CREATE INDEX IF NOT EXISTS taxonomy ON wp_term_taxonomy (taxonomy);

-- wp_term_relationships
CREATE TABLE IF NOT EXISTS wp_term_relationships (
    object_id INTEGER NOT NULL DEFAULT 0,
    term_taxonomy_id INTEGER NOT NULL DEFAULT 0,
    term_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (object_id, term_taxonomy_id)
);
CREATE INDEX IF NOT EXISTS term_taxonomy_id ON wp_term_relationships (term_taxonomy_id);

-- wp_users
CREATE TABLE IF NOT EXISTS wp_users (
    ID INTEGER PRIMARY KEY AUTOINCREMENT,
    user_login TEXT NOT NULL DEFAULT '',
    user_pass TEXT NOT NULL DEFAULT '',
    user_nicename TEXT NOT NULL DEFAULT '',
    user_email TEXT NOT NULL DEFAULT '',
    user_url TEXT NOT NULL DEFAULT '',
    user_registered TEXT NOT NULL DEFAULT '0000-00-00 00:00:00',
    user_activation_key TEXT NOT NULL DEFAULT '',
    user_status INTEGER NOT NULL DEFAULT 0,
    display_name TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS user_login_key ON wp_users (user_login);
CREATE INDEX IF NOT EXISTS user_nicename ON wp_users (user_nicename);
CREATE INDEX IF NOT EXISTS user_email ON wp_users (user_email);

-- wp_usermeta
CREATE TABLE IF NOT EXISTS wp_usermeta (
    umeta_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 0,
    meta_key TEXT DEFAULT NULL,
    meta_value TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS user_id ON wp_usermeta (user_id);
CREATE INDEX IF NOT EXISTS meta_key ON wp_usermeta (meta_key);

-- wp_wc_product_meta_lookup
CREATE TABLE IF NOT EXISTS wp_wc_product_meta_lookup (
    product_id INTEGER NOT NULL,
    sku TEXT DEFAULT '',
    virtual INTEGER DEFAULT 0,
    downloadable INTEGER DEFAULT 0,
    min_price REAL DEFAULT NULL,
    max_price REAL DEFAULT NULL,
    onsale INTEGER DEFAULT 0,
    stock_quantity REAL DEFAULT NULL,
    stock_status TEXT DEFAULT 'instock',
    rating_count INTEGER DEFAULT 0,
    average_rating REAL DEFAULT 0,
    total_sales INTEGER DEFAULT 0,
    tax_status TEXT DEFAULT 'taxable',
    tax_class TEXT DEFAULT '',
    PRIMARY KEY (product_id)
);

-- wp_woocommerce_attribute_taxonomies
CREATE TABLE IF NOT EXISTS wp_woocommerce_attribute_taxonomies (
    attribute_id INTEGER PRIMARY KEY AUTOINCREMENT,
    attribute_name TEXT NOT NULL,
    attribute_label TEXT DEFAULT NULL,
    attribute_type TEXT NOT NULL DEFAULT 'select',
    attribute_orderby TEXT NOT NULL DEFAULT 'menu_order',
    attribute_public INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS attribute_name ON wp_woocommerce_attribute_taxonomies (attribute_name);
