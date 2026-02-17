=== Shopwice Term Sync ===

Contributors: shopwice
Tags: woocommerce, webhook, sync, taxonomy, categories, tags, locations, brands
Requires at least: 5.8
Tested up to: 6.4
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Sends webhooks to the Shopwice API when taxonomy terms (categories, tags, brands, locations, attributes) are created, updated, or deleted.

== Description ==

This plugin hooks into WordPress term lifecycle events and sends POST requests to your Shopwice API webhook endpoint whenever supported taxonomy terms change. This keeps your D1 database in sync with WordPress without running manual sync scripts.

**Supported taxonomies:**
* product_cat (categories)
* product_tag (tags)
* product_brand (brands)
* product_location (locations)
* pa_* (product attributes, e.g. pa_color, pa_size)

**Webhook topics sent:**
* {taxonomy}.created
* {taxonomy}.updated
* {taxonomy}.deleted

== Installation ==

1. Copy the `shopwice-term-sync` folder into your WordPress `wp-content/plugins/` directory.
2. Activate the plugin from the Plugins screen in WordPress admin.
3. Go to Settings → Shopwice Term Sync.
4. Enter your **API Base URL** (e.g. https://api.shopwice.com).
5. Enter your **Webhook Secret** (must match WEBHOOK_SECRET in your Shopwice API).
6. Check "Enable webhook sync" and save.

== Configuration ==

* **API Base URL**: The base URL of your Shopwice API. Webhooks will be sent to {url}/api/webhooks/sync
* **Webhook Secret**: Must match the WEBHOOK_SECRET environment variable in your Shopwice API. Used to sign requests for verification.
* **Enable Sync**: Toggle to enable or disable webhook sending.

== Requirements ==

* WordPress 5.8 or higher
* WooCommerce (recommended for product taxonomies)
* Shopwice API with webhook endpoint at /api/webhooks/sync

== Changelog ==

= 1.0.0 =
* Initial release
* Support for product_cat, product_tag, product_brand, product_location, pa_*
