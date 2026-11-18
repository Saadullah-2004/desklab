# Builder correctness and Redis integration checks

Verified locally on November 18, 2026 with Node.js 24.22.3 and Redis 7.2.17. This records bounded development checks, not production scale or an uptime measurement.

## Builder behavior

A recommendation belongs to the inputs at the time it was requested. Editing the brief, budget, width, palette, quiet preference or a selected product now invalidates that request and cancels its transport. A revision check also rejects late results and errors, so cancellation is not the only protection. An obsolete request cannot clear a newer request's loading indicator. Leaving the builder cancels its pending request.

The native “Why this setup fits” disclosure evaluates the current selection through the same validator used by the planner. It explains product budget, desk dimensions, the fixed footprint model, quiet preference and palette matches. Mixed finishes and missing optional items are described as facts rather than inferred reasons for a manual choice. Invalid edits change the heading to “Review this setup” and show the failing constraints. Shared links and current catalog prices feed the same evaluation.

The browser regressions deliberately remove the fetch abort signal and hold responses. They verify each edit path survives the old result, a late error cannot clear a newer request's loading state, and unmount requests cancellation. They also exercise the disclosure by keyboard, restored preferences, manual swaps and invalid selections. See [builder-state.spec.ts](../tests/e2e/builder-state.spec.ts) and [setup-explanation.test.ts](../tests/setup-explanation.test.ts).

## Real Redis checks

Run the separate integration suite with a local `redis-server` executable:

```sh
pnpm test:redis
# Or choose an existing executable explicitly:
REDIS_SERVER_BIN=/absolute/path/to/redis-server pnpm test:redis
```

The suite owns a new private temporary directory, a Redis process and four Node worker processes. TCP is disabled; Redis listens on a private Unix socket, with persistence disabled. Workers receive synthetic configuration without inherited provider credentials. External fetch calls are blocked. Cleanup stops the owned processes and removes the directory, and the suite asserts cleanup succeeded. Missing Redis fails the suite instead of silently skipping it.

The workers import `checkRateLimit`, `reserveAiRequest` and the actual API handlers. A test-only adapter forwards each production EVAL script, key and argument unchanged to Redis and returns its result in the expected REST shape. No production limiter code or dependency was changed for testing.

Fourteen scenarios cover:

- Client, global-minute and global-day limits for catalog, recommendation and checkout across four processes.
- Atomic rejection: denied work neither increments existing counters nor creates counters for a new client or window.
- Minute boundaries and UTC daily rollover, with the correct retry duration.
- Actual Redis key TTLs and expiry, including that allowed and rejected API requests do not extend existing TTLs.
- The separate AI minute/day allowance, including denials leaving counters unchanged.
- Redis command errors and a stopped Redis process: the real API handlers return 503, and AI interpretation falls back to rules without calling a model.

The accepted local run passed **15 tests: the parent test and 14 scenarios**, with **four worker processes, 2,280 application Redis command attempts and zero external calls**. The attempt count includes unavailable-transport attempts and excludes fixture inspection commands. CI builds pinned Redis 7.2.17 from the official archive, checks the official SHA-256, and runs this same suite before browser tests. Its source/build remains in the runner's temporary directory.

The adapter does not test Upstash HTTP/TLS, hosted network behavior or provider billing. Route handlers are invoked directly, not through a deployed HTTP server. Time-window inputs use a controlled clock. Production TTL values are asserted first; only disposable fixture keys then receive shortened expiry so cleanup can be observed promptly. These results do not establish hosted-service parity, a 48-hour soak test or production throughput.

## Verification snapshot

- `pnpm lint` and `pnpm typecheck` passed.
- `pnpm test`: 109 domain/backend tests passed.
- `pnpm test:redis`: 15 tests passed, with the scope above.
- `pnpm test:e2e`: production build succeeded, 49 browser checks passed in Chromium and WebKit, and one existing WebKit-specific pixel test was intentionally skipped.
- The browser suite uses an isolated fixture catalog with live AI and Shopify checkout disabled. It does not submit orders.
- Separate desktop and 390 px phone browser inspection confirmed the collapsed/expanded disclosure, visible keyboard focus, a 32 px summary target and no page overflow.

Existing hosted payment/AI evidence remains dated November 15. Separately, scheduled public smoke runs passed on [November 16](https://github.com/Saadullah-2004/desklab/actions/runs/43979055837) and [November 17](https://github.com/Saadullah-2004/desklab/actions/runs/44190040595) at `6664920`. The smoke checks homepage/headers, readiness, the connected catalog and an empty-brief rules recommendation without model calls or cart creation.
