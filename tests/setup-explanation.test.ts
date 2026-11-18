import assert from 'node:assert/strict';
import test from 'node:test';
import {getProduct, products} from '../src/lib/catalog';
import {
  decodeSharedConfiguration,
  encodeConfiguration,
} from '../src/lib/configuration';
import {evaluateSelectedSetup, recommendSetup} from '../src/lib/recommend';
import type {Preferences, Product} from '../src/lib/types';

const preferences: Preferences = {
  budgetCents: 65000,
  deskWidthCm: 140,
  style: 'warm',
  quiet: true,
};
const product = (handle: string): Product => {
  const found = getProduct(handle);
  assert.ok(found);
  return found;
};
const essentials = [
  product('form-desk-chalk'),
  product('hush-keyboard-chalk'),
  product('column-light-chalk'),
];

test('recommended and current-selection explanations share verified budget, space, fit and palette facts', () => {
  const recommendation = recommendSetup(preferences);
  const evaluation = evaluateSelectedSetup(
    recommendation.products,
    preferences,
  );
  assert.equal(evaluation.valid, true);
  assert.deepEqual(evaluation.reasons, recommendation.reasons);
  assert.deepEqual(evaluation.compromises, recommendation.warnings);
  assert.deepEqual(evaluation.warnings, []);
  assert.deepEqual(evaluation.compromises, []);
  const explanation = evaluation.reasons.join(' ');
  assert.match(explanation, /\$540.*\$650.*before tax and shipping/);
  assert.match(explanation, /120 cm desk.*140 cm space/);
  assert.match(explanation, /120 × 60 cm.*two rows with 4 cm clearance/);
  assert.match(explanation, /keyboard is marked quiet in the catalog/);
  assert.match(explanation, /5 of 5 pieces match your warm palette/);
});

test('manual choices and changed preferences produce current facts and factual compromises', () => {
  const warm = evaluateSelectedSetup(essentials, preferences);
  assert.equal(warm.valid, true);
  assert.match(warm.reasons.join(' '), /\$377.*\$650/);
  assert.match(warm.reasons.join(' '), /100 cm desk.*140 cm space/);
  assert.match(warm.reasons.join(' '), /0 of 3 pieces match your warm palette/);
  assert.equal(warm.compromises.length, 3);
  assert.match(warm.compromises.join(' '), /outside your preferred palette/);
  assert.match(warm.compromises.join(' '), /optional shelf/);
  assert.match(warm.compromises.join(' '), /optional accessory/);
  // A manual omission is a fact. The planner cannot infer the shopper's reason.
  assert.doesNotMatch(warm.compromises.join(' '), /stock|budget|limits/);

  const minimal = evaluateSelectedSetup(essentials, {
    budgetCents: 37700,
    deskWidthCm: 100,
    style: 'minimal',
    quiet: false,
  });
  assert.equal(minimal.valid, true);
  assert.match(minimal.reasons.join(' '), /\$377.*\$377/);
  assert.match(minimal.reasons.join(' '), /100 cm desk.*100 cm space/);
  assert.match(minimal.reasons.join(' '), /3 of 3 pieces.*minimal/);
  assert.doesNotMatch(minimal.reasons.join(' '), /quiet/);
  assert.equal(minimal.compromises.length, 2);
});

test('invalid or changed selections replace fit reassurance with actionable warnings', () => {
  const cases: {
    selected: Product[];
    preferences: Preferences;
    warning: RegExp;
  }[] = [
    {
      selected: essentials,
      preferences: {...preferences, budgetCents: 37699},
      warning: /over budget/,
    },
    {
      selected: essentials,
      preferences: {...preferences, deskWidthCm: 99},
      warning: /wider than/,
    },
    {
      selected: essentials.slice(1),
      preferences,
      warning: /complete your setup/,
    },
    {selected: [], preferences, warning: /complete your setup/},
    {
      selected: [...essentials, product('rise-shelf-carbon')],
      preferences,
      warning: /do not fit/,
    },
    {
      selected: essentials.map((item) =>
        item.category === 'keyboard' ? product('relay-keyboard-carbon') : item,
      ),
      preferences,
      warning: /quiet keyboard/,
    },
    {
      selected: essentials.map((item) =>
        item.category === 'desk' ? {...item, available: false} : item,
      ),
      preferences,
      warning: /unavailable/,
    },
    {
      selected: essentials,
      preferences: {...preferences, budgetCents: NaN},
      warning: /valid budget/,
    },
  ];
  for (const current of cases) {
    const evaluation = evaluateSelectedSetup(
      current.selected,
      current.preferences,
    );
    assert.equal(evaluation.valid, false);
    assert.deepEqual(evaluation.reasons, []);
    assert.match(evaluation.warnings.join(' '), current.warning);
  }
});

test('shared setups explain restored preferences and current catalog prices, not saved recommendation text', () => {
  const savedPreferences: Preferences = {
    budgetCents: 50000,
    deskWidthCm: 120,
    style: 'minimal',
    quiet: true,
  };
  const encoded = encodeConfiguration(
    essentials.map((item) => ({productId: item.id, quantity: 1})),
    savedPreferences,
  );
  const shared = decodeSharedConfiguration(encoded);
  assert.equal(shared?.version, 2);
  if (!shared || shared.version !== 2)
    throw Error('Expected restored preferences');
  const selected = shared.lines.map((line) => {
    const current = products.find((item) => item.id === line.productId)!;
    return current.category === 'desk'
      ? {...current, priceCents: 23900}
      : current;
  });
  const evaluation = evaluateSelectedSetup(selected, shared.preferences);
  assert.equal(evaluation.valid, true);
  assert.match(evaluation.reasons.join(' '), /\$387.*\$500/);
  assert.match(evaluation.reasons.join(' '), /100 cm desk.*120 cm space/);
  assert.match(evaluation.reasons.join(' '), /3 of 3 pieces.*minimal/);
  assert.doesNotMatch(evaluation.reasons.join(' '), /\$377|warm/);
});
