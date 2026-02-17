// src/graphql/schema.js
const gql = require('graphql-tag');

const typeDefs = gql`
  type Image {
    id: ID
    src: String
    sourceUrl: String
    srcSet: String
    altText: String
    title: String
    node: Image
  }

  type Category {
    id: ID!
    databaseId: Int
    name: String
    slug: String
    description: String
    parent: Int
    count: Int
    image: Image
    ancestors: ProductCategoryConnection
  }

  type ProductCategoryConnection {
    nodes: [Category]
  }

  type Location {
    id: ID!
    databaseId: Int
    name: String
    slug: String
  }

  type ProductLocationConnection {
    nodes: [Location]
  }

  type Brand {
    id: ID!
    databaseId: Int
    name: String
    slug: String
    taxonomy: String
  }

  type ProductBrandConnection {
    nodes: [Brand]
  }

  type ReviewAuthorNode {
    name: String
  }

  type ReviewAuthor {
    node: ReviewAuthorNode
  }

  type Review {
    id: ID!
    author: ReviewAuthor
    content: String
    date: String
    rating: Int
  }

  type ProductReviewConnection {
    nodes: [Review]
  }

  type Attribute {
    id: ID!
    name: String
    label: String
    slug: String
    options: [String]
    visible: Boolean
    variation: Boolean
  }

  type AttributeConnection {
    nodes: [Attribute]
  }

  type SEO {
    title: String
    description: String
    fullHead: String
  }

  type ProductVariation {
    id: ID!
    databaseId: Int
    name: String
    sku: String
    stockStatus: String
    stockQuantity: Int
    purchasable: Boolean
    onSale: Boolean
    salePrice: String
    regularPrice: String
    price: String
    attributes: AttributeConnection
    image: Image
  }

  type ProductVariationConnection {
    nodes: [ProductVariation]
  }

  type Product {
    id: ID!
    databaseId: Int
    name: String
    slug: String
    productId: Int
    link: String
    description: String
    shortDescription: String
    price: String
    regularPrice: String
    salePrice: String
    onSale: Boolean
    sku: String
    stockQuantity: Int
    stockStatus: String
    manageStock: Boolean
    status: String
    date: String
    totalSales: Int
    averageRating: Float
    reviewCount: Int
    ratingCount: Int
    
    image: Image
    featuredImage: Image
    images: [Image]
    galleryImages: ProductGalleryImageConnection
    
    categories: [Category]
    productCategories: ProductCategoryConnection
    
    tags: [Category]
    
    brands: [Brand]
    productBrands: ProductBrandConnection
    
    locations: [Location]
    productLocation: ProductLocationConnection
    
    attributes: AttributeConnection
    type: String
    
    variations: ProductVariationConnection
    variants: [Product]
    
    upsellProducts: [Product]
    crossSellProducts: [Product]
    crossSell: ProductConnection
    relatedProducts: [Product]
    bestSellers: [Product]
    
    reviews: ProductReviewConnection
    seo: SEO
    
    # Extra fields for Variable/Simple products
    allPaColor: ProductAttributeColorConnection
    allPaSize: ProductAttributeSizeConnection
  }

  type ProductAttributeColorConnection {
    nodes: [TermNode]
  }

  type ProductAttributeSizeConnection {
    nodes: [TermNode]
  }

  type TermNode {
    name: String
  }

  type ProductGalleryImageConnection {
    nodes: [Image]
  }

  input ProductImageInput {
    src: String!
  }

  input ProductCategoryInput {
    id: ID!
  }

  input ProductInput {
    name: String
    slug: String
    type: String
    status: String
    description: String
    shortDescription: String
    price: String
    regularPrice: String
    salePrice: String
    sku: String
    stockQuantity: Int
    stockStatus: String
    manageStock: Boolean
    categories: [ProductCategoryInput]
    images: [ProductImageInput]
    galleryImages: [ProductImageInput]
  }

  type Customer {
    id: ID!
    email: String
    username: String
    firstName: String
    lastName: String
    role: String
  }

  input RegisterVendorInput {
    email: String!
    password: String!
    username: String
    firstName: String
    lastName: String
    shopName: String!
    phone: String
    address: VendorAddressInput
  }

  input VendorAddressInput {
    street_1: String
    city: String
    state: String
    zip: String
    country: String
  }

  input RegisterCustomerInput {
    email: String!
    password: String!
    username: String
    firstName: String
    lastName: String
    role: String
  }

  input AddToCartInput {
    productId: Int!
    quantity: Int
  }

  type CartCost {
    total: String
    subtotal: String
    subtotalTax: String
    shipping: String
    shippingTax: String
    tax: String
    feeTax: String
    fee: String
  }

  type ShippingRate {
    id: String
    methodId: String
    label: String
    cost: String
    selected: Boolean
  }

  type ShippingPackage {
    packageDetails: String
    rates: [ShippingRate]
  }

  type CartAddress {
    firstName: String
    lastName: String
    company: String
    address1: String
    address2: String
    city: String
    state: String
    postcode: String
    country: String
    email: String
    phone: String
  }

  type CartCoupon {
    code: String
    discount_type: String
    totals: CartTotals
  }

  type CartItemProduct {
    node: Product
  }

  type CartItemContents {
    key: String
    product: CartItemProduct
    variation: CartItemProduct
    quantity: Int
    total: String
    subtotal: String
    subtotalTax: String
  }

  type CartContents {
    nodes: [CartItemContents]
    itemCount: Int
  }

  type CartItem {
    key: String
    id: Int
    quantity: Int
    name: String
    price: String
    line_total: String
    variation: [String]
  }

  type Cart {
    contents: CartContents
    cost: CartCost
    totals: CartTotals
    items: [CartItem]
    itemCount: Int
    total: String
    subtotal: String
    subtotalTax: String
    shippingTotal: String
    shippingTax: String
    totalTax: String
    isEmpty: Boolean
    needsPayment: Boolean
    needsShipping: Boolean
    availableShippingMethods: [ShippingPackage]
    shippingAddress: CartAddress
    billingAddress: CartAddress
    coupons: [CartCoupon]
  }

  type CartTotals {
    total_items: String
    total_price: String
    total_shipping: String
    total_tax: String
    total_discount: String
  }

  type AddToCartPayload {
    cart: Cart
  }

  type Mutation {
    createProduct(input: ProductInput!): Product
    updateProduct(id: ID!, input: ProductInput!): Product
    deleteProduct(id: ID!): Boolean
    
    registerCustomer(input: RegisterCustomerInput!): Customer
    registerVendor(input: RegisterVendorInput!): Vendor
    
    login(input: LoginInput!): AuthResponse
    loginWithSocial(input: SocialLoginInput!): AuthResponse
    
    sendPasswordResetEmail(input: SendPasswordResetEmailInput!): SendPasswordResetEmailPayload
    resetPassword(input: ResetPasswordInput!): ResetPasswordPayload

    addToCart(input: AddToCartInput!): AddToCartPayload
  }

  input SendPasswordResetEmailInput {
    email: String!
    app: String
  }

  type SendPasswordResetEmailPayload {
    success: Boolean
    message: String
  }

  input ResetPasswordInput {
    user_login: String!
    password_reset_key: String!
    new_password: String!
  }

  type ResetPasswordPayload {
    success: Boolean
    message: String
  }

  input LoginInput {
    username: String!
    password: String!
  }

  input SocialLoginInput {
    provider: String!
    accessToken: String!
    email: String
    firstName: String
    lastName: String
  }

  type AuthResponse {
    token: String
    user: Customer
  }

  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
  }

  type ProductEdge {
    cursor: String!
    node: Product!
  }

  type ProductConnection {
    edges: [ProductEdge!]!
    nodes: [Product!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  input AttributeFilterInput {
    taxonomy: String!
    terms: [String]!
  }

  input ProductsWhereArgs {
    categoryId: ID
    categoryIn: [ID]
    categoryName: String
    search: String
    minPrice: Float
    maxPrice: Float
    status: String
    tag: ID
    tagIn: [ID]
    brands: [String]
    locations: [String]
    attributes: [AttributeFilterInput]
  }

  type VendorAddress {
    street: String
    city: String
    state: String
    country: String
    zip: String
    latitude: Float
    longitude: Float
  }

  type VendorSocial {
    facebook: String
    twitter: String
    instagram: String
    linkedin: String
    youtube: String
  }

  type VendorStats {
    product_count: Int
    total_sales: String
    total_orders: Int
    total_earnings: String
    items_sold: Int
  }

  type Vendor {
    id: ID!
    shopName: String
    shopSlug: String
    shopDescription: String
    shopUrl: String
    email: String
    phone: String
    address: VendorAddress
    logo: String
    banner: String
    social: VendorSocial
    rating: Float
    reviewCount: Int
    totalSales: Int
    productCount: Int
    memberSince: String
    isEnabled: Boolean
    stats: VendorStats
  }

  type VendorEdge {
    cursor: String!
    node: Vendor!
  }

  type VendorConnection {
    edges: [VendorEdge!]!
    nodes: [Vendor!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  input VendorsWhereArgs {
    search: String
    isEnabled: Boolean
  }

  type OrderItem {
    id: ID
    name: String
    quantity: Int
    price: String
    image: String
  }

  type Order {
    id: ID!
    order_number: String
    date_created: String
    status: String
    commission_status: String
    total: String
    commission: String
    customer_name: String
    customer_email: String
    customer: Customer
    items: [OrderItem]
  }

  type OrderEdge {
    cursor: String!
    node: Order!
  }

  type OrderConnection {
    edges: [OrderEdge!]!
    nodes: [Order!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type Query {
    order(id: ID!): Order
    orders(
      first: Int
      after: String
      page: Int
      perPage: Int
      status: String
    ): OrderConnection
    product(id: ID!): Product
    # Support both old style (direct args) and new style (where arg) for compatibility
    products(
      first: Int
      after: String
      page: Int
      perPage: Int
      # Old style direct arguments (deprecated but kept for backward compatibility)
      search: String
      category: ID
      minPrice: Float
      maxPrice: Float
      status: String
      tag: ID
      attributes: [AttributeFilterInput]
      brands: [String]
      locations: [String]
      # New WPGraphQL-compatible where argument
      where: ProductsWhereArgs
      # Vendor filter
      vendorId: ID
    ): ProductConnection
    categories: [Category]
    
    # Vendor queries
    vendor(id: ID, slug: String): Vendor
    vendors(
      first: Int
      after: String
      page: Int
      perPage: Int
      search: String
      where: VendorsWhereArgs
    ): VendorConnection
    vendorProducts(
      vendorId: ID!
      first: Int
      after: String
      page: Int
      perPage: Int
    ): ProductConnection
    
    productCategories(where: ProductCategoryQueryArgs): ProductCategoryConnection
    productTags(where: ProductCategoryQueryArgs): ProductCategoryConnection
    productBrands(where: ProductCategoryQueryArgs): ProductBrandConnection
    productLocations(where: ProductCategoryQueryArgs): ProductLocationConnection
    productAttributeTaxonomies(where: ProductCategoryQueryArgs): AttributeTaxonomyConnection
    terms(taxonomy: [String], where: ProductCategoryQueryArgs): ProductCategoryConnection
    
    # Cart Query
    cart: Cart
  }

  input ProductCategoryQueryArgs {
    slug: [String]
    id: ID
    search: String
    forceRefresh: Boolean
    parentId: Int
    parent: Int
  }

  type AttributeTaxonomy {
    id: ID!
    name: String
    slug: String
    type: String
    orderBy: String
    hasArchives: Boolean
  }

  type AttributeTaxonomyConnection {
    nodes: [AttributeTaxonomy]
  }
`;

module.exports = typeDefs;
