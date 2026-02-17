<?php
/**
 * Plugin Name: Shopwice Term Sync
 * Description: Sends webhooks to Shopwice API when taxonomy terms (categories, tags, brands, locations, attributes) are created, updated, or deleted.
 * Version: 1.0.0
 * Author: Shopwice
 * Text Domain: shopwice-term-sync
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Supported taxonomies to sync.
 * Add alternate slugs used by themes/plugins; topic sent to API uses the canonical slug.
 */
const SHOPWICE_SYNC_TAXONOMIES = [
	'product_cat',
	'product_tag',
	'product_brand',
	'product_location',
	'location',      // alternate slug for location taxonomy
	'locations',
];

/** Taxonomy slug -> topic slug for API (so API always receives e.g. product_location) */
const SHOPWICE_TAXONOMY_TO_TOPIC = [
	'location'   => 'product_location',
	'locations'  => 'product_location',
];

class Shopwice_Term_Sync {

	/** @var string */
	private $option_group = 'shopwice_term_sync';

	/** @var string */
	private $option_name = 'shopwice_term_sync_settings';

	/**
	 * Initialize plugin.
	 */
	public function __construct() {
		add_action( 'created_term', [ $this, 'on_term_created' ], 10, 4 );
		add_action( 'edited_term', [ $this, 'on_term_updated' ], 10, 4 );
		add_action( 'delete_term', [ $this, 'on_term_deleted' ], 10, 5 );
		add_action( 'admin_menu', [ $this, 'add_settings_page' ] );
		add_action( 'admin_init', [ $this, 'register_settings' ] );
		add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), [ $this, 'add_settings_link' ] );
	}

	/**
	 * Check if a taxonomy should be synced.
	 *
	 * @param string $taxonomy Taxonomy slug.
	 * @return bool
	 */
	private function should_sync_taxonomy( $taxonomy ) {
		if ( in_array( $taxonomy, SHOPWICE_SYNC_TAXONOMIES, true ) ) {
			return true;
		}
		// Product attributes: pa_color, pa_size, etc.
		return strpos( $taxonomy, 'pa_' ) === 0;
	}

	/**
	 * Topic slug to send to API (canonical slug). Maps alternate WP slugs to API taxonomy.
	 *
	 * @param string $taxonomy WordPress taxonomy slug.
	 * @return string
	 */
	private function topic_slug( $taxonomy ) {
		return isset( SHOPWICE_TAXONOMY_TO_TOPIC[ $taxonomy ] )
			? SHOPWICE_TAXONOMY_TO_TOPIC[ $taxonomy ]
			: $taxonomy;
	}

	/**
	 * Get plugin settings.
	 *
	 * @return array
	 */
	private function get_settings() {
		$defaults = [
			'api_url'  => '',
			'secret'   => '',
			'enabled'  => '1',
		];
		$opts     = get_option( $this->option_name, [] );
		return wp_parse_args( $opts, $defaults );
	}

	/**
	 * Build term payload for webhook.
	 *
	 * @param WP_Term|stdClass $term Term object.
	 * @param string           $taxonomy Taxonomy slug.
	 * @return array
	 */
	private function build_term_payload( $term, $taxonomy ) {
		$t = is_object( $term ) ? $term : (object) $term;
		$payload = [
			'id'                => (int) ( $t->term_id ?? $t->id ?? 0 ),
			'term_id'           => (int) ( $t->term_id ?? $t->id ?? 0 ),
			'term_taxonomy_id'  => (int) ( $t->term_taxonomy_id ?? $t->term_id ?? $t->id ?? 0 ),
			'name'              => $t->name ?? '',
			'slug'              => $t->slug ?? '',
			'description'       => $t->description ?? '',
			'parent'            => (int) ( $t->parent ?? 0 ),
			'count'             => (int) ( $t->count ?? 0 ),
			'taxonomy'          => $taxonomy,
		];

		// Add thumbnail for product categories if available.
		if ( $taxonomy === 'product_cat' && function_exists( 'get_term_meta' ) ) {
			$thumb_id = get_term_meta( $payload['id'], 'thumbnail_id', true );
			if ( $thumb_id ) {
				$payload['image'] = [ 'id' => (int) $thumb_id ];
			}
		}

		return $payload;
	}

	/**
	 * Send webhook to Shopwice API.
	 *
	 * @param string $topic   Topic, e.g. product_location.created.
	 * @param array  $payload JSON-serializable payload.
	 * @return true|WP_Error
	 */
	private function send_webhook( $topic, $payload ) {
		$settings = $this->get_settings();
		if ( empty( $settings['api_url'] ) || empty( $settings['enabled'] ) || $settings['enabled'] !== '1' ) {
			set_transient( 'shopwice_term_sync_last_result', [ 'ok' => false, 'error' => __( 'API URL not configured or sync disabled.', 'shopwice-term-sync' ) ], 300 );
			return new WP_Error( 'config', 'Shopwice Term Sync: API URL not configured or plugin disabled.' );
		}

		$url = rtrim( $settings['api_url'], '/' );
		$url = strpos( $url, '/api/webhooks/sync' ) !== false ? $url : $url . '/api/webhooks/sync';

		$body    = wp_json_encode( $payload );
		$headers = [
			'Content-Type'        => 'application/json',
			'X-WC-Webhook-Topic'  => $topic,
			'User-Agent'          => 'Shopwice-Term-Sync/1.0; ' . get_bloginfo( 'url' ),
		];

		if ( ! empty( $settings['secret'] ) ) {
			$headers['X-WC-Webhook-Signature'] = base64_encode( hash_hmac( 'sha256', $body, $settings['secret'], true ) );
		}

		$response = wp_remote_post( $url, [
			'body'    => $body,
			'headers' => $headers,
			'timeout' => 15,
		] );

		if ( is_wp_error( $response ) ) {
			$this->log( 'Webhook error: ' . $response->get_error_message(), 'error' );
			set_transient( 'shopwice_term_sync_last_result', [ 'ok' => false, 'error' => $response->get_error_message() ], 300 );
			return $response;
		}

		$code = wp_remote_retrieve_response_code( $response );
		if ( $code < 200 || $code >= 300 ) {
			$body = wp_remote_retrieve_body( $response );
			$this->log( sprintf( 'Webhook returned %d: %s', $code, substr( $body, 0, 200 ) ), 'error' );
			set_transient( 'shopwice_term_sync_last_result', [ 'ok' => false, 'error' => "HTTP {$code}", 'body' => substr( $body, 0, 200 ) ], 300 );
			return new WP_Error( 'webhook', sprintf( 'API returned %d', $code ) );
		}

		$this->log( sprintf( 'Webhook sent: %s (term %d)', $topic, $payload['id'] ?? 0 ) );
		set_transient( 'shopwice_term_sync_last_result', [ 'ok' => true, 'topic' => $topic, 'term_id' => $payload['id'] ?? 0 ], 300 );
		return true;
	}

	/**
	 * Log message (uses error_log if WP_DEBUG_LOG).
	 *
	 * @param string $message Message.
	 * @param string $level   Level (info, error).
	 */
	private function log( $message, $level = 'info' ) {
		if ( defined( 'WP_DEBUG' ) && WP_DEBUG && defined( 'WP_DEBUG_LOG' ) && WP_DEBUG_LOG ) {
			error_log( '[Shopwice Term Sync] ' . $message );
		}
	}

	/**
	 * Fired when a term is created.
	 *
	 * @param int    $term_id  Term ID.
	 * @param int    $tt_id    Term taxonomy ID.
	 * @param string $taxonomy Taxonomy slug.
	 * @param array  $args     Arguments passed to wp_insert_term().
	 */
	public function on_term_created( $term_id, $tt_id, $taxonomy, $args ) {
		if ( ! $this->should_sync_taxonomy( $taxonomy ) ) {
			return;
		}
		$term = get_term( $term_id, $taxonomy );
		if ( ! $term || is_wp_error( $term ) ) {
			return;
		}
		$topic_slug = $this->topic_slug( $taxonomy );
		$payload    = $this->build_term_payload( $term, $topic_slug );
		$this->send_webhook( $topic_slug . '.created', $payload );
	}

	/**
	 * Fired when a term is updated.
	 *
	 * @param int    $term_id  Term ID.
	 * @param int    $tt_id    Term taxonomy ID.
	 * @param string $taxonomy Taxonomy slug.
	 * @param array  $args     Arguments passed to wp_update_term().
	 */
	public function on_term_updated( $term_id, $tt_id, $taxonomy, $args ) {
		if ( ! $this->should_sync_taxonomy( $taxonomy ) ) {
			return;
		}
		$term = get_term( $term_id, $taxonomy );
		if ( ! $term || is_wp_error( $term ) ) {
			return;
		}
		$topic_slug = $this->topic_slug( $taxonomy );
		$payload    = $this->build_term_payload( $term, $topic_slug );
		$this->send_webhook( $topic_slug . '.updated', $payload );
	}

	/**
	 * Fired when a term is deleted (term object passed before deletion).
	 *
	 * @param int     $term_id     Term ID.
	 * @param int     $tt_id       Term taxonomy ID.
	 * @param string  $taxonomy    Taxonomy slug.
	 * @param WP_Term $deleted_term Copy of the term object before deletion.
	 * @param array   $object_ids  Object IDs.
	 */
	public function on_term_deleted( $term_id, $tt_id, $taxonomy, $deleted_term, $object_ids ) {
		if ( ! $this->should_sync_taxonomy( $taxonomy ) ) {
			return;
		}
		$topic_slug = $this->topic_slug( $taxonomy );
		$payload    = $this->build_term_payload( $deleted_term, $topic_slug );
		$this->send_webhook( $topic_slug . '.deleted', $payload );
	}

	/**
	 * Add settings page under Settings menu.
	 */
	public function add_settings_page() {
		add_options_page(
			__( 'Shopwice Term Sync', 'shopwice-term-sync' ),
			__( 'Shopwice Term Sync', 'shopwice-term-sync' ),
			'manage_options',
			'shopwice-term-sync',
			[ $this, 'render_settings_page' ]
		);
	}

	/**
	 * Register settings.
	 */
	public function register_settings() {
		register_setting( $this->option_group, $this->option_name, [
			'type'              => 'array',
			'sanitize_callback' => [ $this, 'sanitize_settings' ],
		] );
		add_settings_section(
			'shopwice_term_sync_main',
			__( 'API Configuration', 'shopwice-term-sync' ),
			[ $this, 'render_section' ],
			'shopwice-term-sync'
		);
		add_settings_field(
			'api_url',
			__( 'API Base URL', 'shopwice-term-sync' ),
			[ $this, 'render_field_api_url' ],
			'shopwice-term-sync',
			'shopwice_term_sync_main'
		);
		add_settings_field(
			'secret',
			__( 'Webhook Secret', 'shopwice-term-sync' ),
			[ $this, 'render_field_secret' ],
			'shopwice-term-sync',
			'shopwice_term_sync_main'
		);
		add_settings_field(
			'enabled',
			__( 'Enable Sync', 'shopwice-term-sync' ),
			[ $this, 'render_field_enabled' ],
			'shopwice-term-sync',
			'shopwice_term_sync_main'
		);
	}

	/**
	 * Sanitize settings.
	 *
	 * @param array $input Raw input.
	 * @return array
	 */
	public function sanitize_settings( $input ) {
		$out = [];
		$out['api_url'] = isset( $input['api_url'] ) ? esc_url_raw( trim( $input['api_url'] ) ) : '';
		$out['secret']  = isset( $input['secret'] ) ? sanitize_text_field( $input['secret'] ) : '';
		$out['enabled'] = isset( $input['enabled'] ) && $input['enabled'] === '1' ? '1' : '0';
		return $out;
	}

	/**
	 * Render settings section.
	 */
	public function render_section() {
		echo '<p>' . esc_html__( 'Configure the Shopwice API endpoint and secret. The plugin will send webhooks when terms in product categories, tags, brands, locations, or product attributes are created, updated, or deleted.', 'shopwice-term-sync' ) . '</p>';
		echo '<p><strong>' . esc_html__( 'Synced taxonomies:', 'shopwice-term-sync' ) . '</strong> product_cat, product_tag, product_brand, product_location, pa_* (attributes)</p>';
	}

	/**
	 * Render API URL field.
	 */
	public function render_field_api_url() {
		$opts = $this->get_settings();
		$val  = $opts['api_url'];
		echo '<input type="url" name="' . esc_attr( $this->option_name ) . '[api_url]" value="' . esc_attr( $val ) . '" class="regular-text" placeholder="https://api.shopwice.com" />';
		echo '<p class="description">' . esc_html__( 'Base URL of your Shopwice API (e.g. https://api.shopwice.com). Webhooks will be sent to /api/webhooks/sync', 'shopwice-term-sync' ) . '</p>';
	}

	/**
	 * Render Secret field.
	 */
	public function render_field_secret() {
		$opts = $this->get_settings();
		$val  = $opts['secret'];
		echo '<input type="password" name="' . esc_attr( $this->option_name ) . '[secret]" value="' . esc_attr( $val ) . '" class="regular-text" autocomplete="off" />';
		echo '<p class="description">' . esc_html__( 'Must match WEBHOOK_SECRET in your Shopwice API. Leave empty to skip signature verification.', 'shopwice-term-sync' ) . '</p>';
	}

	/**
	 * Render Enabled field.
	 */
	public function render_field_enabled() {
		$opts   = $this->get_settings();
		$checked = ( $opts['enabled'] ?? '1' ) === '1' ? 'checked' : '';
		echo '<label><input type="checkbox" name="' . esc_attr( $this->option_name ) . '[enabled]" value="1" ' . $checked . ' /> ' . esc_html__( 'Enable webhook sync', 'shopwice-term-sync' ) . '</label>';
	}

	/**
	 * Render settings page.
	 */
	public function render_settings_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$last = get_transient( 'shopwice_term_sync_last_result' );
		?>
		<div class="wrap">
			<h1><?php echo esc_html( get_admin_page_title() ); ?></h1>
			<?php if ( $last ) : ?>
				<div class="notice notice-<?php echo $last['ok'] ? 'success' : 'error'; ?> is-dismissible" style="margin: 1em 0;">
					<p><strong><?php esc_html_e( 'Last webhook:', 'shopwice-term-sync' ); ?></strong>
						<?php
						if ( $last['ok'] ) {
							printf( esc_html__( 'Sent %s (term %d)', 'shopwice-term-sync' ), esc_html( $last['topic'] ), (int) $last['term_id'] );
						} else {
							echo esc_html( $last['error'] ?? 'Unknown error' );
							if ( ! empty( $last['body'] ) ) {
								echo ' — ' . esc_html( $last['body'] );
							}
						}
						?>
					</p>
				</div>
			<?php endif; ?>
			<form action="options.php" method="post">
				<?php
				settings_fields( $this->option_group );
				do_settings_sections( 'shopwice-term-sync' );
				submit_button( __( 'Save Settings', 'shopwice-term-sync' ) );
				?>
			</form>
		</div>
		<?php
	}

	/**
	 * Add settings link on plugins page.
	 *
	 * @param array $links Plugin action links.
	 * @return array
	 */
	public function add_settings_link( $links ) {
		$url   = admin_url( 'options-general.php?page=shopwice-term-sync' );
		$links[] = '<a href="' . esc_url( $url ) . '">' . __( 'Settings', 'shopwice-term-sync' ) . '</a>';
		return $links;
	}
}

new Shopwice_Term_Sync();
