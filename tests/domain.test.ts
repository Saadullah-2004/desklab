import assert from 'node:assert/strict';
import test from 'node:test';
import {formatMoney, getProduct, products} from '../src/lib/catalog';
import {
  configurationTotal,
  decodeConfiguration,
  decodeSharedConfiguration,
  encodeConfiguration,
  validateCartLines,
} from '../src/lib/configuration';
import {parseBrief, recommendSetup} from '../src/lib/recommend';
import type {Preferences, Product} from '../src/lib/types';

const warm: Preferences = {
  budgetCents: 60000,
  deskWidthCm: 120,
  style: 'warm',
  quiet: true,
};
const encodeRaw = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

test('catalog has 18 unique original products with integer CAD prices and resolvable handles', () => {
  assert.equal(products.length, 18);
  assert.equal(new Set(products.map((product) => product.id)).size, 18);
  assert.equal(new Set(products.map((product) => product.handle)).size, 18);
  for (const product of products) {
    assert.equal(getProduct(product.handle), product);
    assert.ok(Number.isSafeInteger(product.priceCents));
    assert.equal(product.currency, 'CAD');
    assert.ok(product.widthCm > 0 && product.depthCm > 0);
  }
  assert.equal(getProduct('does-not-exist'), undefined);
  assert.equal(formatMoney(54000), '$540');
  assert.equal(formatMoney(3499), '$34.99');
  assert.throws(() => formatMoney(12.5));
});

test('warm setup is complete, available, quiet and costs $540 before tax and shipping', () => {
  const result = recommendSetup(warm);
  assert.equal(result.feasible, true);
  assert.equal(result.totalCents, 54000);
  assert.deepEqual(
    result.products.map((product) => product.category),
    ['desk', 'shelf', 'keyboard', 'light', 'accessory'],
  );
  assert.ok(
    result.products.every(
      (product) => product.available && product.styles.includes('warm'),
    ),
  );
  assert.ok(
    result.products.find((product) => product.category === 'keyboard')!.quiet,
  );
  assert.equal(result.warnings.length, 0);
});

test('planner prioritizes required items over extras on a tight budget', () => {
  const result = recommendSetup({
    ...warm,
    budgetCents: 37700,
    style: 'minimal',
  });
  assert.equal(result.feasible, true);
  assert.equal(result.totalCents, 37700);
  assert.deepEqual(
    result.products.map((product) => product.category),
    ['desk', 'keyboard', 'light'],
  );
  assert.equal(result.warnings.length, 2);
});

test('insufficient budget never returns a partial setup as feasible', () => {
  const result = recommendSetup({...warm, budgetCents: 37699});
  assert.equal(result.feasible, false);
  assert.deepEqual(result.products, []);
  assert.match(result.warnings.join(' '), /least expensive.*\$377/);
});

test('unavailable required items and quiet requirements are respected', () => {
  const noLights = products.map((product) =>
    product.category === 'light' ? {...product, available: false} : product,
  );
  assert.equal(recommendSetup(warm, noLights).feasible, false);
  const onlyClicky = products.filter(
    (product) => product.category !== 'keyboard' || !product.quiet,
  );
  assert.equal(recommendSetup(warm, onlyClicky).feasible, false);
  assert.equal(
    recommendSetup({...warm, quiet: false}, onlyClicky).feasible,
    true,
  );
});

test('desk width and combined tabletop footprints are actual constraints', () => {
  assert.equal(recommendSetup({...warm, deskWidthCm: 99}).feasible, false);
  const shallow: Product[] = products.map((product) =>
    product.category === 'desk' ? {...product, depthCm: 20} : product,
  );
  const result = recommendSetup(warm, shallow);
  assert.equal(result.feasible, false);
  assert.match(result.warnings.join(' '), /cannot fit together/);
  const oversizedShelf = products.map((product) =>
    product.category === 'shelf' ? {...product, widthCm: 119} : product,
  );
  assert.equal(
    recommendSetup(warm, oversizedShelf).products.some(
      (product) => product.category === 'shelf',
    ),
    false,
  );
});

test('recommendations are deterministic across catalog order and exclude invalid price data', () => {
  const expected = recommendSetup(warm);
  assert.deepEqual(
    recommendSetup(warm, [...products].reverse()).products,
    expected.products,
  );
  const broken = products.map((product) =>
    product.category === 'desk' ? {...product, priceCents: NaN} : product,
  );
  assert.equal(recommendSetup(warm, broken).feasible, false);
  for (const invalid of [NaN, Infinity, -1, 100.5]) {
    assert.equal(
      recommendSetup({...warm, budgetCents: invalid}).feasible,
      false,
    );
  }
});

test('brief parser extracts supported budget, width, style and quiet preferences', () => {
  assert.deepEqual(
    parseBrief(
      'A warm minimal coding setup under $540 for a 120cm desk, with a quiet keyboard',
      warm,
    ),
    {...warm, budgetCents: 54000},
  );
  assert.deepEqual(
    parseBrief(
      'A studio with a clicky keyboard, CAD $1,200.50 and 140 centimetres',
      warm,
    ),
    {budgetCents: 120050, deskWidthCm: 140, style: 'studio', quiet: false},
  );
  assert.deepEqual(parseBrief('Minimal setup, 450 dollars, 100 cm', warm), {
    ...warm,
    budgetCents: 45000,
    deskWidthCm: 100,
    style: 'minimal',
  });
  assert.equal(parseBrief('budget 500, not quiet', warm).quiet, false);
  assert.equal(parseBrief('budget 500, not quiet', warm).budgetCents, 50000);
  assert.deepEqual(parseBrief('something nice', warm), warm);
  assert.equal(parseBrief('0 cm', warm).deskWidthCm, 120);
});

test('budget parsing accepts sentence punctuation without truncating malformed amounts', () => {
  for (const brief of [
    'A quiet complete setup under $250.',
    'under250.',
    'A budget of $250, please.',
  ]) {
    assert.equal(parseBrief(brief, warm).budgetCents, 25000, brief);
  }
  assert.equal(parseBrief('A setup under $250.50.', warm).budgetCents, 25050);
  assert.equal(parseBrief('Spend $1,250.50.', warm).budgetCents, 125050);
  for (const brief of [
    '$250.001',
    'under250.001',
    '$250.001 dollars',
    '250.001 CAD',
    '$250,00',
  ]) {
    assert.equal(parseBrief(brief, warm).budgetCents, warm.budgetCents, brief);
  }
});

test('configuration round-trips IDs and quantities without storing prices', () => {
  const lines = [
    {productId: products[0].id, quantity: 1},
    {productId: products[6].id, quantity: 2},
  ];
  const encoded = encodeConfiguration(lines);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeConfiguration(encoded), lines);
  assert.equal(configurationTotal(lines), 47700);
  assert.deepEqual(decodeConfiguration(encodeConfiguration([])), []);
});

test('shared configurations reject tampering, unknown versions and external content', () => {
  const valid = {productId: products[0].id, quantity: 1};
  const invalidPayloads = [
    {v: 2, lines: [valid]},
    {v: 1, lines: [{...valid, productId: 'unknown-product'}]},
    {v: 1, lines: [{...valid, quantity: -1}]},
    {v: 1, lines: [{...valid, quantity: 0}]},
    {v: 1, lines: [{...valid, quantity: 1.5}]},
    {v: 1, lines: [{...valid, quantity: 11}]},
    {v: 1, lines: [{...valid, quantity: '1'}]},
    {v: 1, lines: [{...valid, priceCents: 1}]},
    {v: 1, lines: [valid, valid]},
    {v: 1, lines: [valid], redirectUrl: 'https://example.com'},
    {v: 1, lines: null},
    ['v', 1, 'lines', [valid]],
  ];
  for (const payload of invalidPayloads)
    assert.equal(decodeConfiguration(encodeRaw(payload)), null);
  for (const raw of [
    '',
    'https://example.com',
    'a'.repeat(8193),
    '____',
    'invalid=',
    '🚀',
  ])
    assert.equal(decodeConfiguration(raw), null);
  assert.equal(validateCartLines([{...valid, quantity: Infinity}]), null);
  assert.throws(() => encodeConfiguration([{...valid, quantity: 20}]));
  assert.throws(() =>
    configurationTotal([{productId: 'unknown', quantity: 1}]),
  );
});

test('saved unavailable catalog items remain identifiable for stock feedback', () => {
  const unavailable = products.find((product) => !product.available)!;
  const lines = [{productId: unavailable.id, quantity: 1}];
  assert.deepEqual(decodeConfiguration(encodeConfiguration(lines)), lines);
});

test('v2 shared configurations preserve exact budget, width, style and quiet preferences', () => {
  const preferences: Preferences = {
    budgetCents: 100000,
    deskWidthCm: 140,
    style: 'studio',
    quiet: false,
  };
  const setup = recommendSetup(preferences);
  assert.equal(setup.feasible, true);
  assert.equal(
    setup.products.find((product) => product.category === 'keyboard')!.quiet,
    false,
  );
  const lines = setup.products.map((product) => ({
    productId: product.id,
    quantity: 1,
  }));
  const encoded = encodeConfiguration(lines, preferences);
  assert.deepEqual(decodeSharedConfiguration(encoded), {
    version: 2,
    lines,
    preferences,
  });
  assert.deepEqual(decodeConfiguration(encoded), lines);
  const decoded = JSON.parse(
    Buffer.from(encoded, 'base64url').toString('utf8'),
  );
  assert.equal(decoded.v, 2);
  assert.deepEqual(Object.keys(decoded).sort(), ['lines', 'preferences', 'v']);
});

test('v1 shared links remain readable with an explicit absence of saved preferences', () => {
  const lines = [{productId: products[0].id, quantity: 1}];
  const encoded = encodeConfiguration(lines);
  assert.deepEqual(decodeSharedConfiguration(encoded), {version: 1, lines});
  assert.deepEqual(decodeConfiguration(encoded), lines);
});

test('v2 rejects malformed preferences, unknown keys and mixed version payloads', () => {
  const lines = [{productId: products[0].id, quantity: 1}];
  const invalidPreferences = [
    null,
    [],
    {},
    {...warm, budgetCents: 99},
    {...warm, budgetCents: 1000001},
    {...warm, budgetCents: 45000.5},
    {...warm, budgetCents: '60000'},
    {...warm, deskWidthCm: 59},
    {...warm, deskWidthCm: 301},
    {...warm, deskWidthCm: '120'},
    {...warm, style: 'unknown'},
    {...warm, quiet: 'false'},
    {...warm, redirect: 'https://example.com'},
  ];
  for (const preferences of invalidPreferences) {
    assert.equal(
      decodeSharedConfiguration(encodeRaw({v: 2, lines, preferences})),
      null,
    );
  }
  for (const payload of [
    {v: 2, lines},
    {v: 1, lines, preferences: warm},
    {v: 3, lines, preferences: warm},
    {v: 2, lines, preferences: warm, redirect: 'https://example.com'},
    {
      v: 2,
      lines: [{productId: 'unknown-product', quantity: 1}],
      preferences: warm,
    },
  ])
    assert.equal(decodeSharedConfiguration(encodeRaw(payload)), null);
  for (const preferences of [
    {...warm, deskWidthCm: Infinity},
    {...warm, budgetCents: NaN},
  ]) {
    assert.throws(() => encodeConfiguration(lines, preferences));
  }
});
