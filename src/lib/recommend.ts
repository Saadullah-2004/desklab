import {formatMoney, products} from './catalog';
import type {Preferences, Product, Recommendation, Style} from './types';

const styles: Style[] = ['warm', 'minimal', 'studio'];
const styleWeights = {
  desk: 40,
  keyboard: 22,
  light: 16,
  shelf: 9,
  accessory: 7,
};
const gapCm = 4;

function validPreferences(preferences: Preferences): boolean {
  return (
    Number.isSafeInteger(preferences.budgetCents) &&
    preferences.budgetCents >= 0 &&
    Number.isFinite(preferences.deskWidthCm) &&
    preferences.deskWidthCm > 0 &&
    styles.includes(preferences.style) &&
    typeof preferences.quiet === 'boolean'
  );
}

function validProduct(product: Product): boolean {
  return (
    product.available &&
    Number.isSafeInteger(product.priceCents) &&
    product.priceCents >= 0 &&
    product.currency === 'CAD' &&
    Number.isFinite(product.widthCm) &&
    product.widthCm > 0 &&
    Number.isFinite(product.depthCm) &&
    product.depthCm > 0 &&
    Number.isFinite(product.minDeskWidthCm) &&
    product.minDeskWidthCm >= 0
  );
}

// Fixed, non-overlapping two-row layout: shelf + lamp behind keyboard + accessory.
// The planner checks only these published footprints, not ergonomics or load ratings.
function fits(
  desk: Product,
  keyboard: Product,
  light: Product,
  shelf?: Product,
  accessory?: Product,
): boolean {
  const tabletop = [keyboard, light, shelf, accessory].filter(
    (product): product is Product => Boolean(product),
  );
  if (tabletop.some((product) => product.minDeskWidthCm > desk.widthCm))
    return false;
  const rearWidth = light.widthCm + (shelf ? shelf.widthCm + gapCm : 0);
  const frontWidth =
    keyboard.widthCm + (accessory ? accessory.widthCm + gapCm : 0);
  const depth =
    Math.max(light.depthCm, shelf?.depthCm ?? 0) +
    gapCm +
    Math.max(keyboard.depthCm, accessory?.depthCm ?? 0);
  return (
    rearWidth <= desk.widthCm &&
    frontWidth <= desk.widthCm &&
    depth <= desk.depthCm
  );
}

export function validateSelectedSetup(
  selected: Product[],
  preferences: Preferences,
): {valid: boolean; warnings: string[]} {
  const warnings: string[] = [];
  if (!validPreferences(preferences))
    warnings.push('Choose a valid budget, desk width and style.');
  if (selected.some((product) => !validProduct(product)))
    warnings.push(
      'A selected piece is unavailable or has invalid catalog data.',
    );
  if (
    new Set(selected.map((product) => product.category)).size !==
    selected.length
  )
    warnings.push('Choose only one piece from each category.');
  const desk = selected.find((product) => product.category === 'desk');
  const keyboard = selected.find((product) => product.category === 'keyboard');
  const light = selected.find((product) => product.category === 'light');
  if (!desk || !keyboard || !light)
    warnings.push('Add a desk, keyboard and light to complete your setup.');
  if (desk && desk.widthCm > preferences.deskWidthCm)
    warnings.push('The selected desk is wider than your available space.');
  if (keyboard && preferences.quiet && !keyboard.quiet)
    warnings.push('Choose a quiet keyboard to match your preference.');
  if (
    desk &&
    keyboard &&
    light &&
    !fits(
      desk,
      keyboard,
      light,
      selected.find((p) => p.category === 'shelf'),
      selected.find((p) => p.category === 'accessory'),
    )
  )
    warnings.push(
      'These pieces do not fit the selected desk. Try a smaller shelf or a wider desk.',
    );
  const total = selected.reduce((sum, product) => sum + product.priceCents, 0);
  if (!Number.isSafeInteger(total) || total > preferences.budgetCents)
    warnings.push(
      'Your selection is over budget. Swap a piece or increase your budget.',
    );
  return {valid: warnings.length === 0, warnings};
}

export function recommendSetup(
  preferences: Preferences,
  catalog: Product[] = products,
): Recommendation {
  const result: Recommendation = {
    products: [],
    totalCents: 0,
    preferences: {...preferences},
    reasons: [],
    warnings: [],
    feasible: false,
  };
  if (!validPreferences(preferences)) {
    result.warnings.push(
      'Choose a non-negative budget, a positive desk width, and a supported style.',
    );
    return result;
  }
  const available = catalog.filter(validProduct);
  const desks = available.filter(
    (product) =>
      product.category === 'desk' && product.widthCm <= preferences.deskWidthCm,
  );
  const keyboards = available.filter(
    (product) =>
      product.category === 'keyboard' && (!preferences.quiet || product.quiet),
  );
  const lights = available.filter((product) => product.category === 'light');
  const shelves = [
    undefined,
    ...available.filter((product) => product.category === 'shelf'),
  ];
  const accessories = [
    undefined,
    ...available.filter((product) => product.category === 'accessory'),
  ];
  let bestScore = -1;
  let physicallyPossible = false;
  let minimumRequiredCost = Infinity;

  for (const desk of desks)
    for (const keyboard of keyboards)
      for (const light of lights) {
        if (!fits(desk, keyboard, light)) continue;
        physicallyPossible = true;
        minimumRequiredCost = Math.min(
          minimumRequiredCost,
          desk.priceCents + keyboard.priceCents + light.priceCents,
        );
        for (const shelf of shelves)
          for (const accessory of accessories) {
            if (!fits(desk, keyboard, light, shelf, accessory)) continue;
            const selected = [desk, shelf, keyboard, light, accessory].filter(
              (product): product is Product => Boolean(product),
            );
            const totalCents = selected.reduce(
              (total, product) => total + product.priceCents,
              0,
            );
            if (!validateSelectedSetup(selected, preferences).valid) continue;
            const score =
              selected.reduce(
                (total, product) =>
                  total +
                  (product.styles.includes(preferences.style)
                    ? styleWeights[product.category]
                    : 0),
                0,
              ) +
              (shelf ? 2 : 0) +
              (accessory ? 1 : 0);
            // Equal style/coverage scores prefer the less expensive setup. A final ID
            // tie-break makes results independent of the catalog's input ordering.
            const tieKey = selected.map((product) => product.id).join('|');
            const bestTieKey = result.products
              .map((product) => product.id)
              .join('|');
            if (
              score > bestScore ||
              (score === bestScore &&
                (totalCents < result.totalCents ||
                  (totalCents === result.totalCents && tieKey < bestTieKey)))
            ) {
              bestScore = score;
              result.products = selected;
              result.totalCents = totalCents;
              result.feasible = true;
            }
          }
      }

  if (!result.feasible) {
    if (!desks.length)
      result.warnings.push(
        'No available desk fits the requested width. Increase the available space or try again when stock changes.',
      );
    if (!keyboards.length)
      result.warnings.push(
        preferences.quiet
          ? 'No available quiet keyboard meets this request.'
          : 'No keyboard is currently available.',
      );
    if (!lights.length)
      result.warnings.push('No task light is currently available.');
    if (physicallyPossible)
      result.warnings.push(
        `The least expensive fitting desk, keyboard and light cost ${formatMoney(minimumRequiredCost)} before tax and shipping. Increase your budget to build a complete setup.`,
      );
    else if (desks.length && keyboards.length && lights.length)
      result.warnings.push(
        'The available desk, keyboard and light cannot fit together in the planner layout.',
      );
    return result;
  }

  const desk = result.products.find((product) => product.category === 'desk')!;
  result.reasons.push(
    `${formatMoney(result.totalCents)} in products fits your ${formatMoney(preferences.budgetCents)} budget before tax and shipping.`,
  );
  result.reasons.push(
    `The ${desk.widthCm} cm desk fits within your ${preferences.deskWidthCm} cm space.`,
  );
  result.reasons.push(
    `Selected footprints fit the ${desk.widthCm} × ${desk.depthCm} cm desk in two rows with ${gapCm} cm clearance.`,
  );
  if (preferences.quiet)
    result.reasons.push(
      'The selected keyboard is marked quiet in the catalog.',
    );
  const matches = result.products.filter((product) =>
    product.styles.includes(preferences.style),
  ).length;
  result.reasons.push(
    `${matches} of ${result.products.length} pieces match your ${preferences.style} palette.`,
  );
  if (matches < result.products.length)
    result.warnings.push(
      'Some finishes were mixed to keep the setup available, within budget and within the fit limits.',
    );
  for (const category of ['shelf', 'accessory'] as const) {
    if (!result.products.some((product) => product.category === category))
      result.warnings.push(
        `An optional ${category} was left out to respect budget, fit or stock limits.`,
      );
  }
  return result;
}

function moneyToCents(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const amount = Number(value.replaceAll(',', ''));
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : undefined;
}

// Transparent deterministic fallback for the documented keywords. The model
// integration can extract richer intent, but it must produce the same contract.
export function parseBrief(brief: string, defaults: Preferences): Preferences {
  const text = brief.slice(0, 5000).normalize('NFKC').toLowerCase();
  const amount = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)';
  // A sentence-ending period is punctuation; a separator followed by another
  // digit is still part of the amount and must not permit a partial match.
  const amountEnd = '(?!\\d|[.,]\\d)';
  const money =
    text.match(new RegExp(`(?:cad\\s*)?\\$\\s*${amount}${amountEnd}`)) ??
    text.match(
      new RegExp(`(?<![\\d.,])${amount}\\s*(?:cad|dollars?)(?!\\w)`),
    ) ??
    text.match(
      new RegExp(
        `(?:budget(?:\\s+of)?|under|below|less than|up to)\\s*${amount}${amountEnd}`,
      ),
    );
  const width = text.match(/\b(\d+(?:\.\d+)?)\s*(?:cm|centimet(?:er|re)s?)\b/);
  const widthCm = width ? Number(width[1]) : undefined;
  let style = defaults.style;
  if (/\b(?:warm|oak|walnut|wood|wooden|cozy|cosy)\b/.test(text))
    style = 'warm';
  else if (/\b(?:studio|carbon|graphite|industrial)\b/.test(text))
    style = 'studio';
  else if (/\b(?:minimal|minimalist|chalk|white|clean)\b/.test(text))
    style = 'minimal';
  let quiet = defaults.quiet;
  if (/\b(?:quiet|silent|silenced)\b/.test(text)) quiet = true;
  if (
    /\b(?:clicky|loud)\b/.test(text) ||
    /\b(?:not|no|don't need|do not need)\s+(?:a\s+)?(?:quiet|silent)\b/.test(
      text,
    )
  )
    quiet = false;
  return {
    budgetCents: moneyToCents(money?.[1]) ?? defaults.budgetCents,
    deskWidthCm:
      widthCm !== undefined && Number.isFinite(widthCm) && widthCm > 0
        ? widthCm
        : defaults.deskWidthCm,
    style,
    quiet,
  };
}
