import {products} from '../src/lib/catalog';

// Run with `node --env-file=.env.local --import tsx scripts/shopify-seed.ts`.
// Default is a local plan. --inspect reads setup IDs; --apply creates only missing
// DeskLab products and publishes them to one explicitly selected test storefront.
const apply = process.argv.includes('--apply');
const inspect = process.argv.includes('--inspect');
const domain = process.env.SHOPIFY_STORE_DOMAIN || '';
const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const locationId = process.env.SHOPIFY_SEED_LOCATION_ID;
const publicationId = process.env.SHOPIFY_PUBLICATION_ID;

type Errors = {userErrors: {field?: string[]; message: string}[]};

async function admin<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain) || !token) {
    throw new Error(
      'Set a valid SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN.',
    );
  }
  const response = await fetch(
    `https://${domain}/admin/api/2026-10/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({query, variables}),
      signal: AbortSignal.timeout(20_000),
    },
  );
  const result = (await response.json()) as {
    data?: T;
    errors?: {message: string}[];
  };
  if (!response.ok || result.errors || !result.data)
    throw new Error(
      'Admin API request failed. Verify store access and the documented scopes.',
    );
  return result.data;
}

function check(result: Errors, operation: string) {
  if (result.userErrors.length)
    throw new Error(
      `${operation}: ${result.userErrors.map((error) => error.message).join('; ')}`,
    );
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function main() {
  if (!apply && !inspect) {
    console.log(
      JSON.stringify(
        {
          mode: 'plan',
          products: products.map((product) => ({
            handle: product.handle,
            priceCAD: (product.priceCents / 100).toFixed(2),
            quantity: 20,
          })),
        },
        null,
        2,
      ),
    );
    console.log(
      'No network requests or changes made. Use --inspect for setup IDs, or --apply with a dedicated test store and explicit location/publication IDs.',
    );
    return;
  }
  const setup = await admin<{
    shop: {currencyCode: string};
    locations: {nodes: {id: string; name: string; isActive: boolean}[]};
    publications: {nodes: {id: string; name: string}[]};
  }>(
    `query DeskLabSeedSetup { shop { currencyCode } locations(first: 50) { nodes { id name isActive } } publications(first: 50) { nodes { id name } } }`,
  );
  if (inspect) {
    console.log(JSON.stringify(setup, null, 2));
    return;
  }
  if (setup.shop.currencyCode !== 'CAD')
    throw new Error('The test store currency must be CAD before seeding.');
  if (
    !locationId ||
    !setup.locations.nodes.some(
      (location) => location.id === locationId && location.isActive,
    )
  ) {
    throw new Error(
      'Set SHOPIFY_SEED_LOCATION_ID to an active location returned by --inspect.',
    );
  }
  if (
    !publicationId ||
    !setup.publications.nodes.some(
      (publication) => publication.id === publicationId,
    )
  ) {
    throw new Error(
      'Set SHOPIFY_PUBLICATION_ID to the Headless or Hydrogen publication returned by --inspect.',
    );
  }
  for (const product of products) {
    const existing = await admin<{
      products: {nodes: {id: string; handle: string; tags: string[]}[]};
    }>(
      `query DeskLabExisting($query: String!) { products(first: 10, query: $query) { nodes { id handle tags } } }`,
      {query: `handle:${product.handle}`},
    );
    const match = existing.products.nodes.find(
      (item) => item.handle === product.handle,
    );
    let id: string;
    if (match) {
      if (!match.tags.includes('desklab-demo'))
        throw new Error(
          `Handle conflict: ${product.handle} belongs to an unrelated product. Nothing was overwritten.`,
        );
      id = match.id;
      console.log(`Kept existing product and inventory: ${product.handle}`);
    } else {
      const created = await admin<{
        productSet: Errors & {product: {id: string} | null};
      }>(
        `mutation DeskLabSeed($input: ProductSetInput!) { productSet(input: $input, synchronous: true) { product { id } userErrors { field message } } }`,
        {
          input: {
            handle: product.handle,
            title: product.name,
            descriptionHtml: `<p>${escapeHtml(product.description)}</p><p>DeskLab portfolio demonstration product. Test orders only.</p>`,
            status: 'ACTIVE',
            vendor: 'DeskLab',
            productType: product.category,
            tags: ['desklab-demo', product.category],
            metafields: [
              {
                namespace: 'desklab',
                key: 'specification',
                type: 'json',
                value: JSON.stringify(product),
              },
            ],
            productOptions: [
              {name: 'Title', values: [{name: 'Default Title'}]},
            ],
            variants: [
              {
                optionValues: [{optionName: 'Title', name: 'Default Title'}],
                price: (product.priceCents / 100).toFixed(2),
                inventoryPolicy: 'DENY',
                inventoryItem: {
                  tracked: true,
                  requiresShipping: true,
                  sku: `DESKLAB-${product.id.toUpperCase()}`,
                },
                inventoryQuantities: [
                  {
                    locationId,
                    name: 'available',
                    quantity: product.available ? 20 : 0,
                  },
                ],
              },
            ],
          },
        },
      );
      check(created.productSet, `Create ${product.handle}`);
      if (!created.productSet.product)
        throw new Error(
          `Shopify did not return the created ${product.handle} product.`,
        );
      id = created.productSet.product.id;
      console.log(`Created: ${product.handle}`);
    }
    const published = await admin<{publishablePublish: Errors}>(
      `mutation DeskLabPublish($id: ID!, $publicationId: ID!) { publishablePublish(id: $id, input: {publicationId: $publicationId}) { userErrors { field message } } }`,
      {id, publicationId},
    );
    check(published.publishablePublish, `Publish ${product.handle}`);
  }
  console.log(
    'Catalog seeding complete. Existing prices and inventory were preserved. Verify storefront catalog, shipping, test payments and a real test checkout next.',
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Shopify seed failed.',
  );
  process.exitCode = 1;
});
