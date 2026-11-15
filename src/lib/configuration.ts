import {products} from './catalog';
import type {CartLine, Preferences} from './types';

export type SharedConfiguration =
  | {version: 1; lines: CartLine[]; preferences?: never}
  | {version: 2; lines: CartLine[]; preferences: Preferences};

const maxQuantity = 10;
const maxEncodedLength = 8192;
const productById = new Map(products.map((product) => [product.id, product]));

function exactKeys(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}

export function validateCartLines(input: unknown): CartLine[] | null {
  if (!Array.isArray(input) || input.length > products.length) return null;
  const seen = new Set<string>();
  const lines: CartLine[] = [];
  for (const item of input) {
    if (
      !exactKeys(item, ['productId', 'quantity']) ||
      typeof item.productId !== 'string' ||
      !productById.has(item.productId) ||
      seen.has(item.productId) ||
      typeof item.quantity !== 'number' ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > maxQuantity
    )
      return null;
    seen.add(item.productId);
    lines.push({productId: item.productId, quantity: item.quantity});
  }
  return lines;
}

function validateSharedPreferences(input: unknown): Preferences | null {
  if (
    !exactKeys(input, ['budgetCents', 'deskWidthCm', 'style', 'quiet']) ||
    typeof input.budgetCents !== 'number' ||
    !Number.isSafeInteger(input.budgetCents) ||
    input.budgetCents < 100 ||
    input.budgetCents > 1_000_000 ||
    typeof input.deskWidthCm !== 'number' ||
    !Number.isFinite(input.deskWidthCm) ||
    input.deskWidthCm < 60 ||
    input.deskWidthCm > 300 ||
    (input.style !== 'warm' &&
      input.style !== 'minimal' &&
      input.style !== 'studio') ||
    typeof input.quiet !== 'boolean'
  )
    return null;
  return {
    budgetCents: input.budgetCents,
    deskWidthCm: input.deskWidthCm,
    style: input.style,
    quiet: input.quiet,
  };
}

export function encodeConfiguration(
  lines: CartLine[],
  preferences?: Preferences,
): string {
  const validated = validateCartLines(lines);
  if (validated === null)
    throw new TypeError(
      'The configuration contains invalid products or quantities.',
    );
  const validatedPreferences =
    preferences === undefined
      ? undefined
      : validateSharedPreferences(preferences);
  if (validatedPreferences === null)
    throw new TypeError('The configuration contains invalid preferences.');
  // Catalog IDs are ASCII. No customer details, free text, secrets or URLs are serialized.
  const payload = validatedPreferences
    ? {v: 2, lines: validated, preferences: validatedPreferences}
    : {v: 1, lines: validated};
  return btoa(JSON.stringify(payload))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

export function decodeSharedConfiguration(
  encoded: string,
): SharedConfiguration | null {
  if (
    !encoded ||
    encoded.length > maxEncodedLength ||
    !/^[A-Za-z0-9_-]+$/.test(encoded)
  )
    return null;
  try {
    const decoded: unknown = JSON.parse(
      atob(encoded.replaceAll('-', '+').replaceAll('_', '/')),
    );
    if (
      !exactKeys(decoded, ['v', 'lines']) &&
      !exactKeys(decoded, ['v', 'lines', 'preferences'])
    )
      return null;
    const lines = validateCartLines(decoded.lines);
    if (lines === null) return null;
    if (decoded.v === 1 && exactKeys(decoded, ['v', 'lines'])) {
      return encodeConfiguration(lines) === encoded
        ? {version: 1, lines}
        : null;
    }
    if (decoded.v === 2 && exactKeys(decoded, ['v', 'lines', 'preferences'])) {
      const preferences = validateSharedPreferences(decoded.preferences);
      return preferences && encodeConfiguration(lines, preferences) === encoded
        ? {version: 2, lines, preferences}
        : null;
    }
    return null;
  } catch {
    return null;
  }
}

// Kept for callers that only need merchandise, including existing v1 links.
export function decodeConfiguration(encoded: string): CartLine[] | null {
  return decodeSharedConfiguration(encoded)?.lines ?? null;
}

export function configurationTotal(lines: CartLine[]): number {
  const validated = validateCartLines(lines);
  if (validated === null)
    throw new TypeError('Cannot price an invalid configuration.');
  return validated.reduce(
    (total, line) =>
      total + productById.get(line.productId)!.priceCents * line.quantity,
    0,
  );
}
