import { createLibp2p } from "libp2p";
import { webRTC } from "@libp2p/webrtc";
import { webSockets } from "@libp2p/websockets";
import { circuitRelayTransport } from "@libp2p/circuit-relay-v2";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { identify } from "@libp2p/identify";
import { bootstrap } from "@libp2p/bootstrap";
import { rendezvousClient } from "@libp2p/rendezvous";
import { multiaddr } from "@multiformats/multiaddr";
import { createEd25519PeerId } from "@libp2p/peer-id-factory";
import type { PeerId } from "@libp2p/interface-peer-id";
import type { Multiaddr } from "@multiformats/multiaddr";

export interface RendezvousService {
  register: (namespace: string) => Promise<void>;
  discover: (namespace: string) => AsyncIterable<unknown>;
}

export interface Libp2pLike {
  peerId: PeerId;
  dial: (addr: Multiaddr) => Promise<unknown>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  services?: {
    rendezvous?: RendezvousService;
  };
}

export interface CreateNetworkingNodeOptions {
  peerId?: PeerId;
  relayMultiaddrs?: string[];
  listenAddresses?: string[];
}

export interface CreateTriviaPeerOptions extends CreateNetworkingNodeOptions {
  roomCode?: string;
  autoStart?: boolean;
  autoDialRelay?: boolean;
  autoAdvertiseRoom?: boolean;
  libp2pFactory?: (peerId: PeerId) => Promise<Libp2pLike>;
}

export interface TriviaPeer {
  node: Libp2pLike;
  peerId: PeerId;
  connectToRelay: (relayMultiaddr: string) => Promise<void>;
  advertiseRoom: (roomCode: string) => Promise<void>;
  discoverRoomPeers: (roomCode: string) => AsyncGenerator<PeerId>;
  stop: () => Promise<void>;
}

export async function createPeerId(): Promise<PeerId> {
  return createEd25519PeerId();
}

export async function createNetworkingNode(
  options: CreateNetworkingNodeOptions = {}
): Promise<Libp2pLike> {
  const peerId = options.peerId ?? (await createPeerId());
  const relayMultiaddrs = options.relayMultiaddrs ?? [];
  const listenAddresses = options.listenAddresses ?? ["/p2p-circuit", "/webrtc"];

  const node = await createLibp2p({
    peerId,
    addresses: {
      listen: listenAddresses
    },
    transports: [webSockets(), webRTC(), circuitRelayTransport()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: relayMultiaddrs.length > 0 ? [bootstrap({ list: relayMultiaddrs })] : [],
    services: {
      identify: identify(),
      rendezvous: rendezvousClient()
    }
  });

  return node as Libp2pLike;
}

export async function connectToRelay(
  node: Libp2pLike,
  relayMultiaddr: string
): Promise<void> {
  if (!relayMultiaddr) {
    throw new Error("Relay multiaddr is required");
  }

  await node.dial(multiaddr(relayMultiaddr));
}

export async function advertiseRoom(node: Libp2pLike, roomCode: string): Promise<void> {
  const rendezvous = getRendezvousService(node);
  await rendezvous.register(roomNamespace(roomCode));
}

export async function* discoverRoomPeers(
  node: Libp2pLike,
  roomCode: string
): AsyncGenerator<PeerId> {
  const rendezvous = getRendezvousService(node);
  const namespace = roomNamespace(roomCode);

  for await (const entry of rendezvous.discover(namespace)) {
    const peerId = extractPeerId(entry);
    if (peerId) {
      yield peerId;
    }
  }
}

export async function createTriviaPeer(
  options: CreateTriviaPeerOptions = {}
): Promise<TriviaPeer> {
  const peerId = options.peerId ?? (await createPeerId());
  const relayMultiaddrs = options.relayMultiaddrs ?? [];

  const node = options.libp2pFactory
    ? await options.libp2pFactory(peerId)
    : await createNetworkingNode({
        peerId,
        relayMultiaddrs,
        listenAddresses: options.listenAddresses
      });

  if (options.autoStart !== false) {
    await node.start();
  }

  if (options.autoDialRelay !== false) {
    for (const relayMultiaddr of relayMultiaddrs) {
      await connectToRelay(node, relayMultiaddr);
    }
  }

  if (options.roomCode && options.autoAdvertiseRoom !== false) {
    await advertiseRoom(node, options.roomCode);
  }

  return {
    node,
    peerId: node.peerId,
    connectToRelay: async (relayMultiaddr: string) => connectToRelay(node, relayMultiaddr),
    advertiseRoom: async (roomCode: string) => advertiseRoom(node, roomCode),
    discoverRoomPeers: async (roomCode: string) => discoverRoomPeers(node, roomCode),
    stop: async () => node.stop()
  };
}

function getRendezvousService(node: Libp2pLike): RendezvousService {
  const rendezvous = node.services?.rendezvous;
  if (!rendezvous) {
    throw new Error("Rendezvous service not configured");
  }

  return rendezvous;
}

function roomNamespace(roomCode: string): string {
  const normalized = roomCode.trim().toLowerCase().replace(/\s+/g, "-");
  if (!normalized) {
    throw new Error("Room code is required");
  }

  return `trivia-room:${normalized}`;
}

function extractPeerId(entry: unknown): PeerId | null {
  if (entry && typeof entry === "object") {
    const record = entry as { id?: PeerId; peerId?: PeerId };
    return record.id ?? record.peerId ?? null;
  }

  return null;
}
