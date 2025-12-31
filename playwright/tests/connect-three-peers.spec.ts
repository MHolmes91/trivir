import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

import {
  assertPeerConnectivity,
  createPeerSession,
  electHost,
  ensureMeshReady,
  getState,
  publishEvent,
  startPeer,
  startStaticServer,
  stopPeer,
  stopStaticServer,
  waitForJoinEvents,
  type HostCandidate,
  type PeerInfo,
  type PeerSession,
} from "./peer-helpers";
import {
  startBunWebSocketEchoServer,
  startRelay,
  stopBunWebSocketServer,
  stopRelay,
  type RelayProcess,
} from "./relay-helpers";

const PeerClientPath = resolve(process.cwd(), ".generated", "peer-client.js");
const RepoRoot = resolve(process.cwd(), "..");
const RelayEntryPath = resolve(RepoRoot, "apps", "server", "relay", "basic.ts");
const RoomCode = "Room 9";
const Libp2pDebugNamespaces = "libp2p:*";
const RunWebSocketSanity = process.env.TRIVIA_WS_SANITY === "true";

const createSessionOptions = (baseUrl: string) => ({
  peerClientPath: PeerClientPath,
  baseUrl,
  debugNamespaces: Libp2pDebugNamespaces,
  allowInsecureWebSockets: true,
});

const wsTest = RunWebSocketSanity ? test : test.skip;

test.describe.serial("Connect 3 peers locally", () => {
  let relayProcess: RelayProcess | null = null;
  let relayMultiaddr = "";
  let relayCleanup: (() => Promise<void>) | null = null;
  let staticServer: Awaited<ReturnType<typeof startStaticServer>> | null = null;
  let baseUrl = "";

  test.beforeAll(async () => {
    staticServer = await startStaticServer("127.0.0.1");
    baseUrl = staticServer.baseUrl;
    console.log("[static] page url", baseUrl);

    const relay = await startRelay({
      entryPath: RelayEntryPath,
      repoRoot: RepoRoot,
      relayHost: "127.0.0.1",
      relayListen: "/ip4/127.0.0.1/tcp/0/ws",
      relayRuntime: "node",
      debugNamespaces: Libp2pDebugNamespaces,
      allowInsecureWebSockets: true,
    });
    relayProcess = relay.process;
    relayMultiaddr = relay.multiaddr;
    relayCleanup = relay.cleanup ?? null;
  });

  test.afterAll(async () => {
    await stopRelay(relayProcess);
    if (relayCleanup) {
      await relayCleanup();
    }
    await stopStaticServer(staticServer?.server ?? null);
  });

  test("Start 3 browser sessions", async ({ browser }) => {
    let sessions: PeerSession[] = [];

    try {
      await test.step("Given three isolated browser contexts", async () => {
        sessions = await Promise.all([
          createPeerSession(browser, createSessionOptions(baseUrl)),
          createPeerSession(browser, createSessionOptions(baseUrl)),
          createPeerSession(browser, createSessionOptions(baseUrl)),
        ]);
      });

      await test.step("Then each session loads the test page", async () => {
        await Promise.all(
          sessions.map(({ page }) => expect(page).toHaveURL(baseUrl)),
        );
      });
    } finally {
      await Promise.all(sessions.map(({ context }) => context.close()));
    }
  });

  wsTest("Bun WebSocket handshake sanity", async ({ browser }) => {
    let session: PeerSession | null = null;
    let server: Awaited<ReturnType<typeof startBunWebSocketEchoServer>> | null =
      null;

    try {
      server = await startBunWebSocketEchoServer();
      session = await createPeerSession(browser, createSessionOptions(baseUrl));

      await session.page.evaluate((wsUrl) => {
        return new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            reject(new Error("WebSocket handshake timed out"));
          }, 5_000);

          const socket = new WebSocket(wsUrl);
          let sawReady = false;

          const cleanup = () => {
            window.clearTimeout(timeout);
            socket.removeEventListener("open", onOpen);
            socket.removeEventListener("message", onMessage);
            socket.removeEventListener("error", onError);
            socket.removeEventListener("close", onClose);
          };

          const finish = () => {
            cleanup();
            socket.close();
            resolve();
          };

          const fail = (error: Error) => {
            cleanup();
            socket.close();
            reject(error);
          };

          const onOpen = () => {
            socket.send("ping");
          };

          const onMessage = (event: MessageEvent) => {
            if (event.data === "ready") {
              sawReady = true;
              socket.send("ping");
              return;
            }
            if (event.data === "ping") {
              finish();
            }
          };

          const onError = () => {
            fail(new Error("WebSocket error"));
          };

          const onClose = () => {
            if (!sawReady) {
              fail(new Error("WebSocket closed before ready"));
            }
          };

          socket.addEventListener("open", onOpen);
          socket.addEventListener("message", onMessage);
          socket.addEventListener("error", onError);
          socket.addEventListener("close", onClose);
        });
      }, server.url);
    } finally {
      await stopBunWebSocketServer(server);
      await session?.context.close();
    }
  });

  test("Each connects via relay + WebRTC", async ({ browser }) => {
    let sessions: PeerSession[] = [];
    let infos: PeerInfo[] = [];

    try {
      await test.step("Given three peers start against the relay", async () => {
        sessions = await Promise.all([
          createPeerSession(browser, createSessionOptions(baseUrl)),
          createPeerSession(browser, createSessionOptions(baseUrl)),
          createPeerSession(browser, createSessionOptions(baseUrl)),
        ]);
        infos = await Promise.all(
          sessions.map(({ page }) => startPeer(page, relayMultiaddr, RoomCode)),
        );
      });

      await test.step("Then each peer advertises relay + WebRTC addresses", async () => {
        infos.forEach(assertPeerConnectivity);
      });
    } finally {
      await Promise.all(sessions.map(({ page }) => stopPeer(page)));
      await Promise.all(sessions.map(({ context }) => context.close()));
    }
  });

  test("Validate pub/sub sync across all 3", async ({ browser }) => {
    let sessions: PeerSession[] = [];
    let infos: PeerInfo[] = [];

    try {
      await test.step("Given three peers ready on the relay", async () => {
        sessions = await Promise.all([
          createPeerSession(browser, createSessionOptions(baseUrl)),
          createPeerSession(browser, createSessionOptions(baseUrl)),
          createPeerSession(browser, createSessionOptions(baseUrl)),
        ]);
        infos = await Promise.all(
          sessions.map(({ page }) => startPeer(page, relayMultiaddr, RoomCode)),
        );
        infos.forEach(assertPeerConnectivity);
        await ensureMeshReady(sessions[0].page, sessions[1].page);
        await ensureMeshReady(sessions[0].page, sessions[2].page);
      });

      await test.step("When each peer publishes a join event", async () => {
        await Promise.all(
          sessions.map(({ page }, index) =>
            publishEvent(page, {
              type: "join",
              payload: { playerId: infos[index].peerId },
            }),
          ),
        );
      });

      await test.step("Then every peer receives the other two joins", async () => {
        await waitForJoinEvents(sessions[0].page, [
          infos[1].peerId,
          infos[2].peerId,
        ]);
        await waitForJoinEvents(sessions[1].page, [
          infos[0].peerId,
          infos[2].peerId,
        ]);
        await waitForJoinEvents(sessions[2].page, [
          infos[0].peerId,
          infos[1].peerId,
        ]);
      });
    } finally {
      await Promise.all(sessions.map(({ page }) => stopPeer(page)));
      await Promise.all(sessions.map(({ context }) => context.close()));
    }
  });

  test("Validate shared state sync across all 3", async ({ browser }) => {
    let sessions: PeerSession[] = [];
    let infos: PeerInfo[] = [];

    try {
      await test.step("Given three peers ready on the relay", async () => {
        sessions = await Promise.all([
          createPeerSession(browser, createSessionOptions(baseUrl)),
          createPeerSession(browser, createSessionOptions(baseUrl)),
          createPeerSession(browser, createSessionOptions(baseUrl)),
        ]);
        infos = await Promise.all(
          sessions.map(({ page }) => startPeer(page, relayMultiaddr, RoomCode)),
        );
        infos.forEach(assertPeerConnectivity);
        await ensureMeshReady(sessions[0].page, sessions[1].page);
        await ensureMeshReady(sessions[0].page, sessions[2].page);
      });

      await test.step("When one peer submits an answer", async () => {
        await publishEvent(sessions[0].page, {
          type: "answerSubmit",
          payload: { playerId: infos[0].peerId, answer: "A" },
        });
      });

      await test.step("Then the other peers converge on the same answer", async () => {
        await expect
          .poll(async () => {
            const state = await getState(sessions[1].page);
            return state.answers[infos[0].peerId] ?? null;
          })
          .toBe("A");
        await expect
          .poll(async () => {
            const state = await getState(sessions[2].page);
            return state.answers[infos[0].peerId] ?? null;
          })
          .toBe("A");
      });
    } finally {
      await Promise.all(sessions.map(({ page }) => stopPeer(page)));
      await Promise.all(sessions.map(({ context }) => context.close()));
    }
  });

  test("Validate host election when the host peer leaves", async ({
    browser,
  }) => {
    let sessions: PeerSession[] = [];
    let infos: PeerInfo[] = [];
    let hostId: string | null = null;

    try {
      await test.step("Given three peers connected to the relay", async () => {
        sessions = await Promise.all([
          createPeerSession(browser, createSessionOptions(baseUrl)),
          createPeerSession(browser, createSessionOptions(baseUrl)),
          createPeerSession(browser, createSessionOptions(baseUrl)),
        ]);
        infos = await Promise.all(
          sessions.map(({ page }) => startPeer(page, relayMultiaddr, RoomCode)),
        );
        infos.forEach(assertPeerConnectivity);
      });

      await test.step("When the host leaves", async () => {
        const candidates: HostCandidate[] = infos.map((info) => ({
          peerId: info.peerId,
          joinedAt: info.joinedAt,
        }));
        hostId = candidates[0]?.peerId ?? null;
        const remaining = candidates.filter(
          (candidate) => candidate.peerId !== hostId,
        );
        await stopPeer(sessions[0].page);
        const selection = await electHost(sessions[1].page, remaining, hostId);
        hostId = selection?.peerId ?? null;
      });

      await test.step("Then another peer is elected host", async () => {
        expect(hostId).not.toBeNull();
        expect(hostId).not.toBe(infos[0].peerId);
      });
    } finally {
      await Promise.all(sessions.slice(1).map(({ page }) => stopPeer(page)));
      await Promise.all(sessions.map(({ context }) => context.close()));
    }
  });
});
