=== Shopwice Vendor Register ===

Contributors: shopwice
Tags: wcfm, vendor, registration, rest api
Requires at least: 5.8
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later

REST endpoint that creates users with role wcfm_vendor when the Shopwice API sends vendor registration.

== Description ==

Exposes POST /wp-json/shopwice/v1/auth/register. When the request includes isVendor: true or role: "wcfm_vendor", the user is created with the WCFM vendor role. Otherwise the user is created as customer.

Requires WCFM Marketplace (or compatible) so that the wcfm_vendor role exists.

== Installation ==

1. Copy the shopwice-vendor-register folder to wp-content/plugins/.
2. Activate the plugin.

== Request body (JSON) ==

Required: email, password
Optional: username, firstName, lastName, first_name, last_name, shopName, phone, address, role, isVendor

For vendors, set isVendor: true or role: "wcfm_vendor". Optionally send shopName and phone for store meta.

== Changelog ==

= 1.0.0 =
* Initial release. Creates user with wcfm_vendor role and optional WCFM store meta.
