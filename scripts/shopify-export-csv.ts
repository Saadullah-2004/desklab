import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {products} from '../src/lib/catalog';

const output = resolve(process.argv[2] || 'artifacts/shopify-products.csv');
const headers = [
  'Handle',
  'Title',
  'Body (HTML)',
  'Vendor',
  'Type',
  'Tags',
  'Published',
  'Option1 Name',
  'Option1 Value',
  'Variant SKU',
  'Variant Inventory Tracker',
  'Variant Inventory Qty',
  'Variant Inventory Policy',
  'Variant Fulfillment Service',
  'Variant Price',
  'Variant Requires Shipping',
  'Variant Taxable',
  'Status',
];

function html(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
function cell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

const rows = products.map((product) => [
  product.handle,
  product.name,
  `<p>${html(product.description)}</p><p>DeskLab portfolio demonstration product. Test orders only. No physical fulfillment.</p>`,
  'DeskLab',
  product.category,
  `desklab-demo,${product.category}`,
  'FALSE',
  'Title',
  'Default Title',
  `DESKLAB-${product.id.toUpperCase()}`,
  'shopify',
  product.available ? 20 : 0,
  'deny',
  'manual',
  (product.priceCents / 100).toFixed(2),
  'TRUE',
  'TRUE',
  'active',
]);

async function main() {
  await mkdir(dirname(output), {recursive: true});
  await writeFile(
    output,
    [headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') +
      '\r\n',
    'utf8',
  );
  console.log(`Wrote ${rows.length} original products to ${output}`);
  console.log(
    'CAD prices require a CAD store. Available products have 20 units; the two unavailable fixtures have zero. Online Store publication is disabled; publish to Headless after import.',
  );
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'CSV generation failed.',
  );
  process.exitCode = 1;
});
