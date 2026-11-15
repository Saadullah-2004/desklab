# Architecture and tradeoffs

DeskLab combines a workspace configurator with a Shopify-backed store. The distinctive behavior is the shared constraint model: generated recommendations and manual product swaps must satisfy the same contract.

[Production demo](https://desklab-saadullah-2004.vercel.app), hosted on Vercel Hobby. Basic deployed integration checks have passed; deployed AI and checkout-return verification remain pending.

## Ownership of data

| Data or decision                                                             | Authority                                              |
| ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| Original product IDs, handles, dimensions, finish, quiet-switch flag         | Versioned catalog in `src/lib/catalog.ts`              |
| Connected product title, description, CAD price, variant ID and availability | Shopify Storefront API                                 |
| Interpreted shopper preferences                                              | Rule parser, or optional schema-validated model output |
| Selected products and compatibility                                          | Deterministic planner and shared selection validator   |
| Pending bag                                                                  | Browser storage containing product IDs and quantities  |
| Purchase totals, shipping, tax and payment                                   | Shopify hosted checkout                                |

Product specifications describe fictional demonstration merchandise. Props shown in the workspace scene are decorative unless the product is explicitly part of the selected catalog items.

## Planning and validation

The solver enumerates candidate combinations from the small curated catalog. A complete setup requires one desk, one keyboard and one light. A shelf and an accessory are optional. It rejects unavailable products, invalid prices, duplicate categories, desks wider than the available space, and non-quiet keyboards when quiet switches are requested.

The fixed layout has two rows: shelf plus light at the back, keyboard plus accessory at the front. Individual products must meet their minimum desk width. The combined row widths must fit the selected desk, and row depths plus 4 cm clearance must fit its depth. These checks use the selected desk's actual dimensions, not just the user's maximum available width.

Valid combinations must fit the product budget in integer CAD cents. Style scores rank them; equal scores prefer lower cost and a deterministic product-ID tie-break. A request that cannot fit the essential items returns an infeasible result with explanations instead of silently returning an incomplete setup. Manual swaps call the same validator.

This approach is easy to inspect and test for 18 products. It is not a general room-layout optimizer or an ergonomic safety assessment. A much larger catalog would need indexed candidate retrieval or a different search strategy before exhaustive combination search.

## Commerce boundaries

The connected catalog queries known product handles through Shopify's supported Storefront client. Unpublished products are excluded, and upstream errors do not silently switch a connected store back to fictional live merchandise. A fresh recommendation returns its full catalog snapshot so the interface uses the same prices and availability that the planner saw.

Bag edits are local until checkout. The server accepts only catalog IDs and bounded quantities, then resolves live Shopify variants and rechecks inventory. It never trusts a browser-supplied price or variant ID. Shopify warnings and changed cart quantities produce an error rather than a redirect to a silently reduced cart.

A stock check is not a reservation. Shopify remains authoritative at final checkout. The application does not implement its own payment collection, fulfillment system, customer accounts or order webhook pipeline.

`SHOPIFY_TEST_CHECKOUT_ENABLED` is a separate, default-off gate. It represents an operator's verification of payment test mode. Storefront credentials alone do not establish whether the payment provider is sandboxed.

## Brief interpretation

The default configuration uses rule-based extraction for explicit CAD budgets, centimeter/meter widths, documented palette synonyms and quiet/clicky preferences. A measurement such as “up to 1.2 meters” changes width without becoming a $1.20 budget. Unsupported or ambiguous language can be entered through structured controls. The optional Gemini path, verified by a local live-provider evaluation, returns only a validated preferences object. Product choice, prices, budget enforcement and geometry stay in application code.

Live calls require `ENABLE_LIVE_AI=true`, `GEMINI_FREE_TIER_CONFIRMED=true`, a provider key and a distributed Redis allowance. Only the reviewed `gemini-3.5-flash-lite` model is accepted. The confirmation flag is an operator attestation, not a programmatic billing check. This project requires a dedicated personal Free Tier project with Cloud Billing disabled; a model name or API key cannot prove those settings.

Atomic counters cap model requests at five per minute and fifty per UTC day across instances. Each call has an eight-second timeout, one candidate and at most 512 output tokens. No tools, alternate model, alternate provider or retry is configured. Invalid output, provider errors and exhausted AI allowance fall back to local rules and expose the actual engine. An empty brief never reserves an AI request. The recommendation route's separate origin and rate checks run before catalog loading or interpretation.

The 12 public synthetic fixtures initially produced 8/12 exact rules results and 43/48 matching preference fields. Palette synonyms, metric conversion and the measurement/budget regression fix brought the same set to 12/12 and 48/48, while both runs passed all deterministic constraint checks. This is a small development regression set, not an independent model benchmark.

A separate live Gemini run completed on November 15, 2026 at 18:37 UTC with 12/12 provider successes, 12/12 exact preferences, 48/48 fields, 12/12 constraint checks and zero rules fallbacks. Report rows were independently compared with the current fixtures and planner. It exercised the local extraction function against the real provider and fictional catalog, not a deployed endpoint or Shopify checkout. It establishes no broader language accuracy or advantage over the corrected rules baseline. The runner requires explicit opt-in, sends at most 12 requests 15 seconds apart and reports all fallbacks as provider failures.

## Public API protection

Public production requires a valid HTTPS `APP_ORIGIN` and a working shared Upstash Redis limiter. Missing or partial configuration fails closed. Local development can use a bounded process-memory limiter; an explicit memory setting is permitted only for loopback testing outside Vercel. The public deployment cannot substitute local counters when Redis is unavailable.

Fixed-window quotas cover global and per-client request counts. Catalog, recommendation and checkout global daily caps are 800, 150 and 50 respectively. Their per-client minute caps are 60, 12 and 5; global minute caps are 300, 60 and 20. Exceeded limits return 429 plus `Retry-After`, while unavailable protection returns 503. POST bodies are bounded at 8 KiB and briefs at 1,000 characters. Browser origins are checked against explicit configuration rather than forwarded-host input.

Client counters use daily-rotated HMAC identifiers derived from a trusted proxy address. Vercel's trusted header is selected automatically. Other hosts need a header their proxy overwrites; absent or invalid identities share a conservative bucket. Raw addresses are not sent to Redis. Minute counters expire after 120 seconds and daily counters after 48 hours. Denied requests still use Redis, so application quotas are not a cap on every provider billing unit.

These controls supplement the required free account settings: Vercel Hobby, Upstash Free with no card, and Gemini Free Tier with no linked billing account. The [deployment runbook](../README.md#free-only-deployment-runbook) requires pausing or waiting under exhaustion rather than upgrading. A personal Upstash $0 Free database is configured with no payment method added; authenticated PING and the application's actual limiter EVAL allow path succeeded. Live quota exhaustion has not been exercised. The personal Vercel Hobby project is deployed with production-only server configuration, and its public readiness/catalog/planner checks passed. Separately from the live evaluation, the personal Gemini project's AI Studio screen was checked: Free Tier, with Cloud Billing not enabled.

## Diagnostics and privacy

Production application logs contain a fixed route name, HTTP status and duration only. They exclude request bodies, briefs, responses, customer identifiers, cart tokens, raw IPs and credentials. Platform access logs have their own retention behavior. Shared limiter records contain counters and expiring HMAC identifiers.

`GET /api/health` returns only `ok` or `unavailable`. It checks origin configuration and Redis reachability using a PING cached for 30 seconds per instance. It does not load Shopify, spend AI allowance or create carts, and does not certify payment configuration, model availability or billing tier. The separate public smoke script checks the catalog and an empty-brief recommendation without model calls or cart creation. Its scheduled workflow remains inactive until a public URL is configured.

The UI discloses that live interpretation sends the brief and selected preferences to Google, whose free-tier terms permit use to improve products. Leaving the brief empty avoids that transfer. No free-text brief is included in shared configurations. Response headers restrict framing, content sources, MIME sniffing and referrers. The CSP retains inline bootstrap scripts for Next's static pages, so it is not a nonce-based policy.

## Sharing and persistence

Versioned configuration URLs serialize catalog IDs, quantities and structured preferences. The current format preserves budget, available width, style and quiet settings. Legacy links remain readable. Decoders validate versions, shapes, known IDs and bounded values before accepting a payload.

Configuration URLs are editable data, not encrypted or authenticated records. They contain no free-text brief, checkout token or customer information. Prices are deliberately excluded and refreshed from the catalog. Local bag storage is similarly treated as untrusted input.

## Rendering and failure behavior

The workspace uses React Three Fiber and Three.js. Pointer interaction and keyboard-accessible rotation controls offer two ways to explore the scene. A static illustration remains available when WebGL fails, while shopping and configuration controls continue to work. Decorative geometry is not a substitute for the domain fit checks.

The browser suite checks rendered canvas changes after rotation and separately forces WebGL initialization failure. It also exercises mobile navigation, dialog dismissal/focus, cart persistence, impossible budgets and shared configurations. These are focused checks, not a claim of complete accessibility certification or universal browser compatibility.

## Discovery and social sharing

The homepage, collection, builder and About page each declare their own title, description and canonical URL through a shared metadata helper. An original code-generated 1200×630 Open Graph image uses the storefront palette and labels the project as a portfolio demo. No fictional product offers, ratings or reviews are published as structured data.

Only a configured public production origin can be indexed. Robots rules exclude API routes, and the sitemap lists the four public pages. Vercel previews, development, loopback and invalid/missing origins are noindex and publish no sitemap entries. Metadata is built from `APP_ORIGIN`, using the same origin parser as the server boundary; changing it requires a rebuild.

## Test and integration boundaries

- Domain tests cover fit, budget, stock, deterministic selection, manual swaps and versioned configuration validation.
- Backend tests replace upstream providers and exercise prices, quantities, errors, test-checkout gating, distributed rate limits, origin handling, diagnostics and AI fallback behavior.
- Playwright starts a local server with demo data and uses the real local recommendation endpoint. It does not submit a hosted Shopify order.
- Separate live checks loaded all 18 Shopify products, created a cart and completed hosted checkout through Shopify's Test Payment Gateway. A successful test payment reached order confirmation, and a declined test payment displayed an error. These checks did not charge a real payment method or fulfill merchandise.

The latest recorded full backend run passed 105/105 tests. The production Chromium/WebKit suite passed 31 tests with one engine-specific pixel check intentionally skipped, and its production build succeeded. Four focused Chromium/WebKit checks also passed for subsequent frontend fixes, which have not yet been published. `pnpm audit --prod` reported no known vulnerabilities.

The public smoke passed against deployment `a0f3977` using exactly four requests: homepage/production headers, health, all 18 live Shopify products and a feasible empty-brief rules recommendation. The anonymous homepage also loaded in a browser. The checkout flag was enabled, but that smoke created no cart, order or model request. Deployed Gemini and the checkout-return flow remain unverified. Live AI evidence is limited to the 12-case local evaluation above; no broader accuracy, latency, conversion, revenue or cost-saving claims are made.
