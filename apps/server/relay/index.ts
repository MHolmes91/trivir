import { createLibp2p } from "libp2p";
import { webSockets } from "@libp2p/websockets";
import { circuitRelayServer } from "@libp2p/circuit-relay-v2";
import { identify } from "@libp2p/identify";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";

type StringableAddress = { toString: () => string };

const DefaultHost = "0.0.0.0";
const DefaultPort = "9090";

function resolveListenAddresses(): string[] {
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

function formatRelayAddress(address: string, peerId: string): string {
  if (address.includes("/p2p/")) {
    return address;
  }
  return `${address}/p2p/${peerId}`;
}

export async function startBasicRelay(): Promise<
  Awaited<ReturnType<typeof createLibp2p>>
  // eslint-disable-next-line indent
> {
  const relay = await createLibp2p({
    addresses: {
      listen: resolveListenAddresses(),
    },
    transports: [webSockets()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      relay: circuitRelayServer(),
      pubsub: gossipsub({ emitSelf: false }),
    },
  });

  await relay.start();

  const peerId = relay.peerId.toString();
  const advertised = relay
    .getMultiaddrs()
    .map((addr: StringableAddress) =>
      formatRelayAddress(addr.toString(), peerId),
    );

  console.log("Relay running at:");
  advertised.forEach((addr: string) => console.log(addr));

  return relay;
}

async function main(): Promise<void> {
  const relay = await startBasicRelay();

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, stopping relay...`);
    await relay.stop();
    process.exit(0);
  };

  ["SIGINT", "SIGTERM"].forEach((signal) => {
    process.on(signal, () => {
      void shutdown(signal);
    });
  });
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Relay failed to start", error);
    process.exit(1);
  });
}
