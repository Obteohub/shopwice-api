<?php
/**
 * Plugin Name: Shopwice Vendor Register
 * Description: REST endpoint for vendor registration. Creates users with role wcfm_vendor when called with isVendor or role=wcfm_vendor.
 * Version: 1.0.0
 * Author: Shopwice
 * Text Domain: shopwice-vendor-register
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'shopwice/v1', '/auth/register', [
		'methods'             => 'POST',
		'permission_callback' => '__return_true',
		'callback'            => 'shopwice_vendor_register_handle',
		'args'                => [
			'email'      => [ 'required' => true, 'type' => 'string', 'format' => 'email' ],
			'password'   => [ 'required' => true, 'type' => 'string' ],
			'username'   => [ 'required' => false, 'type' => 'string' ],
			'firstName'  => [ 'required' => false, 'type' => 'string' ],
			'lastName'   => [ 'required' => false, 'type' => 'string' ],
			'first_name' => [ 'required' => false, 'type' => 'string' ],
			'last_name'  => [ 'required' => false, 'type' => 'string' ],
			'shopName'   => [ 'required' => false, 'type' => 'string' ],
			'phone'      => [ 'required' => false, 'type' => 'string' ],
			'address'    => [ 'required' => false, 'type' => 'object' ],
			'role'       => [ 'required' => false, 'type' => 'string' ],
			'isVendor'   => [ 'required' => false, 'type' => 'boolean' ],
		],
	], true );
}, 999 );

/**
 * Handle vendor (or customer) registration. Assigns wcfm_vendor when isVendor or role=wcfm_vendor.
 */
function shopwice_vendor_register_handle( WP_REST_Request $request ) {
	$params   = $request->get_json_params() ?: $request->get_body_params() ?: [];
	$email    = isset( $params['email'] ) ? sanitize_email( $params['email'] ) : '';
	$password = isset( $params['password'] ) ? $params['password'] : '';
	$username = isset( $params['username'] ) ? $params['username'] : '';
	$is_vendor = ! empty( $params['isVendor'] ) || ( isset( $params['role'] ) && $params['role'] === 'wcfm_vendor' );

	$first_name = isset( $params['firstName'] ) ? $params['firstName'] : ( isset( $params['first_name'] ) ? $params['first_name'] : '' );
	$last_name  = isset( $params['lastName'] ) ? $params['lastName'] : ( isset( $params['last_name'] ) ? $params['last_name'] : '' );
	$shop_name  = isset( $params['shopName'] ) ? $params['shopName'] : '';
	$phone      = isset( $params['phone'] ) ? $params['phone'] : '';

	if ( ! is_email( $email ) ) {
		return new WP_REST_Response( [ 'message' => 'Invalid email address.' ], 400 );
	}
	if ( empty( $password ) || strlen( $password ) < 6 ) {
		return new WP_REST_Response( [ 'message' => 'Password must be at least 6 characters.' ], 400 );
	}

	$username = $username ? sanitize_user( $username, true ) : sanitize_user( explode( '@', $email )[0], true );
	if ( empty( $username ) ) {
		$username = 'user_' . wp_rand( 10000, 99999 );
	}

	if ( username_exists( $username ) ) {
		return new WP_REST_Response( [ 'message' => 'Username already exists.' ], 400 );
	}
	if ( email_exists( $email ) ) {
		return new WP_REST_Response( [ 'message' => 'Email already registered.' ], 400 );
	}

	$role = $is_vendor ? 'wcfm_vendor' : 'customer';

	$user_data = [
		'user_login'   => $username,
		'user_email'   => $email,
		'user_pass'    => $password,
		'first_name'   => $first_name ?: '',
		'last_name'    => $last_name ?: '',
		'display_name' => $shop_name ?: trim( $first_name . ' ' . $last_name ),
		'role'         => $role,
	];

	$user_id = wp_insert_user( $user_data );
	if ( is_wp_error( $user_id ) ) {
		return new WP_REST_Response( [ 'message' => $user_id->get_error_message() ], 400 );
	}

	if ( $is_vendor && $user_id ) {
		// Ensure role is set (in case theme/plugin overrides wp_insert_user role)
		$user = get_user_by( 'id', $user_id );
		if ( $user ) {
			$user->set_role( 'wcfm_vendor' );
			// Fallback: set capability directly if role still not set (e.g. WCFM loads later)
			if ( ! in_array( 'wcfm_vendor', (array) $user->roles, true ) ) {
				$caps = get_user_meta( $user_id, 'wp_capabilities', true );
				$caps = is_array( $caps ) ? $caps : ( is_string( $caps ) ? maybe_unserialize( $caps ) : [] );
				if ( ! is_array( $caps ) ) {
					$caps = [];
				}
				$caps['wcfm_vendor'] = true;
				update_user_meta( $user_id, 'wp_capabilities', $caps );
			}
		}

		// WCFM store meta (optional)
		if ( $shop_name ) {
			$store_slug = sanitize_title( $shop_name );
			update_user_meta( $user_id, 'store_name', $shop_name );
			update_user_meta( $user_id, 'wcfmmp_store_name', $shop_name );
			update_user_meta( $user_id, 'store_slug', $store_slug );
		}
		if ( $phone ) {
			update_user_meta( $user_id, 'wcfmmp_store_phone', $phone );
			update_user_meta( $user_id, 'billing_phone', $phone );
		}
		if ( $first_name ) {
			update_user_meta( $user_id, 'billing_first_name', $first_name );
		}
		if ( $last_name ) {
			update_user_meta( $user_id, 'billing_last_name', $last_name );
		}
		if ( $email ) {
			update_user_meta( $user_id, 'wcfmmp_store_email', $email );
		}
	}

	return new WP_REST_Response( [
		'id'       => $user_id,
		'user_id'  => $user_id,
		'email'    => $email,
		'username' => $username,
		'role'     => $role,
	], 201 );
}
