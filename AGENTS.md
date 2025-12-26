# Agent Instructions

## Verification Checklist

- Run lint: `bun run lint`
- Run formatting: `bun run prettier:fix`
- Run unit tests: `bun run test:unit`
- Run builds: `bun run build`
- For larger changes touching UI flows, networking, or game logic, run Playwright: `bun run test:e2e`

## Dependency Stability Check

- When adding dependencies, pin to the latest minor with caret versions (example: `^1.2.0`) and update the lockfile.

## Code Conventions

- Constants and enums use PascalCase.
- Constant objects should be expressed as `const enum` values.
- If a file defines more than three types/interfaces or those types are shared, move them into a colocated `types.ts`.
- GunDB tests should prefer real Gun instances; mocks are a last resort for unit tests and must be called out explicitly.

## Reference Docs

- Playwright: <https://playwright.dev/docs/intro>, <https://playwright.dev/docs/test-typescript> — use for e2e test authoring and fixtures.
- libp2p: <https://github.com/libp2p/js-libp2p> — use for libp2p node configuration and APIs.
- WebRTC guide: <https://docs.libp2p.io/guides/getting-started/webrtc/> — use when wiring browser WebRTC + relay flows.
- Gossipsub: <https://github.com/ChainSafe/js-libp2p-gossipsub> — use for pub/sub event wiring.
- GunDB + SEA: <https://gun.eco/docs/SEA> — use for shared state and encryption patterns.
- Bun Workspaces: <https://bun.sh/docs> — use for workspace setup and script conventions.
- SST: <https://sst.dev/docs> — use for deployment configuration.
