# P2P Trivia App

Tech stack: TypeScript on Bun (runtime & workspaces), Web Components + Tailwind for UI, Playwright for BDD e2e tests, Bun test runner for unit tests, libp2p for peer networking, Gossipsub for events, GunDB for shared state, Docker + SST for deployment.

IMPORTANT: Track step status in this file: mark steps as in progress when they are the current prompted step (or you are asked to revisit a prior step), and mark steps as completed once I prompt you to run the next step.

---

## Monorepo Directory Structure

```
/trivia-p2p/
├── apps/
│   ├── server/
│   │   ├── relay/
│   │   └── matchmaking/
│   └── client/
│       ├── ui/
│       └── logic/
├── playwright/ # Playwright BDD tests (separate)
├── packages/
│   ├── lib/
│   │   ├── networking/
│   │   ├── pubsub/
│   │   ├── state/ # db.ts (GunDB)
│   │   └── game/
├── AGENTS.md
├── docker-compose.yml
└── bun.workspaces.json
```

---

## Implementation Conventions

- When adding a JS/TS module that requires a test, place it in a dedicated kebab-case folder with `index.ts` and `index.test.ts` (e.g., `host-election/`).

## AGENT STEPS (Feed These to Your Coding Agent)

### 1) Monorepo Structure

Status: completed

Goal: Setup Bun workspaces + Tailwind + shared configs.

Steps:

1. Create `bun.workspaces.json` with `apps/*`, `packages/*`, `playwright`.
2. Add shared `tsconfig.json` with path aliases.
3. Integrate Tailwind config into Web Components UI build.
4. Add scripts: `dev`, `build`, `test:unit`, `test:e2e`.
5. After completing each step, commit the changes to git with a concise message.

Tests: No tests yet here.

### 2) Peer libp2p Networking Module

Status: completed

Goal: Browser peers create libp2p node with WebRTC + Circuit Relay v2 fallback.

BDD unit tests (co-located with logic in Bun test runner):

- Peer initializes with unique PeerID.
- Peer connects to relay multiaddr.
- Peer advertises and discovers room code peers.

Implementation:

- `packages/lib/networking/index.ts`.
- Uses `@libp2p/webrtc` + `@libp2p/circuit-relay-v2`.

Docs: libp2p JS + WebRTC guides.

### 3) Peer Gossipsub Pub/Sub Events

Status: completed

Goal: Broadcast core trivia events via Gossipsub.

Trivia events to implement:

- `join`
- `leave`
- `gameStart`
- `gameEnd`
- `roundStart`
- `roundEnd`
- `answerSubmit`

BDD unit tests:

- Can subscribe to a room topic.
- Can publish/receive each event type.

Implementation: `packages/lib/pubsub/events/index.ts`.

### 4) Peer GunDB Shared State (db.ts)

Status: completed

Goal: Store persistent shared state: players, scores, event logs.

BDD unit tests:

- Write/read state across peers.
- Sync events and resolve conflicts correctly.

Implementation: `packages/lib/state/db/index.ts` using GunDB + SEA.

### 5) Trivia Game Business Logic

Status: completed

Goal: Static multiple choice questions + gameplay flow.

Behaviors to implement and test:

- Peer can only access room if they know the room password (if one is set)
- Game start and end logic.
- Round start and end.
- Timer enforcement.
- Scoring rules.
- Join/leave updates.
- Define question set as static JSON array.
- Choose questions randomly from the set.

BDD unit tests:

- Validate game lifecycle transitions.
- Correct scoring logic.
- Validate choice of questions from JSON
- Timer expiration transitions.

Implementation: `packages/lib/game/logic/index.ts`.

### 6) Peer Host Election

Status: completed

Goal: Elect a new host when the host peer disconnects.

BDD unit tests:

- Each peer should
- Simulate 3 peers, remove host, verify next host selection.
- Deterministic fallback rules (PeerID sort / timestamp).

Implementation: `packages/lib/networking/host-election/index.ts`.

### 7) Headless Client Harness (No UI)

Status: completed

Goal: Provide a basic client module (no UI) to start peers and drive scenarios for Step 9 Playwright tests.

BDD unit tests:

- Can boot a peer with a room code and connect to the relay.
- Can publish/receive pubsub events for a room.

Implementation: `apps/client/headless/*` + a minimal CLI entry (`apps/client/headless/cli/index.ts`) for spawning peers.

### 8) Basic Relay + WebRTC Server (Local)

Status: completed

Goal: Provide a minimal relay + WebRTC signalling server for local dev and Step 9 tests.

BDD unit tests:

- Relay accepts reservations from browser peers.
- Relay advertises a reachable WebSocket multiaddr.

Implementation: `apps/server/relay/basic.ts` using `@libp2p/circuit-relay-v2`, `@libp2p/websockets`, and `@chainsafe/libp2p-gossipsub`.

### 9) Connect 3 Peers Locally (Dev/Debug)

Status: in progress

Goal: Validate connections among 3 browser peers during development.

BDD e2e tests (Playwright in `playwright/`):

- Start 3 browser sessions.
- Each connects via relay + WebRTC.
- Validate pub/sub and shared state sync across all 3.
- Validate host election when the host peer leaves

Steps to ensure libp2p-only connectivity (no fallbacks):

1. Launch each peer in its own Playwright browser context (three separate contexts)
2. Ensure libp2p without fallbacks is used for this scenario.
3. Wait for relay connectivity explicitly (e.g., peer connection status or relay reservation) before publishing events.
4. Wait for pubsub subscriptions/mesh readiness before publish, then assert events propagate over libp2p.
5. Fail if relay dial fails or if no relay/WebRTC multiaddr is present (do not accept optimistic flags).

Implementation: Stories like "3 players join room, game starts, all peers sync events".

### 10) Peer UI — Web Components + Tailwind

Goal: Build UI with Web Components and Tailwind for in-browser clients.

Playwright BDD e2e tests:

- Join/create room flows.
- Game screen shows question + options + timer.
- UI reflects broadcasts (join/leave, answer results).
- Scoreboard updates live.

Implementation: `apps/client/ui` Web Component files + Tailwind classes.

### 11) Server Matchmaking Module

Goal: Server stores room codes + peer connection info.

BDD unit tests (server logic):

- Create room entry.
- Return list of peer multiaddrs for joiners.

API endpoints:

- `POST /rooms` -> create new room.
- `GET /rooms/:code` -> get peer info.

Implementation: `apps/server/matchmaking.ts`.

### 12) libp2p Relay + WebRTC Improvements

Goal: Implement the relay, peer discovery, and NAT traversal improvements described in `BUILD_AGENT_LIBP2P_IMPROVEMENT.md`.

Steps:

1. Implement public relay node (WebSockets + GossipSub + Circuit Relay v2).
2. Implement browser/peer node updates (WebRTC + WebSockets + relay client mode).
3. Add GossipSub discovery channel for multiaddr announcements.
4. Implement dialing flow with relay fallback.
5. Add optional DCUtR/hole punching and AutoNAT hooks (behind flags).
6. Add logging for peer connect/discovery and transport usage.

Implementation:

- `apps/server/relay.ts`
- `packages/lib/networking/index.ts`
- `packages/lib/pubsub/events/index.ts`

### 13) Server Relay Module

Goal: Always-on libp2p relay service.

BDD unit tests:

- Relay accepts reservations from browsers.
- Relay routes traffic when direct WebRTC fails.

Implementation: `apps/server/relay.ts` using `@libp2p/circuit-relay-v2`.

### 14) Server Deployment (Docker + SST)

Goal: Containerize and deploy the server using SST + Docker Compose locally and SST for prod.

Steps:

1. Dockerfile for server pieces.
2. `docker-compose.yml` to spin up server + optional Redis.
3. SST config to deploy to AWS (ECS/Fargate).

### 15) Custom Questions Per Room

Goal: Allow the room host to upload or input custom questions.

Playwright BDD e2e tests:

- Host enters a custom question set in UI.
- Clients see custom questions during game.

Implementation:

- Extend `packages/lib/game/logic/index.ts` to accept external question sets.
- UI form + API support for question upload per room.

---

## Test Frameworks

### Playwright (E2E)

- Lives in `playwright/`.
- Separate config and browser automation tests (`@playwright/test`).

### Bun Unit Tests

- Co-located with each implementation file.
- Uses Bun's built-in test runner (`*.test.ts` files).

---

## Doc Links to Include

- Playwright: <https://playwright.dev/docs/intro>, <https://playwright.dev/docs/test-typescript>
- libp2p: <https://github.com/libp2p/js-libp2p>; WebRTC guide: <https://docs.libp2p.io/guides/getting-started/webrtc/>
- Gossipsub: <https://github.com/ChainSafe/js-libp2p-gossipsub>
- GunDB + SEA: <https://gun.eco/docs/SEA>
- Bun Workspaces: <https://bun.sh/docs>
- SST: <https://sst.dev/docs>

---

## Local Dev Run Book

1. `docker-compose up` — start server relay + matchmaking.
2. Run UI client in Bun dev mode.
3. Launch 3 browser windows.
4. Playwright tests drive scenarios across all 3 peers.
