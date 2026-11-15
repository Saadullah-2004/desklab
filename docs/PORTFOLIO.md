# DeskLab portfolio notes

## One-sentence description

DeskLab is a 3D workspace configurator and headless Shopify storefront that turns a budget, available desk space and style preferences into a compatible product setup.

## Resume entry

**DeskLab | Full-stack commerce and 3D configuration project**

Next.js, TypeScript, React Three Fiber, Shopify Storefront API, Playwright

- Built an interactive workspace configurator with 3D previews, shareable configurations and a persistent shopping bag across an original 18-product catalog.
- Implemented a deterministic setup planner that validates budget, combined product footprints, inventory and keyboard preferences, with the same checks applied to manual product swaps.
- Integrated Shopify catalog, cart and hosted checkout with server-side variant, CAD price and stock validation; verified successful and declined test payments alongside 46 domain/backend tests and 11 browser tests.

These bullets describe implemented functionality and verified test-mode checkout. Physical fulfillment, public deployment and live AI evaluation are outside the completed release scope.

An optional fourth bullet, when discussing the implemented AI integration specifically:

- Designed a schema-validated AI preference-extraction path with distributed request caps, timeouts and a deterministic fallback; live provider integration is deferred.

## Short project summary

I built DeskLab to make a storefront behave like a useful design tool. A shopper can describe a workspace, inspect a proposed setup in 3D and swap products without losing the fit and budget checks. Shopify supplies connected prices and stock, while application code handles compatibility. The work includes server-side checkout validation, verified hosted test checkout, versioned sharing, a static rendering fallback and automated checks for the main browser flows.

## Two-minute walkthrough

1. Open the homepage and rotate the workspace with the pointer or rotation buttons. Show the static preview as an alternate experience.
2. Enter a brief such as “A minimal and quiet setup under $500 for a 120 cm desk.” Show the returned products, total and constraint explanations.
3. Swap a product manually. Demonstrate that an incompatible selection disables adding the setup and explains the problem.
4. Copy the workspace URL, reopen it and show that products and structured preferences are restored.
5. Add the setup to the bag, adjust a quantity and reload to show persistence.
6. Explain the commerce boundary: checkout re-fetches Shopify variants and inventory. Continue to the configured test checkout and describe the verified successful-order and declined-payment paths. Use test payment details only.

Keep the demo's current engine visible. It uses rule-based brief parsing; do not present it as a live LLM recommendation.

## Engineering decisions to discuss

**Why a deterministic planner?** Budget and physical fit need predictable enforcement. Exhaustive search over a small catalog makes the decision process inspectable, reproducible and easy to test. The optional model translates language into preferences rather than choosing arbitrary products.

**Why Shopify?** It provides catalog, inventory, cart and hosted checkout capabilities. DeskLab focuses on the custom shopping experience and validates the boundary where local selections become Shopify merchandise.

**Why keep prices out of shared URLs?** Shared links can be edited and outlive a catalog update. The app validates IDs and structured preferences, then reads current prices and availability separately.

**What was a meaningful correctness issue?** Checking each item against the user's available width is insufficient. A 100 cm desk placed in a 140 cm space still has only 100 cm of usable width. The shared validator checks combined footprints against the actual selected desk.

**What would change at larger scale?** Candidate retrieval would precede the solver, and live integration checks would run against a dedicated test environment. Add operational features only when the project needs them, such as order webhooks for an actual order-dependent feature.

## Evidence and limits

As of November 15, 2026, the recorded local verification is 46 domain/backend tests and 11 Playwright tests passing. Separate integration checks loaded the live 18-product Shopify catalog, created a cart, verified a declined-payment error and reached order confirmation after a successful payment through Shopify's Test Payment Gateway. No real charge or physical fulfillment occurred.

Live AI evaluation is intentionally deferred, and public hosting is not deployed yet. There are no measured performance, business-impact, model-quality or cost-saving results to put on a resume. Update this section and the README when those milestones are actually verified.
