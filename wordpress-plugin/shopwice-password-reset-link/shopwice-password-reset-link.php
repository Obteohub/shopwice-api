<?php
/**
 * Plugin Name: Shopwice Password Reset Link
 * Description: Sends password reset links to your app (vendor PWA, headless storefront, or mobile) instead of WordPress. Supports 3 apps via the "app" parameter.
 * Version: 1.1.0
 * Author: Shopwice
 * Text Domain: shopwice-password-reset-link
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Shopwice_Password_Reset_Link {

	private $option_name = 'shopwice_reset_link_settings';

	public static $app_slugs = [ 'vendor', 'storefront', 'mobile' ];

	public function __construct() {
		add_filter( 'retrieve_password_message', [ $this, 'replace_reset_link' ], 10, 4 );
		add_filter( 'retrieve_password_title', [ $this, 'replace_reset_title' ], 10, 3 );
		add_filter( 'shopwice_password_reset_link', [ $this, 'filter_reset_link' ], 10, 4 );
		add_action( 'rest_api_init', [ $this, 'register_rest_routes' ], 5 );
		add_action( 'admin_menu', [ $this, 'add_settings_page' ] );
		add_action( 'admin_init', [ $this, 'register_settings' ] );
	}

	public function register_rest_routes() {
		register_rest_route( 'shopwice/v1', '/auth/password-reset/request', [
			'methods'             => 'POST',
			'permission_callback' => '__return_true',
			'callback'            => [ $this, 'handle_password_reset_request' ],
			'args'                => [
				'email' => [ 'required' => true, 'type' => 'string', 'format' => 'email' ],
				'app'   => [ 'required' => false, 'type' => 'string', 'enum' => [ 'vendor', 'storefront', 'mobile' ] ],
			],
		], true );
	}

	/**
	 * Handle forgot-password: set which app the link should point to, then trigger WordPress reset email.
	 */
	public function handle_password_reset_request( WP_REST_Request $request ) {
		$params = $request->get_json_params() ?: $request->get_body_params() ?: [];
		$email  = isset( $params['email'] ) ? sanitize_email( $params['email'] ) : '';
		$app    = isset( $params['app'] ) ? sanitize_text_field( $params['app'] ) : 'storefront';

		if ( ! is_email( $email ) ) {
			return new WP_REST_Response( [ 'message' => 'Invalid email address.' ], 400 );
		}

		$user = get_user_by( 'email', $email );
		if ( ! $user ) {
			return new WP_REST_Response( [ 'message' => 'If that email exists, we sent a reset link.' ], 200 );
		}

		if ( ! in_array( $app, self::$app_slugs, true ) ) {
			$app = 'storefront';
		}

		set_transient( 'shopwice_reset_app_' . $email, $app, 600 );

		$result = retrieve_password( $user->user_login );
		if ( is_wp_error( $result ) ) {
			delete_transient( 'shopwice_reset_app_' . $email );
			return new WP_REST_Response( [ 'message' => $result->get_error_message() ], 400 );
		}

		return new WP_REST_Response( [ 'message' => 'If that email exists, we sent a reset link.' ], 200 );
	}

	/** For custom plugins: apply_filters( 'shopwice_password_reset_link', '', $key, $user_login, $app ). */
	public function filter_reset_link( $link, $key, $user_login, $app = 'storefront' ) {
		$app_link = self::build_reset_link( $key, $user_login, $app );
		return $app_link !== '' ? $app_link : $link;
	}

	private function get_base_url_for_app( $app ) {
		$opts = get_option( $this->option_name, [] );
		$key  = 'url_' . $app;
		if ( isset( $opts[ $key ] ) && $opts[ $key ] !== '' ) {
			return rtrim( $opts[ $key ], '/' );
		}
		if ( $app === 'storefront' && isset( $opts['app_reset_url'] ) && $opts['app_reset_url'] !== '' ) {
			return rtrim( $opts['app_reset_url'], '/' );
		}
		return '';
	}

	/**
	 * Get the base URL for the given app (used when building the link in the email).
	 */
	private function get_app_reset_url( $app = 'storefront' ) {
		if ( defined( 'SHOPWICE_APP_RESET_URL' ) && SHOPWICE_APP_RESET_URL !== '' ) {
			return rtrim( SHOPWICE_APP_RESET_URL, '/' );
		}
		$base = $this->get_base_url_for_app( $app );
		if ( $base !== '' ) {
			return $base;
		}
		foreach ( self::$app_slugs as $slug ) {
			$base = $this->get_base_url_for_app( $slug );
			if ( $base !== '' ) {
				return $base;
			}
		}
		return '';
	}

	/**
	 * Build the full reset link for an app. Optional 4th param $app: vendor | storefront | mobile.
	 */
	public static function build_reset_link( $key, $user_login, $app = 'storefront' ) {
		$instance = new self();
		$base     = $instance->get_app_reset_url( $app );
		if ( empty( $base ) ) {
			return '';
		}
		return $base . '/reset-password?key=' . $key . '&login=' . rawurlencode( $user_login );
	}

	/**
	 * Replace the default wp-login.php reset link with the app-specific URL.
	 */
	public function replace_reset_link( $message, $key, $user_login, $user_data ) {
		$email = isset( $user_data->user_email ) ? $user_data->user_email : '';
		$app   = $email ? get_transient( 'shopwice_reset_app_' . $email ) : false;
		if ( $app === false || ! in_array( $app, self::$app_slugs, true ) ) {
			$app = 'storefront';
		}
		if ( $email ) {
			delete_transient( 'shopwice_reset_app_' . $email );
		}

		$app_base = $this->get_app_reset_url( $app );
		if ( empty( $app_base ) ) {
			return $message;
		}

		$app_link = $app_base . '/reset-password?key=' . $key . '&login=' . rawurlencode( $user_login );

		$default_link = network_site_url( "wp-login.php?action=rp&key=$key&login=" . rawurlencode( $user_login ), 'login' );
		$message      = str_replace( $default_link, $app_link, $message );

		$site_url  = get_site_url();
		$alt_link  = $site_url . "/wp-login.php?action=rp&key=$key&login=" . rawurlencode( $user_login );
		$message   = str_replace( $alt_link, $app_link, $message );

		return $message;
	}

	public function replace_reset_title( $title, $user_login, $user_data ) {
		return $title;
	}

	public function add_settings_page() {
		add_options_page(
			__( 'Shopwice Reset Link', 'shopwice-password-reset-link' ),
			__( 'Shopwice Reset Link', 'shopwice-password-reset-link' ),
			'manage_options',
			'shopwice-password-reset-link',
			[ $this, 'render_settings_page' ]
		);
	}

	public function register_settings() {
		register_setting( 'shopwice_reset_link', $this->option_name, [
			'type'              => 'array',
			'sanitize_callback' => [ $this, 'sanitize' ],
		] );
		add_settings_section(
			'shopwice_reset_link_main',
			__( 'Password reset link by app', 'shopwice-password-reset-link' ),
			[ $this, 'render_section' ],
			'shopwice-password-reset-link'
		);
		add_settings_field(
			'url_vendor',
			__( 'Vendor PWA app URL', 'shopwice-password-reset-link' ),
			[ $this, 'render_field' ],
			'shopwice-password-reset-link',
			'shopwice_reset_link_main',
			[ 'key' => 'url_vendor', 'label' => 'e.g. https://vendor.shopwice.com' ]
		);
		add_settings_field(
			'url_storefront',
			__( 'Headless / storefront app URL', 'shopwice-password-reset-link' ),
			[ $this, 'render_field' ],
			'shopwice-password-reset-link',
			'shopwice_reset_link_main',
			[ 'key' => 'url_storefront', 'label' => 'e.g. https://shopwice.com or https://app.shopwice.com' ]
		);
		add_settings_field(
			'url_mobile',
			__( 'Mobile app (Android / iOS) URL', 'shopwice-password-reset-link' ),
			[ $this, 'render_field' ],
			'shopwice-password-reset-link',
			'shopwice_reset_link_main',
			[ 'key' => 'url_mobile', 'label' => 'e.g. https://app.shopwice.com or custom scheme (myapp://reset)' ]
		);
		add_settings_field(
			'app_reset_url',
			__( 'Legacy: single app URL (fallback)', 'shopwice-password-reset-link' ),
			[ $this, 'render_field' ],
			'shopwice-password-reset-link',
			'shopwice_reset_link_main',
			[ 'key' => 'app_reset_url', 'label' => 'Used if app-specific URL is empty. Leave blank if using the 3 URLs above.' ]
		);
	}

	public function sanitize( $input ) {
		$out = [
			'url_vendor'     => '',
			'url_storefront' => '',
			'url_mobile'     => '',
			'app_reset_url'  => '',
		];
		foreach ( array_keys( $out ) as $k ) {
			$out[ $k ] = isset( $input[ $k ] ) ? esc_url_raw( trim( $input[ $k ] ) ) : '';
		}
		return $out;
	}

	public function render_section() {
		echo '<p>' . esc_html__( 'You have 3 apps: Vendor PWA (React), headless storefront, and Android/iOS mobile. When a user requests a password reset, the API sends an "app" value (vendor | storefront | mobile). The email link will point to the URL for that app. Each app should have a /reset-password page that reads key and login from the URL and calls POST /api/auth/reset-password.', 'shopwice-password-reset-link' ) . '</p>';
	}

	public function render_field( $args ) {
		$key   = $args['key'];
		$opts  = get_option( $this->option_name, [] );
		$val   = isset( $opts[ $key ] ) ? $opts[ $key ] : '';
		$label = isset( $args['label'] ) ? $args['label'] : '';
		echo '<input type="url" name="' . esc_attr( $this->option_name ) . '[' . esc_attr( $key ) . ']" value="' . esc_attr( $val ) . '" class="regular-text" placeholder="' . esc_attr( $label ) . '" />';
		if ( $label ) {
			echo '<p class="description">' . esc_html( $label ) . '</p>';
		}
	}

	public function render_settings_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		?>
		<div class="wrap">
			<h1><?php echo esc_html( get_admin_page_title() ); ?></h1>
			<form action="options.php" method="post">
				<?php
				settings_fields( 'shopwice_reset_link' );
				do_settings_sections( 'shopwice-password-reset-link' );
				submit_button();
				?>
			</form>
		</div>
		<?php
	}
}

new Shopwice_Password_Reset_Link();
