import { createLibp2p } from "libp2p";
import { webSockets } from "@libp2p/websockets";
import { circuitRelayServer } from "@libp2p/circuit-relay-v2";
import { identify } from "@libp2p/identify";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";

type StringableAddress = { toString: () => string };

type BasicRelayNode = {
  start: () => void | Promise<void>;
  stop: () => void | Promise<void>;
  peerId: { toString: () => string };
  getMultiaddrs: () => StringableAddress[];
};

type BasicRelayFactory = (
  options?: Parameters<typeof createLibp2p>[0],
) => Promise<BasicRelayNode>;

const DefaultHost = "0.0.0.0";
const DefaultPort = "9090";

/**
 * Resolve relay listen addresses from env or defaults.
 *
 * Supported env vars:
 * - RELAY_LISTEN: comma-separated multiaddrs
 * - RELAY_HOST / RELAY_PORT: fallback host/port for a ws multiaddr
 * - RELAY_ALLOW_INSECURE_WS: set "false" to prefer wss
 */
export function resolveListenAddresses(): string[] {
  const explicit = process.env.RELAY_LISTEN?.split(",").map((value) =>
    value.trim(),
  );
  const listenAddresses = explicit?.filter(Boolean);
  if (listenAddresses && listenAddresses.length > 0) {
    return listenAddresses;
  }

  const host = process.env.RELAY_HOST ?? DefaultHost;
  const port = process.env.RELAY_PORT ?? DefaultPort;
  const allowInsecure = process.env.RELAY_ALLOW_INSECURE_WS !== "false";
  const protocol = allowInsecure ? "ws" : "wss";
  return [`/ip4/${host}/tcp/${port}/${protocol}`];
}

export function formatRelayAddress(address: string, peerId: string): string {
  if (address.includes("/p2p/")) {
    return address;
  }
  return `${address}/p2p/${peerId}`;
}

export function getAdvertisedRelayAddresses(
  addresses: StringableAddress[],
  peerId: string,
): string[] {
  return addresses.map((addr) => formatRelayAddress(addr.toString(), peerId));
}

function logRelayAddresses(addresses: string[]): void {
  console.log("Relay running at:");
  addresses.forEach((addr) => console.log(addr));
}

/**
 * Build the libp2p config for the basic relay.
 */
export function createBasicRelayOptions(): Parameters<typeof createLibp2p>[0] {
  return {
    addresses: {
      listen: resolveListenAddresses(),
    },
    transports: [webSockets()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      relay: circuitRelayServer(),
      pubsub: gossipsub({ emitSelf: false, fallbackToFloodsub: false }),
    },
  };
}

/**
 * Start a basic local relay suitable for browser peers.
 *
 * Returns a running libp2p node that listens on WebSockets,
 * enables circuit relay v2, and advertises its multiaddrs.
 */
export async function startBasicRelay(
  createNode: BasicRelayFactory = createLibp2p,
): Promise<BasicRelayNode> {
  const relay = await createNode(createBasicRelayOptions());

  await relay.start();

  const peerId = relay.peerId.toString();
  const advertised = getAdvertisedRelayAddresses(relay.getMultiaddrs(), peerId);

  logRelayAddresses(advertised);

  return relay;
}
