<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Frontend visual system

- New frontend UI, controls, animations, and interactive states must use the app's monochrome palette: black, white, charcoal, and neutral gray only.
- Do not introduce colored accent controls, gradients, glows, or status decorations. Preserve color only when it belongs to user content, generated media, data visualizations that require categorical distinction, or an external brand asset.
- Keep overlays viewport-bounded, responsive, and free of clipped controls or overflowing animation states.
