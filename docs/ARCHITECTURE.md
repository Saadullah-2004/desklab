# Architecture and tradeoffs

DeskLab combines a workspace configurator with a Shopify-backed store. The distinctive behavior is the shared constraint model: generated recommendations and manual product swaps must satisfy the same contract.

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

The released demo uses transparent rule-based extraction for budgets, widths, styles and quiet preferences. The optional Gemini path produces only a validated preferences object. Product choice, prices, budget enforcement and geometry stay in application code.

Live calls require explicit enablement, a provider key and a distributed Redis allowance. Atomic counters cap use at five requests per minute and fifty per UTC day across instances. Timeouts, invalid model output and exhausted allowance fall back to rules without paid retries. These controls have automated coverage; live model quality has not been measured.

## Sharing and persistence

Versioned configuration URLs serialize catalog IDs, quantities and structured preferences. The current format preserves budget, available width, style and quiet settings. Legacy links remain readable. Decoders validate versions, shapes, known IDs and bounded values before accepting a payload.

Configuration URLs are editable data, not encrypted or authenticated records. They contain no free-text brief, checkout token or customer information. Prices are deliberately excluded and refreshed from the catalog. Local bag storage is similarly treated as untrusted input.

## Rendering and failure behavior

The workspace uses React Three Fiber and Three.js. Pointer interaction and keyboard-accessible rotation controls offer two ways to explore the scene. A static illustration remains available when WebGL fails, while shopping and configuration controls continue to work. Decorative geometry is not a substitute for the domain fit checks.

The browser suite checks rendered canvas changes after rotation and separately forces WebGL initialization failure. It also exercises mobile navigation, dialog dismissal/focus, cart persistence, impossible budgets and shared configurations. These are focused checks, not a claim of complete accessibility certification or universal browser compatibility.

## Test and integration boundaries

- Domain tests cover fit, budget, stock, deterministic selection, manual swaps and versioned configuration validation.
- Backend tests replace upstream providers and exercise prices, quantities, errors, test-checkout gating and AI fallback behavior.
- Playwright starts a local server with demo data and uses the real local recommendation endpoint. It does not submit a hosted Shopify order.
- Separate live checks loaded all 18 Shopify products, created a cart and completed hosted checkout through Shopify's Test Payment Gateway. A successful test payment reached order confirmation, and a declined test payment displayed an error. These checks did not charge a real payment method or fulfill merchandise.

No latency, conversion, revenue, model-quality or cost-saving claims are made. Public hosting and live AI verification remain separate release steps.
