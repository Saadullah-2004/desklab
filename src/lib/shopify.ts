import 'server-only';
import {createStorefrontApiClient} from '@shopify/storefront-api-client';
import {products as demoProducts} from './catalog';
import {validateCartLines as validateCatalogCart} from './configuration';
import type {CartLine, Product} from './types';

export class CommerceError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = 'CommerceError';
  }
}

export interface CatalogResult {
  products: Product[];
  source: 'demo' | 'shopify';
  checkoutEnabled: boolean;
}

type ShopifyVariant = {
  id: string;
  availableForSale: boolean;
  quantityAvailable: number | null;
  price: {amount: string; currencyCode: string};
};
type ShopifyProduct = {
  handle: string;
  title: string;
  description: string;
  variants: {nodes: ShopifyVariant[]};
};

export function shopifyConfigured() {
  return Boolean(
    process.env.SHOPIFY_STORE_DOMAIN &&
    process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN,
  );
}

function testCheckoutEnabled() {
  // Explicit operator attestation after verifying Shopify payment test mode.
  // Storefront credentials alone do not establish that payments are sandboxed.
  return (
    shopifyConfigured() && process.env.SHOPIFY_TEST_CHECKOUT_ENABLED === 'true'
  );
}

function createClient() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN?.trim();
  const token = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN?.trim();
  if (!domain || !token) {
    throw new CommerceError(
      'Shopify checkout is not connected yet. This is a portfolio catalog preview.',
      503,
    );
  }
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) {
    throw new CommerceError(
      'The Shopify store connection is misconfigured.',
      503,
    );
  }
  return createStorefrontApiClient({
    storeDomain: `https://${domain}`,
    apiVersion: '2026-10',
    publicAccessToken: token,
    retries: 0,
    customFetchApi: (url, init) =>
      fetch(url, {
        ...init,
        cache: 'no-store',
        signal: AbortSignal.timeout(12_000),
      }),
  });
}

// Use integer cents throughout the app, rejecting unexpected currencies/precision.
export function moneyToCents(amount: string, currency: string): number {
  if (currency !== 'CAD' || !/^\d+(\.\d{1,2})?$/.test(amount)) {
    throw new CommerceError(
      'The store must provide prices in CAD with at most two decimal places.',
    );
  }
  const [whole, fraction = ''] = amount.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new CommerceError('The store returned an invalid price.');
  return cents;
}

async function liveCatalog() {
  const client = createClient();
  const declarations = demoProducts
    .map((_, index) => `$handle${index}: String!`)
    .join(', ');
  const fields = demoProducts
    .map(
      (_, index) => `p${index}: product(handle: $handle${index}) {
    handle title description
    variants(first: 2) { nodes { id availableForSale quantityAvailable price { amount currencyCode } } }
  }`,
    )
    .join('\n');
  const variables = Object.fromEntries(
    demoProducts.map((product, index) => [`handle${index}`, product.handle]),
  );
  const result = await client.request<Record<string, ShopifyProduct | null>>(
    `query DeskLabCatalog(${declarations}) @inContext(country: CA) { ${fields} }`,
    {variables},
  );
  if (result.errors || !result.data) {
    throw new CommerceError(
      'Shopify is temporarily unavailable. Please try again shortly.',
    );
  }
  const inventory = new Map<string, number | null>();
  const products = demoProducts.flatMap((original, index): Product[] => {
    const live = result.data?.[`p${index}`];
    // Unpublished or missing products must never silently become demo merchandise.
    if (!live) return [];
    const variant = original.shopifyVariantId
      ? live.variants.nodes.find(
          (item) => item.id === original.shopifyVariantId,
        )
      : live.variants.nodes.length === 1
        ? live.variants.nodes[0]
        : undefined;
    if (!variant)
      throw new CommerceError(
        `The variant mapping for ${original.name} needs attention.`,
      );
    inventory.set(original.id, variant.quantityAvailable);
    return [
      {
        ...original,
        name: live.title,
        description: live.description || original.description,
        priceCents: moneyToCents(
          variant.price.amount,
          variant.price.currencyCode,
        ),
        available: variant.availableForSale,
        shopifyVariantId: variant.id,
      },
    ];
  });
  if (products.length === 0) {
    throw new CommerceError(
      'No DeskLab products are published to the connected storefront yet.',
      503,
    );
  }
  return {products, inventory, client};
}

export async function getCatalog(): Promise<CatalogResult> {
  if (!shopifyConfigured()) {
    // Partial configuration is a configuration failure, not a silent fallback.
    if (
      process.env.SHOPIFY_STORE_DOMAIN ||
      process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN
    ) {
      throw new CommerceError(
        'The Shopify store connection is incomplete.',
        503,
      );
    }
    return {products: demoProducts, source: 'demo', checkoutEnabled: false};
  }
  const {products} = await liveCatalog();
  return {products, source: 'shopify', checkoutEnabled: testCheckoutEnabled()};
}

export function validateCartLines(value: unknown): CartLine[] {
  const lines = validateCatalogCart(value);
  if (!lines || lines.length === 0 || lines.length > 20) {
    throw new CommerceError(
      'Choose unique catalog products with quantities from 1 to 10.',
      400,
    );
  }
  return lines;
}

export async function createCheckout(input: unknown) {
  const requested = validateCartLines(input);
  if (!testCheckoutEnabled()) {
    throw new CommerceError(
      'Test checkout is not enabled. The store can be explored while its payment setup is verified.',
      503,
    );
  }
  const {products, inventory, client} = await liveCatalog();
  const lines = requested.map((line) => {
    const product = products.find((item) => item.id === line.productId);
    if (!product || !product.available || !product.shopifyVariantId) {
      throw new CommerceError(
        'A selected product is no longer available. Refresh your cart and try again.',
        409,
      );
    }
    const available = inventory.get(product.id);
    if (typeof available === 'number' && line.quantity > available) {
      throw new CommerceError(
        `There is not enough stock of ${product.name} for that quantity.`,
        409,
      );
    }
    return {merchandiseId: product.shopifyVariantId, quantity: line.quantity};
  });
  type CartResult = {
    cartCreate: {
      cart: {
        checkoutUrl: string;
        totalQuantity: number;
        lines: {nodes: {quantity: number; merchandise: {id: string}}[]};
      } | null;
      userErrors: {message: string}[];
      warnings: {code: string; message: string}[];
    };
  };
  const result = await client.request<CartResult>(
    `mutation DeskLabCheckout($input: CartInput!) @inContext(country: CA) {
    cartCreate(input: $input) {
      cart { checkoutUrl totalQuantity lines(first: 20) { nodes { quantity merchandise { ... on ProductVariant { id } } } } }
      userErrors { message }
      warnings { code message }
    }
  }`,
    {variables: {input: {lines, buyerIdentity: {countryCode: 'CA'}}}},
  );
  if (result.errors || !result.data)
    throw new CommerceError(
      'Shopify could not prepare checkout. Please try again.',
    );
  const {cart, userErrors, warnings} = result.data.cartCreate;
  if (userErrors.length || warnings.length || !cart) {
    throw new CommerceError(
      'Your cart changed while checkout was being prepared. Refresh it and try again.',
      409,
    );
  }
  const sameLines =
    cart.lines.nodes.length === lines.length &&
    lines.every((expected) =>
      cart.lines.nodes.some(
        (actual) =>
          actual.merchandise.id === expected.merchandiseId &&
          actual.quantity === expected.quantity,
      ),
    );
  if (
    !sameLines ||
    cart.totalQuantity !==
      requested.reduce((sum, line) => sum + line.quantity, 0)
  ) {
    throw new CommerceError(
      'Shopify could not add every requested item. Refresh your cart and try again.',
      409,
    );
  }
  let checkoutUrl: URL;
  try {
    checkoutUrl = new URL(cart.checkoutUrl);
  } catch {
    throw new CommerceError('Shopify returned an invalid checkout link.');
  }
  if (checkoutUrl.protocol !== 'https:')
    throw new CommerceError('Shopify returned an invalid checkout link.');
  return {checkoutUrl: checkoutUrl.href};
}
