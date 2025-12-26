import { createLibp2p } from "libp2p";
import { webSockets } from "@libp2p/websockets";
import { circuitRelayTransport } from "@libp2p/circuit-relay-v2";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { identify } from "@libp2p/identify";
import { bootstrap } from "@libp2p/bootstrap";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { multiaddr } from "@multiformats/multiaddr";
import {
  createEd25519PeerId,
  createFromProtobuf,
  exportToProtobuf,
} from "@libp2p/peer-id-factory";
import type { PeerId } from "@libp2p/interface-peer-id";
import { TriviaPeerIdStorageKey, TriviaRoomPrefix } from "../constants";
import type {
  CreateNetworkingNodeOptions,
  CreatePeerIdOptions,
  CreateTriviaPeerOptions,
  ElectRoomHostOptions,
  HostCandidate,
  HostSelection,
  Libp2pLike,
  PeerIdStorage,
  RoomDirectory,
  TriviaPeer,
} from "./types";
import { electHost } from "./host-election";

/**
 * Creates an in-memory room directory for peer discovery.
 */
export function createInMemoryRoomDirectory(): RoomDirectory {
  const rooms = new Map<string, Map<string, PeerId>>();

  return {
    advertise: async (namespace: string, peerId: PeerId) => {
      const room = rooms.get(namespace) ?? new Map<string, PeerId>();
      room.set(peerId.toString(), peerId);
      rooms.set(namespace, room);
    },
    discover: async function* (namespace: string, selfPeerId: PeerId) {
      const room = rooms.get(namespace);
      if (!room) {
        return;
      }

      for (const [id, peerId] of room) {
        if (id !== selfPeerId.toString()) {
          yield peerId;
        }
      }
    },
  };
}

const DefaultRoomDirectory = createInMemoryRoomDirectory();

/**
 * Returns a localStorage-backed peer id store when available.
 */
export function createLocalStoragePeerIdStorage(
  storageKey: string = TriviaPeerIdStorageKey,
): PeerIdStorage | null {
  const localStorage = getLocalStorage();
  if (!localStorage) {
    return null;
  }

  return {
    get: () => localStorage.getItem(storageKey),
    set: (value: string) => localStorage.setItem(storageKey, value),
    clear: () => localStorage.removeItem(storageKey),
  };
}

function resolvePeerIdStorage(
  storage: PeerIdStorage | null | undefined,
): PeerIdStorage | null {
  if (storage === null) {
    return null;
  }
  return storage ?? createLocalStoragePeerIdStorage();
}

function getLocalStorage(): Storage | null {
  if (typeof globalThis === "undefined") {
    return null;
  }
  if ("localStorage" in globalThis) {
    return globalThis.localStorage;
  }
  return null;
}

function encodeBase64(value: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value).toString("base64");
  }
  if (typeof btoa !== "undefined") {
    const text = String.fromCharCode(...value);
    return btoa(text);
  }
  throw new Error("Base64 encoding is not supported in this environment");
}

function decodeBase64(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(value, "base64"));
  }
  if (typeof atob !== "undefined") {
    const text = atob(value);
    const bytes = new Uint8Array(text.length);
    for (let index = 0; index < text.length; index += 1) {
      bytes[index] = text.charCodeAt(index);
    }
    return bytes;
  }
  throw new Error("Base64 decoding is not supported in this environment");
}

/**
 * Creates a peer identity, reusing a stored one when available.
 */
export async function createPeerId(
  options: CreatePeerIdOptions = {},
): Promise<PeerId> {
  const storage = resolvePeerIdStorage(options.storage);
  if (storage && !options.refresh) {
    const stored = storage.get();
    if (stored) {
      try {
        const peerId = await createFromProtobuf(decodeBase64(stored));
        return peerId as PeerId;
      } catch {
        storage.clear();
      }
    }
  }

  const generated = await createEd25519PeerId();
  const peerId = generated as PeerId;
  if (storage) {
    storage.set(encodeBase64(exportToProtobuf(generated)));
  }
  return peerId;
}

/**
 * Clears the stored peer identity and creates a fresh one.
 */
export async function refreshPeerId(
  options: CreatePeerIdOptions = {},
): Promise<PeerId> {
  const storage = resolvePeerIdStorage(options.storage);
  storage?.clear();
  return createPeerId({ storage, refresh: true });
}

/**
 * Builds a libp2p node configured for relays and trivia pubsub.
 */
export async function createNetworkingNode(
  options: CreateNetworkingNodeOptions = {},
): Promise<Libp2pLike> {
  // Resolve identity, relay configuration, and listen addresses.
  const peerId =
    options.peerId ??
    (await createPeerId({
      storage: options.peerIdStorage,
      refresh: options.refreshPeerId,
    }));
  const relayMultiaddrs = options.relayMultiaddrs ?? [];
  const listenAddresses = options.listenAddresses ?? [
    "/p2p-circuit",
    "/webrtc",
  ];
  const roomDirectory = options.roomDirectory ?? DefaultRoomDirectory;

  // Load WebRTC transport lazily to keep bundles lean.
  const { webRTC } = await import("@libp2p/webrtc");

  // Create the libp2p node with transports, security, and pubsub services.
  const node = await createLibp2p({
    peerId,
    addresses: {
      listen: listenAddresses,
    },
    transports: [webSockets(), webRTC(), circuitRelayTransport()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery:
      relayMultiaddrs.length > 0 ? [bootstrap({ list: relayMultiaddrs })] : [],
    services: {
      identify: identify(),
      pubsub: gossipsub({ emitSelf: false }),
    },
  });

  // Attach room discovery so consumers can advertise/discover peers.
  const libp2pNode = node as Libp2pLike;
  libp2pNode.roomDirectory = roomDirectory;

  return libp2pNode;
}

export async function connectToRelay(
  node: Libp2pLike,
  relayMultiaddr: string,
): Promise<void> {
  if (!relayMultiaddr) {
    throw new Error("Relay multiaddr is required");
  }

  await node.dial(multiaddr(relayMultiaddr));
}

export async function advertiseRoom(
  node: Libp2pLike,
  roomCode: string,
): Promise<void> {
  const directory = getRoomDirectory(node);
  await directory.advertise(roomNamespace(roomCode), node.peerId);
}

export async function* discoverRoomPeers(
  node: Libp2pLike,
  roomCode: string,
): AsyncGenerator<PeerId> {
  const directory = getRoomDirectory(node);
  const namespace = roomNamespace(roomCode);

  for await (const peerId of directory.discover(namespace, node.peerId)) {
    yield peerId;
  }
}

/**
 * Elects the active host for a room using discovery and metadata.
 */
export async function electRoomHost(
  node: Libp2pLike,
  roomCode: string,
  options: ElectRoomHostOptions = {},
): Promise<HostSelection | null> {
  const candidates: HostCandidate[] = [...(options.candidates ?? [])];

  candidates.push({
    peerId: node.peerId,
    joinedAt: options.selfJoinedAt,
  });

  for await (const peerId of discoverRoomPeers(node, roomCode)) {
    candidates.push({ peerId });
  }

  return electHost(candidates, options);
}

/**
 * Creates a trivia peer with optional auto-start, relay dialing, and room setup.
 */
export async function createTriviaPeer(
  options: CreateTriviaPeerOptions = {},
): Promise<TriviaPeer> {
  // Resolve identity and networking configuration for this peer.
  const peerId =
    options.peerId ??
    (await createPeerId({
      storage: options.peerIdStorage,
      refresh: options.refreshPeerId,
    }));
  const relayMultiaddrs = options.relayMultiaddrs ?? [];
  const roomDirectory = options.roomDirectory ?? DefaultRoomDirectory;

  // Create or inject the libp2p node implementation.
  let node: Libp2pLike;

  if (options.libp2pFactory) {
    node = await options.libp2pFactory(peerId);
  } else {
    node = await createNetworkingNode({
      peerId,
      relayMultiaddrs,
      listenAddresses: options.listenAddresses,
      roomDirectory,
    });
  }

  // Ensure the node can advertise/discover room peers.
  if (!node.roomDirectory) {
    node.roomDirectory = roomDirectory;
  }

  // Optional lifecycle automation for start, relay dialing, and advertising.
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

  // Return a focused peer API for callers.
  return {
    node,
    peerId: node.peerId,
    connectToRelay: async (relayMultiaddr: string) =>
      connectToRelay(node, relayMultiaddr),
    advertiseRoom: async (roomCode: string) => advertiseRoom(node, roomCode),
    discoverRoomPeers: (roomCode: string) => discoverRoomPeers(node, roomCode),
    electRoomHost: (roomCode: string, options?: ElectRoomHostOptions) =>
      electRoomHost(node, roomCode, options),
    stop: async () => node.stop(),
  };
}

function getRoomDirectory(node: Libp2pLike): RoomDirectory {
  return node.roomDirectory ?? DefaultRoomDirectory;
}

function roomNamespace(roomCode: string): string {
  const normalized = roomCode.trim().toLowerCase().replace(/\s+/g, "-");
  if (!normalized) {
    throw new Error("Room code is required");
  }

  return `${TriviaRoomPrefix}${normalized}`;
}
