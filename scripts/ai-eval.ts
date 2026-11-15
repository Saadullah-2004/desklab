import {mkdir, writeFile} from 'node:fs/promises';
import {setTimeout as wait} from 'node:timers/promises';
import {FREE_TIER_MODEL, interpretBrief} from '../src/lib/ai';
import {products} from '../src/lib/catalog';
import {recommendSetup, validateSelectedSetup} from '../src/lib/recommend';
import {aiEvaluationCases} from './ai-eval-cases';
import type {Preferences} from '../src/lib/types';

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  if (args.some((arg) => arg !== '--live' && !/^--limit=\d+$/.test(arg)))
    throw new Error('Usage: ai-eval.ts [--live] [--limit=1..12]');
  if (args.filter((arg) => arg.startsWith('--limit=')).length > 1)
    throw new Error('Provide --limit only once.');
  const limit = Number(
    args.find((arg) => arg.startsWith('--limit='))?.slice(8) ?? 12,
  );
  if (!Number.isInteger(limit) || limit < 1 || limit > 12)
    throw new Error('The evaluation limit must be between 1 and 12 cases.');

  if (live) {
    const missing = [
      'GEMINI_API_KEY',
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
    ].filter((name) => !process.env[name]);
    if (
      process.env.ENABLE_LIVE_AI !== 'true' ||
      process.env.GEMINI_FREE_TIER_CONFIRMED !== 'true' ||
      missing.length > 0 ||
      (process.env.GEMINI_MODEL && process.env.GEMINI_MODEL !== FREE_TIER_MODEL)
    )
      throw new Error(
        'Live evaluation requires ENABLE_LIVE_AI=true, GEMINI_FREE_TIER_CONFIRMED=true, a verified free-project GEMINI_API_KEY, the reviewed model, and the shared Upstash allowance. No requests were sent.',
      );
  } else {
    // An ordinary local/CI invocation cannot use credentials accidentally.
    process.env.ENABLE_LIVE_AI = 'false';
  }

  const cases = aiEvaluationCases.slice(0, limit);
  const fields: (keyof Preferences)[] = [
    'budgetCents',
    'deskWidthCm',
    'style',
    'quiet',
  ];
  const rows = [];
  console.log(
    live
      ? `Live evaluation: at most ${cases.length} model requests, 15 seconds apart, with no retries. Uses the existing shared 5/minute and 50/UTC-day allowance.`
      : 'Offline rules baseline: no provider or Redis calls. This does not verify live AI.',
  );
  for (const [index, fixture] of cases.entries()) {
    if (live && index > 0) await wait(15_000);
    const started = performance.now();
    const interpreted = await interpretBrief(fixture.brief, fixture.defaults);
    const latencyMs = Math.round(performance.now() - started);
    const recommendation = recommendSetup(interpreted.preferences, products);
    const mismatchedFields = fields.filter(
      (field) => interpreted.preferences[field] !== fixture.expected[field],
    );
    const constraintsValid =
      recommendation.totalCents ===
        recommendation.products.reduce(
          (total, product) => total + product.priceCents,
          0,
        ) &&
      recommendation.totalCents <= interpreted.preferences.budgetCents &&
      recommendation.products.every(
        (product) => products.includes(product) && product.available,
      ) &&
      (recommendation.feasible
        ? validateSelectedSetup(
            recommendation.products,
            interpreted.preferences,
          ).valid
        : recommendation.products.length === 0 &&
          recommendation.totalCents === 0);
    rows.push({
      id: fixture.id,
      engine: interpreted.engine,
      latencyMs,
      expected: fixture.expected,
      actual: interpreted.preferences,
      exactMatch: mismatchedFields.length === 0,
      mismatchedFields,
      constraintsValid,
      feasible: recommendation.feasible,
      totalCents: recommendation.totalCents,
      productIds: recommendation.products.map((product) => product.id),
    });
    console.log(
      `${fixture.id}: engine=${interpreted.engine}, exact=${mismatchedFields.length === 0}, constraints=${constraintsValid}`,
    );
  }

  const geminiSuccesses = rows.filter((row) => row.engine === 'gemini').length;
  const exactMatches = rows.filter((row) => row.exactMatch).length;
  const constraintPasses = rows.filter((row) => row.constraintsValid).length;
  const timestamp = new Date().toISOString();
  const report = {
    timestamp,
    mode: live ? 'live-provider' : 'offline-rules-baseline',
    model: live ? FREE_TIER_MODEL : null,
    catalog: 'fictional demo catalog; no Shopify checkout exercised',
    fixtureCount: rows.length,
    geminiSuccesses,
    rulesResults: rows.length - geminiSuccesses,
    liveFallbacks: live ? rows.length - geminiSuccesses : 0,
    exactMatches,
    exactMatchRate: exactMatches / rows.length,
    fieldMatchRate:
      1 -
      rows.reduce((total, row) => total + row.mismatchedFields.length, 0) /
        (rows.length * fields.length),
    constraintPasses,
    rows,
  };
  await mkdir('artifacts', {recursive: true});
  const path = `artifacts/ai-eval-${live ? 'live' : 'rules'}-${timestamp.replaceAll(':', '-')}.json`;
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, {flag: 'wx'});
  console.log(
    `Exact preference matches: ${exactMatches}/${rows.length}. Constraint checks: ${constraintPasses}/${rows.length}. Gemini successes: ${geminiSuccesses}/${rows.length}. Report: ${path}`,
  );
  if (
    constraintPasses !== rows.length ||
    (live && (geminiSuccesses !== rows.length || exactMatches !== rows.length))
  )
    process.exitCode = 1;
}

main().catch((error: unknown) => {
  // Only our own setup errors are printed. Provider errors stay inside interpretBrief.
  console.error(error instanceof Error ? error.message : 'Evaluation failed.');
  process.exitCode = 1;
});
