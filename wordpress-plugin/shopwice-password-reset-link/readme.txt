=== Shopwice Password Reset Link ===

Sends password reset links to the correct app: Vendor PWA, headless storefront, or mobile (Android/iOS). The API sends an "app" parameter so the email link points to the right place.

== Your 3 apps ==

* **Vendor PWA** – React PWA for vendors
* **Headless storefront** – Frontend shopping app
* **Mobile** – Android / iOS shopping app

== Installation ==

1. Copy shopwice-password-reset-link to wp-content/plugins/.
2. Activate the plugin.
3. Go to Settings → Shopwice Reset Link and set:
   * **Vendor PWA app URL** (e.g. https://vendor.shopwice.com)
   * **Headless / storefront app URL** (e.g. https://shopwice.com)
   * **Mobile app URL** (e.g. https://app.shopwice.com or myapp://reset)
4. Save. The "Legacy" single URL is used as fallback if an app-specific URL is empty.

== How it works ==

1. User requests reset from one of the 3 apps. That app calls:
   POST /api/auth/forgot-password with { "email": "...", "app": "vendor" | "storefront" | "mobile" }.
2. The API forwards the request to WordPress (this plugin’s REST route).
3. The plugin stores which app was requested and triggers the WordPress reset email.
4. The email link is built using the URL for that app: {AppURL}/reset-password?key=...&login=...
5. User clicks the link and lands on that app’s reset-password page. The app reads key and login from the URL, shows a new-password form, then calls POST /api/auth/reset-password.

== REST route ==

This plugin registers POST /wp-json/shopwice/v1/auth/password-reset/request (override) so it receives the request from the API. Body: { "email": "...", "app": "vendor" | "storefront" | "mobile" }. Default app is storefront if omitted.

== Custom reset handlers ==

If another plugin builds the reset email and you want to use the app-specific link, call:
  $link = apply_filters( 'shopwice_password_reset_link', '', $key, $user_login, $app );
Use $app = 'vendor' | 'storefront' | 'mobile'.

== Changelog ==

= 1.1.0 =
* Support for 3 apps (vendor, storefront, mobile). API sends "app", plugin uses the matching URL.
* Plugin owns the password-reset/request endpoint and sets app context before sending the email.

= 1.0.0 =
* Initial release (single app URL).
