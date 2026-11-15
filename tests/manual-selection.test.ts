import assert from 'node:assert/strict';
import test from 'node:test';
import {getProduct} from '../src/lib/catalog';
import {recommendSetup, validateSelectedSetup} from '../src/lib/recommend';
import type {Preferences, Product} from '../src/lib/types';

const preferences: Preferences = {
  budgetCents: 100000,
  deskWidthCm: 140,
  style: 'warm',
  quiet: true,
};
const product = (handle: string): Product => {
  const found = getProduct(handle);
  assert.ok(found, `Missing test catalog product ${handle}`);
  return found;
};
const essentials = [
  product('form-desk-chalk'),
  product('hush-keyboard-chalk'),
  product('column-light-chalk'),
];

test('manual setup accepts a complete fitting selection and swapping within constraints', () => {
  assert.deepEqual(validateSelectedSetup(essentials, preferences), {
    valid: true,
    warnings: [],
  });
  const swapped = [
    product('arc-desk-oak'),
    product('hush-keyboard-sand'),
    product('orbit-light-cream'),
    product('rise-shelf-oak'),
    product('tidy-tray-oak'),
  ];
  assert.deepEqual(validateSelectedSetup(swapped, preferences), {
    valid: true,
    warnings: [],
  });
  assert.equal(
    swapped.reduce((total, item) => total + item.priceCents, 0),
    54000,
  );
});

test('manual swaps check the selected 100 cm desk, not the available 140 cm space', () => {
  const selected = [
    product('form-desk-chalk'),
    product('hush-keyboard-chalk'),
    product('focus-light-carbon'),
    product('rise-shelf-carbon'),
  ];
  const result = validateSelectedSetup(selected, preferences);
  assert.equal(result.valid, false);
  assert.match(result.warnings.join(' '), /do not fit the selected desk/);
  const largerDesk = selected.map((item) =>
    item.category === 'desk' ? product('grid-desk-carbon') : item,
  );
  assert.equal(validateSelectedSetup(largerDesk, preferences).valid, true);
});

test('combined footprints and clearances matter even when individual pieces fit', () => {
  const selected = [
    product('form-desk-chalk'),
    product('hush-keyboard-chalk'),
    product('focus-light-carbon'),
    {...product('rise-shelf-carbon'), minDeskWidthCm: 0},
  ];
  // 90 cm shelf + 18 cm lamp + 4 cm clearance exceeds the chosen 100 cm desk.
  assert.equal(validateSelectedSetup(selected, preferences).valid, false);
  const exactFit = selected.map((item) =>
    item.category === 'shelf' ? {...item, widthCm: 78} : item,
  );
  assert.equal(validateSelectedSetup(exactFit, preferences).valid, true);
  const tooWide = exactFit.map((item) =>
    item.category === 'shelf' ? {...item, widthCm: 78.1} : item,
  );
  assert.equal(validateSelectedSetup(tooWide, preferences).valid, false);
});

test('front row and two-row depth are validated for manual additions', () => {
  const base = [...essentials, {...product('tidy-tray-oak'), widthCm: 67}];
  // 30 cm keyboard + 67 cm accessory + 4 cm clearance is wider than Form.
  assert.equal(validateSelectedSetup(base, preferences).valid, false);
  const justFitsWidth = base.map((item) =>
    item.category === 'accessory' ? {...item, widthCm: 66} : item,
  );
  assert.equal(validateSelectedSetup(justFitsWidth, preferences).valid, true);
  const shallowDesk = essentials.map((item) =>
    item.category === 'desk' ? {...item, depthCm: 29} : item,
  );
  // 14 cm lamp + 12 cm keyboard + 4 cm gap needs 30 cm of depth.
  assert.equal(validateSelectedSetup(shallowDesk, preferences).valid, false);
  const exactDepth = shallowDesk.map((item) =>
    item.category === 'desk' ? {...item, depthCm: 30} : item,
  );
  assert.equal(validateSelectedSetup(exactDepth, preferences).valid, true);
});

test('removing any essential piece makes the manual setup incomplete', () => {
  for (const category of ['desk', 'keyboard', 'light']) {
    const result = validateSelectedSetup(
      essentials.filter((item) => item.category !== category),
      preferences,
    );
    assert.equal(result.valid, false);
    assert.match(result.warnings.join(' '), /desk, keyboard and light/);
  }
  assert.equal(validateSelectedSetup([], preferences).valid, false);
});

test('duplicate products and different products in the same category are rejected', () => {
  for (const extra of [essentials[1], product('hush-keyboard-sand')]) {
    const result = validateSelectedSetup([...essentials, extra], preferences);
    assert.equal(result.valid, false);
    assert.match(
      result.warnings.join(' '),
      /only one piece from each category/,
    );
  }
});

test('manual keyboard changes respect quiet preference', () => {
  const clicky = essentials.map((item) =>
    item.category === 'keyboard' ? product('relay-keyboard-carbon') : item,
  );
  const quietResult = validateSelectedSetup(clicky, preferences);
  assert.equal(quietResult.valid, false);
  assert.match(quietResult.warnings.join(' '), /quiet keyboard/);
  assert.equal(
    validateSelectedSetup(clicky, {...preferences, quiet: false}).valid,
    true,
  );
});

test('manual changes respect stock, budget and available room width', () => {
  const outOfStock = essentials.map((item) =>
    item.category === 'keyboard' ? product('pulse-keyboard-moss') : item,
  );
  assert.equal(validateSelectedSetup(outOfStock, preferences).valid, false);
  assert.match(
    validateSelectedSetup(outOfStock, preferences).warnings.join(' '),
    /unavailable/,
  );
  assert.equal(
    validateSelectedSetup(essentials, {...preferences, budgetCents: 37700})
      .valid,
    true,
  );
  assert.equal(
    validateSelectedSetup(essentials, {...preferences, budgetCents: 37699})
      .valid,
    false,
  );
  assert.equal(
    validateSelectedSetup(essentials, {...preferences, deskWidthCm: 99}).valid,
    false,
  );
  assert.match(
    validateSelectedSetup(essentials, {
      ...preferences,
      deskWidthCm: 99,
    }).warnings.join(' '),
    /wider than/,
  );
});

test('invalid catalog prices and preferences cannot receive a valid setup result', () => {
  for (const priceCents of [NaN, Infinity, -1, 100.5]) {
    const invalidPrice = essentials.map((item, index) =>
      index === 0 ? {...item, priceCents} : item,
    );
    assert.equal(validateSelectedSetup(invalidPrice, preferences).valid, false);
  }
  for (const budgetCents of [NaN, Infinity, -1, 100.5]) {
    assert.equal(
      validateSelectedSetup(essentials, {...preferences, budgetCents}).valid,
      false,
    );
  }
  for (const deskWidthCm of [NaN, Infinity, -1, 0]) {
    assert.equal(
      validateSelectedSetup(essentials, {...preferences, deskWidthCm}).valid,
      false,
    );
  }
});

test('recommended setups satisfy the same manual-selection contract across preference combinations', () => {
  for (const style of ['warm', 'minimal', 'studio'] as const) {
    for (const deskWidthCm of [100, 120, 140]) {
      for (const budgetCents of [37699, 37700, 45000, 60000, 100000]) {
        for (const quiet of [true, false]) {
          const current = {
            ...preferences,
            style,
            deskWidthCm,
            budgetCents,
            quiet,
          };
          const recommendation = recommendSetup(current);
          if (recommendation.feasible) {
            assert.equal(
              validateSelectedSetup(recommendation.products, current).valid,
              true,
            );
            assert.ok(recommendation.totalCents <= budgetCents);
          } else {
            assert.deepEqual(recommendation.products, []);
            assert.equal(
              validateSelectedSetup(recommendation.products, current).valid,
              false,
            );
          }
        }
      }
    }
  }
});
