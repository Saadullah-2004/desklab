# DeskLab

DeskLab is a public portfolio project: a desk setup builder and headless Shopify storefront.

- Use TypeScript, Next.js App Router, and the installed commerce SDK's supported APIs.
- Keep Shopify credentials and model credentials on the server. Never commit environment files or customer data.
- Demo catalog and simulated actions must be visibly identified. Do not report a live checkout, model evaluation, or deployment without verification.
- Prices use integer cents and CAD. Treat Shopify as authoritative for live price, inventory, and checkout.
- Model output supplies preferences only. Deterministic validation owns product selection, physical constraints, and budget.
- Keep the visual experience accessible without WebGL; support keyboard input and reduced motion.
- Verify changes with lint, type checking, meaningful domain tests, and a production build. Use end-to-end tests for the main purchase/configuration flow.
- Use no em dashes in UI copy or documentation.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
