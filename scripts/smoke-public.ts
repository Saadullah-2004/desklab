import {isIP} from 'node:net';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {products as originalProducts} from '../src/lib/catalog';
import {validateSelectedSetup} from '../src/lib/recommend';
import type {Preferences, Product} from '../src/lib/types';

export class SmokeError extends Error {}

const preferences: Preferences = {
  budgetCents: 100_000,
  deskWidthCm: 140,
  style: 'warm',
  quiet: true,
};

function requireCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new SmokeError(message);
}

export function publicOrigin(value: string | undefined): string {
  let parsed: URL;
  try {
    parsed = new URL(value?.trim() ?? '');
  } catch {
    throw new SmokeError(
      'Set APP_ORIGIN or --url to the canonical public HTTPS origin.',
    );
  }
  const host = parsed.hostname;
  requireCondition(
    parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname === '/' &&
      !parsed.search &&
      !parsed.hash &&
      !parsed.port &&
      host.includes('.') &&
      !isIP(host) &&
      !host.startsWith('[') &&
      !/(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(host),
    'The smoke target must be a public HTTPS origin without credentials, a port, path, query or fragment.',
  );
  return parsed.origin;
}

export function smokeTarget(
  args: string[],
  environment: Record<string, string | undefined>,
): string {
  let target = environment.APP_ORIGIN;
  let specified = false;
  for (let index = 0; index < args.length; index++) {
    requireCondition(!specified, 'Pass --url only once.');
    if (args[index] === '--url') {
      target = args[++index];
      requireCondition(Boolean(target), 'The --url option requires an origin.');
    } else if (args[index].startsWith('--url=')) {
      target = args[index].slice('--url='.length);
    } else {
      throw new SmokeError(
        'Usage: smoke-public.ts [--url https://your-public-host]',
      );
    }
    specified = true;
  }
  return publicOrigin(target);
}

function verifyHeaders(response: Response, label: string, api: boolean): void {
  const headers = response.headers;
  const policy = headers.get('content-security-policy') ?? '';
  requireCondition(
    headers.get('x-content-type-options') === 'nosniff' &&
      headers.get('x-frame-options')?.toUpperCase() === 'DENY' &&
      headers.get('referrer-policy') === 'no-referrer' &&
      /(?:^|;)\s*max-age=[1-9]\d*/i.test(
        headers.get('strict-transport-security') ?? '',
      ) &&
      /(?:^|;)\s*frame-ancestors 'none'(?:;|$)/.test(policy) &&
      /(?:^|;)\s*object-src 'none'(?:;|$)/.test(policy) &&
      /(?:^|;)\s*connect-src 'self'(?:;|$)/.test(policy) &&
      !policy.includes("'unsafe-eval'") &&
      !headers.has('x-powered-by'),
    `${label}: required production security headers are missing or invalid.`,
  );
  if (api)
    requireCondition(
      /(?:^|,)\s*no-store(?:,|$)/i.test(headers.get('cache-control') ?? ''),
      `${label}: API responses must use Cache-Control: no-store.`,
    );
}

function object(value: unknown, label: string): Record<string, unknown> {
  requireCondition(
    value && typeof value === 'object' && !Array.isArray(value),
    `${label}: expected a JSON object.`,
  );
  return value as Record<string, unknown>;
}

function catalogProducts(
  value: unknown,
  label: string,
  fullCatalog: boolean,
): Product[] {
  requireCondition(Array.isArray(value), `${label}: expected a product list.`);
  if (fullCatalog)
    requireCondition(
      value.length === originalProducts.length,
      `${label}: expected all 18 original products.`,
    );
  const ids = new Set<string>();
  for (const item of value) {
    const product = object(item, label);
    const original = originalProducts.find((entry) => entry.id === product.id);
    requireCondition(
      original && typeof product.id === 'string' && !ids.has(product.id),
      `${label}: product IDs must be known and unique.`,
    );
    ids.add(product.id);
    requireCondition(
      product.handle === original.handle &&
        product.category === original.category &&
        product.widthCm === original.widthCm &&
        product.depthCm === original.depthCm &&
        product.minDeskWidthCm === original.minDeskWidthCm &&
        product.quiet === original.quiet &&
        typeof product.available === 'boolean' &&
        product.currency === 'CAD' &&
        typeof product.priceCents === 'number' &&
        Number.isSafeInteger(product.priceCents) &&
        product.priceCents >= 0 &&
        typeof product.shopifyVariantId === 'string' &&
        /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(product.shopifyVariantId),
      `${label}: invalid product specifications or live CAD variant data.`,
    );
  }
  return value as Product[];
}

export async function smokePublic(
  target: string,
  fetcher: typeof fetch = fetch,
): Promise<{checks: string[]; productCount: number; checkoutEnabled: boolean}> {
  const origin = publicOrigin(target);
  const checks: string[] = [];

  async function read(
    path: string,
    label: string,
    body?: unknown,
  ): Promise<string> {
    let response: Response;
    try {
      response = await fetcher(new URL(path, origin), {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Origin: origin,
          ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new SmokeError(`${label}: request failed or timed out.`);
    }
    requireCondition(
      response.status === 200,
      `${label}: expected HTTP 200, received ${response.status}. Check deployment readiness and the canonical origin.`,
    );
    requireCondition(
      !response.redirected &&
        (!response.url || new URL(response.url).origin === origin),
      `${label}: unexpected redirect or response origin.`,
    );
    verifyHeaders(response, label, path.startsWith('/api/'));
    const contentType = response.headers.get('content-type') ?? '';
    requireCondition(
      contentType.startsWith(path === '/' ? 'text/html' : 'application/json'),
      `${label}: unexpected response content type.`,
    );
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new SmokeError(`${label}: the response body could not be read.`);
    }
    requireCondition(
      text.length <= 2_000_000,
      `${label}: response exceeded the smoke check size limit.`,
    );
    return text;
  }

  async function json(path: string, label: string, body?: unknown) {
    const text = await read(path, label, body);
    try {
      return object(JSON.parse(text), label);
    } catch (error) {
      if (error instanceof SmokeError) throw error;
      throw new SmokeError(`${label}: response was not valid JSON.`);
    }
  }

  const homepage = await read('/', 'Homepage');
  requireCondition(
    /<title>DeskLab\s*\|/i.test(homepage),
    'Homepage: DeskLab page title was not found.',
  );
  checks.push('Homepage and production headers');

  const health = await json('/api/health', 'Health');
  requireCondition(health.status === 'ok', 'Health: deployment is not ready.');
  checks.push('Health readiness');

  const catalog = await json('/api/catalog', 'Catalog');
  requireCondition(
    catalog.source === 'shopify' &&
      typeof catalog.checkoutEnabled === 'boolean',
    'Catalog: expected a connected Shopify catalog.',
  );
  const products = catalogProducts(catalog.products, 'Catalog', true);
  checks.push('18 live Shopify products');

  // Empty input returns before provider/key/allowance checks in interpretBrief.
  // This verifies the real planner and catalog without reserving AI tokens.
  const recommendation = await json('/api/recommend', 'Recommendation', {
    brief: '',
    preferences,
  });
  requireCondition(
    recommendation.engine === 'rules' &&
      recommendation.catalogSource === 'shopify' &&
      recommendation.feasible === true,
    'Recommendation: expected a feasible Shopify setup using the rule engine.',
  );
  const returnedPreferences = object(
    recommendation.preferences,
    'Recommendation preferences',
  );
  requireCondition(
    Object.entries(preferences).every(
      ([key, value]) => returnedPreferences[key] === value,
    ),
    'Recommendation: preferences changed despite an empty brief.',
  );
  const snapshot = catalogProducts(
    recommendation.catalogSnapshot,
    'Recommendation catalog',
    true,
  );
  const selected = catalogProducts(
    recommendation.products,
    'Recommendation products',
    false,
  );
  requireCondition(
    selected.every((product) => {
      const current = snapshot.find((entry) => entry.id === product.id);
      return (
        current &&
        current.available === product.available &&
        current.priceCents === product.priceCents &&
        current.shopifyVariantId === product.shopifyVariantId
      );
    }),
    'Recommendation: selected products differ from the live catalog snapshot.',
  );
  requireCondition(
    validateSelectedSetup(selected, preferences).valid &&
      recommendation.totalCents ===
        selected.reduce((sum, product) => sum + product.priceCents, 0),
    'Recommendation: budget, fit, availability or total validation failed.',
  );
  checks.push('Feasible setup with empty brief and no AI request');
  return {
    checks,
    productCount: products.length,
    checkoutEnabled: catalog.checkoutEnabled,
  };
}

async function main() {
  const report = await smokePublic(
    smokeTarget(process.argv.slice(2), process.env),
  );
  for (const check of report.checks) console.log(`PASS ${check}`);
  console.log(
    `Test checkout flag: ${report.checkoutEnabled ? 'enabled' : 'disabled'}. No cart or order was created.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof SmokeError
        ? error.message
        : 'Deployment smoke failed. No upstream response details were logged.',
    );
    process.exitCode = 1;
  });
}
