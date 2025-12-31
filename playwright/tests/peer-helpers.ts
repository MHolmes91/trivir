import type { Browser, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const ClientPageHtml =
  '<!doctype html><html><head><meta charset="utf-8" /></head><body>Playwright Peer Client</body></html>';

type TriviaEventType =
  | "join"
  | "leave"
  | "gameStart"
  | "gameEnd"
  | "roundStart"
  | "roundEnd"
  | "answerSubmit";

type TriviaEvent = {
  type: TriviaEventType;
  payload?: Record<string, unknown>;
};

type PeerInfo = {
  peerId: string;
  joinedAt: number;
  listenAddrs: string[];
  relayDialed: boolean;
};

type PeerState = {
  answers: Record<string, string>;
};

type HostCandidate = { peerId: string; joinedAt?: number };

type HostSelection = { peerId: string; joinedAt?: number };

type TriviaPeerClient = {
  start: (options: {
    roomCode: string;
    relayMultiaddr: string;
    allowInsecureWebSockets?: boolean;
  }) => Promise<PeerInfo>;
  stop: () => Promise<void>;
  publishEvent: (event: TriviaEvent) => Promise<void>;
  getEvents: () => TriviaEvent[];
  clearEvents: () => void;
  getState: () => PeerState;
  electHost: (
    candidates: HostCandidate[],
    currentHostId: string | null,
  ) => HostSelection | null;
};

type PeerSession = {
  context: Awaited<ReturnType<Browser["newContext"]>>;
  page: Page;
};

type StaticServerHandle = {
  server: ReturnType<typeof createServer>;
  baseUrl: string;
};

type PeerSessionOptions = {
  peerClientPath: string;
  baseUrl: string;
  debugNamespaces: string;
  allowInsecureWebSockets?: boolean;
};

async function startStaticServer(
  baseHost: string = "127.0.0.1",
): Promise<StaticServerHandle> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(ClientPageHtml);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine static server port");
  }

  const { port } = address as AddressInfo;
  return { server, baseUrl: `http://${baseHost}:${port}/` };
}

async function stopStaticServer(
  server: ReturnType<typeof createServer> | null,
): Promise<void> {
  if (!server) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function createPeerSession(
  browser: Browser,
  {
    peerClientPath,
    baseUrl,
    debugNamespaces,
    allowInsecureWebSockets,
  }: PeerSessionOptions,
): Promise<PeerSession> {
  const context = await browser.newContext();
  await context.addInitScript({
    content: `(() => {
  const global = window;
  const allowInsecureWs = ${allowInsecureWebSockets ? "true" : "false"};
  if (!global.process) {
    global.process = { env: {} };
  }
  if (!global.process.env) {
    global.process.env = {};
  }
  global.process.env.DEBUG = "${debugNamespaces}";
  if (allowInsecureWs) {
    global.process.env.TRIVIA_ALLOW_INSECURE_WS = "true";
  }
})();`,
  });
  await context.addInitScript({ path: peerClientPath });
  const page = await context.newPage();
  await page.goto(baseUrl);
  return { context, page };
}

async function startPeer(
  page: Page,
  relayMultiaddr: string,
  roomCode: string,
): Promise<PeerInfo> {
  return page.evaluate(
    ({ relayMultiaddr: relay, roomCode: room }) => {
      const client = (
        window as unknown as { __triviaPeerClient: TriviaPeerClient }
      ).__triviaPeerClient;
      return client.start({ roomCode: room, relayMultiaddr: relay });
    },
    { relayMultiaddr, roomCode },
  );
}

async function stopPeer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const client = (
      window as unknown as { __triviaPeerClient: TriviaPeerClient }
    ).__triviaPeerClient;
    return client.stop();
  });
}

async function publishEvent(page: Page, event: TriviaEvent): Promise<void> {
  await page.evaluate((payload) => {
    const client = (
      window as unknown as { __triviaPeerClient: TriviaPeerClient }
    ).__triviaPeerClient;
    return client.publishEvent(payload);
  }, event);
}

async function getEvents(page: Page): Promise<TriviaEvent[]> {
  return page.evaluate(() => {
    const client = (
      window as unknown as { __triviaPeerClient: TriviaPeerClient }
    ).__triviaPeerClient;
    return client.getEvents();
  });
}

async function clearEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const client = (
      window as unknown as { __triviaPeerClient: TriviaPeerClient }
    ).__triviaPeerClient;
    client.clearEvents();
  });
}

async function getState(page: Page): Promise<PeerState> {
  return page.evaluate(() => {
    const client = (
      window as unknown as { __triviaPeerClient: TriviaPeerClient }
    ).__triviaPeerClient;
    return client.getState();
  });
}

async function electHost(
  page: Page,
  candidates: HostCandidate[],
  currentHostId?: string | null,
): Promise<HostSelection | null> {
  return page.evaluate(
    ({ candidates: value, currentHostId: current }) => {
      const client = (
        window as unknown as { __triviaPeerClient: TriviaPeerClient }
      ).__triviaPeerClient;
      return client.electHost(value, current ?? null);
    },
    { candidates, currentHostId },
  );
}

function assertPeerConnectivity(info: PeerInfo): void {
  expect(info.relayDialed).toBe(true);
  expect(info.listenAddrs.some((addr) => addr.includes("/p2p-circuit"))).toBe(
    true,
  );
  expect(info.listenAddrs.some((addr) => addr.includes("/webrtc"))).toBe(true);
}

async function ensureMeshReady(
  publisher: Page,
  subscriber: Page,
): Promise<void> {
  await clearEvents(subscriber);
  await publishEvent(publisher, { type: "join", payload: { note: "ready" } });
  await expect
    .poll(async () => {
      const events = await getEvents(subscriber);
      return events.some((event) => event.type === "join");
    })
    .toBe(true);
  await clearEvents(subscriber);
}

async function waitForJoinEvents(
  page: Page,
  expectedPeerIds: string[],
): Promise<void> {
  await expect
    .poll(async () => {
      const events = await getEvents(page);
      const seen = new Set(
        events
          .filter((event) => event.type === "join")
          .map((event) => String(event.payload?.playerId)),
      );
      return expectedPeerIds.filter((id) => seen.has(id)).length;
    })
    .toBe(expectedPeerIds.length);
}

export {
  assertPeerConnectivity,
  clearEvents,
  createPeerSession,
  electHost,
  ensureMeshReady,
  getEvents,
  getState,
  publishEvent,
  startPeer,
  startStaticServer,
  stopPeer,
  stopStaticServer,
  waitForJoinEvents,
};
export type {
  HostCandidate,
  HostSelection,
  PeerInfo,
  PeerSession,
  PeerState,
  TriviaEvent,
  TriviaEventType,
};
