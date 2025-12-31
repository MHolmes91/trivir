import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  createBasicRelayOptions,
  formatRelayAddress,
  getAdvertisedRelayAddresses,
  resolveListenAddresses,
  startBasicRelay,
} from "./index";

type EnvSnapshot = {
  RELAY_LISTEN?: string;
  RELAY_HOST?: string;
  RELAY_PORT?: string;
};

function captureEnv(): EnvSnapshot {
  return {
    RELAY_LISTEN: process.env.RELAY_LISTEN,
    RELAY_HOST: process.env.RELAY_HOST,
    RELAY_PORT: process.env.RELAY_PORT,
  };
}

function restoreEnv(snapshot: EnvSnapshot): void {
  process.env.RELAY_LISTEN = snapshot.RELAY_LISTEN;
  process.env.RELAY_HOST = snapshot.RELAY_HOST;
  process.env.RELAY_PORT = snapshot.RELAY_PORT;
}

describe("basic relay helpers", () => {
  let snapshot: EnvSnapshot;

  beforeEach(() => {
    snapshot = captureEnv();
  });

  afterEach(() => {
    restoreEnv(snapshot);
  });

  it("uses RELAY_LISTEN when provided", () => {
    process.env.RELAY_LISTEN =
      " /ip4/127.0.0.1/tcp/9999/ws ,/ip4/0.0.0.0/tcp/1111/ws ";

    const addresses = resolveListenAddresses();

    expect(addresses).toEqual([
      "/ip4/127.0.0.1/tcp/9999/ws",
      "/ip4/0.0.0.0/tcp/1111/ws",
    ]);
  });

  it("falls back to RELAY_HOST and RELAY_PORT", () => {
    process.env.RELAY_LISTEN = "";
    process.env.RELAY_HOST = "127.0.0.1";
    process.env.RELAY_PORT = "7777";

    const addresses = resolveListenAddresses();

    expect(addresses).toEqual(["/ip4/127.0.0.1/tcp/7777/ws"]);
  });

  it("builds relay options with listen addresses", () => {
    process.env.RELAY_LISTEN = "/ip4/127.0.0.1/tcp/9999/ws";

    const options = createBasicRelayOptions();
    if (!options) {
      throw new Error("Expected relay options to be defined");
    }

    expect(options.addresses?.listen).toEqual(["/ip4/127.0.0.1/tcp/9999/ws"]);
    expect(options.services).toBeTruthy();
  });

  it("formats relay address with peer id", () => {
    expect(formatRelayAddress("/ip4/127.0.0.1/tcp/9090/ws", "peer")).toBe(
      "/ip4/127.0.0.1/tcp/9090/ws/p2p/peer",
    );
  });

  it("keeps relay address when peer id already present", () => {
    expect(
      formatRelayAddress("/ip4/127.0.0.1/tcp/9090/ws/p2p/peer", "peer"),
    ).toBe("/ip4/127.0.0.1/tcp/9090/ws/p2p/peer");
  });

  it("expands advertised relay addresses", () => {
    const advertised = getAdvertisedRelayAddresses(
      [{ toString: () => "/ip4/127.0.0.1/tcp/9090/ws" }],
      "peer",
    );

    expect(advertised).toEqual(["/ip4/127.0.0.1/tcp/9090/ws/p2p/peer"]);
  });

  it("starts relay and logs advertised addresses", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = ((...args: string[]) => {
      logs.push(args.join(" "));
    }) as typeof console.log;

    let started = false;
    const createNode = async () => ({
      start: () => {
        started = true;
      },
      stop: () => undefined,
      peerId: { toString: () => "peer" },
      getMultiaddrs: () => [{ toString: () => "/ip4/127.0.0.1/tcp/9090/ws" }],
    });

    try {
      await startBasicRelay(createNode);
    } finally {
      console.log = originalLog;
    }

    expect(started).toBe(true);
    expect(logs[0]).toBe("Relay running at:");
    expect(logs[1]).toBe("/ip4/127.0.0.1/tcp/9090/ws/p2p/peer");
  });
});
