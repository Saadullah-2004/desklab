# DeskLab portfolio notes

[Live demo](https://desklab-saadullah-2004.vercel.app) · Hosted on Vercel Hobby

## One-sentence description

DeskLab is a 3D workspace configurator and headless Shopify storefront that turns a budget, available desk space and style preferences into a compatible product setup.

## Resume entry

**DeskLab | Full-stack commerce and 3D configuration project**

Next.js, TypeScript, React Three Fiber, Shopify Storefront API, Playwright

- Built an interactive workspace configurator with 3D previews, shareable configurations and a persistent shopping bag across an original 18-product catalog.
- Implemented a deterministic setup planner that validates budget, combined product footprints, inventory and keyboard preferences, with the same checks applied to manual product swaps.
- Integrated Shopify catalog, cart and hosted checkout with server-side variant, CAD price and stock validation; verified successful and declined payments through Shopify's test gateway.
- Added distributed API quotas, origin validation, bounded requests, privacy-conscious diagnostics and separate gates for live AI and sandbox checkout.

These bullets describe implemented functionality and verified test-mode checkout. Local production browser checks pass, the free Redis connection and one live limiter reservation have been verified, and a 12-case local live Gemini evaluation passed. The Vercel Hobby site is deployed and basic public integration checks passed. Deployed AI and checkout-return verification remain pending. There is no physical fulfillment.

An optional AI-focused bullet:

- Designed schema-validated preference extraction with a fixed free-tier model, distributed request caps and deterministic fallback; improved a 12-case rules regression set from 8 to 12 exact matches while keeping every recommendation within tested constraints.

That evaluation bullet refers to the local rules parser. A separately verified AI-focused alternative is:

- Integrated Gemini structured preference extraction with a deterministic commerce planner; verified 12/12 exact preferences and constraint checks on a bounded synthetic live-provider evaluation, with zero fallback results.

The live run used the same small development fixture set as the corrected rules baseline. It does not establish general language accuracy, superiority to rules, production reliability or measured savings.

## Short project summary

I built DeskLab to make a storefront behave like a useful design tool. A shopper can describe a workspace, inspect a proposed setup in 3D and swap products without losing the fit and budget checks. Shopify supplies connected prices and stock, while application code handles compatibility. The work includes server-side checkout validation, verified hosted test checkout, versioned sharing, a static rendering fallback, bounded API access and automated checks. Its original collection, visual design and share card make it a self-contained portfolio demonstration.

## Two-minute walkthrough

1. Open the homepage and rotate the workspace with the pointer or rotation buttons. Show the static preview as an alternate experience.
2. Enter a brief such as “A minimal and quiet setup under $500 for a 120 cm desk.” Show the returned products, total and constraint explanations.
3. Swap a product manually. Demonstrate that an incompatible selection disables adding the setup and explains the problem.
4. Copy the workspace URL, reopen it and show that products and structured preferences are restored.
5. Add the setup to the bag, adjust a quantity and reload to show persistence.
6. Explain the commerce boundary: checkout re-fetches Shopify variants and inventory. Continue to the configured test checkout and describe the verified successful-order and declined-payment paths. Use test payment details only.

Keep the demo's actual engine visible: `gemini` for successful live extraction and `rules` for empty briefs, disabled AI or fallback. The completed local provider evaluation does not establish that any particular deployed request used Gemini.

## Engineering decisions to discuss

**Why a deterministic planner?** Budget and physical fit need predictable enforcement. Exhaustive search over a small catalog makes the decision process inspectable, reproducible and easy to test. The optional model translates language into preferences rather than choosing arbitrary products.

**Why Shopify?** It provides catalog, inventory, cart and hosted checkout capabilities. DeskLab focuses on the custom shopping experience and validates the boundary where local selections become Shopify merchandise.

**Why keep prices out of shared URLs?** Shared links can be edited and outlive a catalog update. The app validates IDs and structured preferences, then reads current prices and availability separately.

**How are free-only operation and failure handled?** Account setup must remain on Vercel Hobby, Upstash Free and a Gemini Free Tier project without linked Cloud Billing. The app independently limits requests. AI failures use a labelled rules fallback; unavailable public API protection returns an error instead of running unprotected. Free account limits can still pause the project, which is acceptable for this portfolio. No paid retry or alternate model is configured.

**What did evaluation uncover?** “Up to 1.2 meters” was interpreted as a $1.20 budget and did not update the width. The fix separates explicit measurements from money and converts meters to centimeters. Along with documented palette synonyms, it improved the same 12-case rules set from 8/12 exact preferences and 43/48 fields to 12/12 and 48/48. All 12 setups passed deterministic checks before and after. The small set is a regression suite, so broader accuracy claims would need independent cases.

**What does the AI confirmation flag guarantee?** It records that an operator checked the project's Free Tier and disabled Cloud Billing. A key or flag cannot independently verify or freeze provider billing settings. The code additionally accepts only the reviewed model and enforces shared caps.

**What was a meaningful correctness issue?** Checking each item against the user's available width is insufficient. A 100 cm desk placed in a 140 cm space still has only 100 cm of usable width. The shared validator checks combined footprints against the actual selected desk.

**What would change at larger scale?** Candidate retrieval would precede the solver, and live integration checks would run against a dedicated test environment. Add operational features only when the project needs them, such as order webhooks for an actual order-dependent feature.

## Evidence and limits

As of November 15, 2026, the full backend suite passed 105/105 tests. The production Chromium/WebKit suite passed 31 tests, with one engine-specific pixel check intentionally skipped, and its production build succeeded. `pnpm audit --prod` reported no known vulnerabilities. Separate integration checks loaded the live 18-product Shopify catalog, created a cart, verified a declined-payment error and reached order confirmation after a successful payment through Shopify's Test Payment Gateway. Admin order inspection and post-order inventory decrement remain unverified. No real charge or physical fulfillment occurred.

The offline rules evaluation passed 12/12 exact preference checks, 48/48 field checks and 12/12 constraint checks. It made no model requests. The social image was rendered and visually inspected, and metadata tests cover route canonicals, API exclusion and preview noindex behavior.

A separate local live run completed November 15, 2026 at 18:37 UTC using `gemini-3.5-flash-lite`. It returned 12/12 Gemini successes, 12/12 exact preferences, 48/48 fields and 12/12 constraint checks, with no rules fallback. Each saved row was compared with the fixtures and current planner. The fictional catalog was used, and no Shopify checkout or deployed endpoint was exercised by that evaluation.

The personal Vercel Hobby project is deployed with production-only server configuration. Four public smoke requests passed against revision `a0f3977`: homepage and production headers, health readiness, all 18 live Shopify products and a feasible empty-brief rules recommendation. The anonymous homepage loads in a browser. The smoke observed checkout enabled but created no cart, order or model call. Deployed Gemini and checkout-return checks remain pending. Four focused Chromium/WebKit checks passed for subsequent frontend fixes that still need publication and deployed verification.

A personal Upstash $0 Free database was created without a payment method. Authenticated PING and the application's live limiter EVAL allow path succeeded; exhaustion behavior has not been exercised against the provider. A separate AI Studio console check confirmed the personal Gemini project is Free Tier with Cloud Billing not enabled. No general accuracy, performance, business-impact or cost-saving claims are supported by the small evaluation fixture set. The [README runbook](../README.md#free-only-deployment-runbook) describes remaining checks and the free-only operating constraint.
