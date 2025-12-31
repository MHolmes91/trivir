import type { PeerId } from "@libp2p/interface-peer-id";
import type { Multiaddr } from "@multiformats/multiaddr";

export interface RoomDirectory {
  advertise: (namespace: string, peerId: PeerId) => Promise<void>;
  discover: (namespace: string, selfPeerId: PeerId) => AsyncIterable<PeerId>;
}

export interface PeerIdStorage {
  get: () => string | null;
  set: (value: string) => void;
  clear: () => void;
}

export interface CreatePeerIdOptions {
  storage?: PeerIdStorage | null;
  refresh?: boolean;
}

export interface Libp2pLike {
  peerId: PeerId;
  dial: (addr: Multiaddr) => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  roomDirectory?: RoomDirectory;
}

export interface CreateNetworkingNodeOptions {
  peerId?: PeerId;
  relayMultiaddrs?: string[];
  listenAddresses?: string[];
  roomDirectory?: RoomDirectory;
  peerIdStorage?: PeerIdStorage | null;
  refreshPeerId?: boolean;
  allowInsecureWebSockets?: boolean;
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
  electRoomHost: (
    roomCode: string,
    options?: ElectRoomHostOptions,
  ) => Promise<HostSelection | null>;
  stop: () => Promise<void>;
}

export interface HostCandidate {
  peerId: PeerId | string;
  joinedAt?: number;
}

export interface HostElectionOptions {
  currentHostId?: PeerId | string | null;
}

export interface HostSelection {
  peerId: string;
  joinedAt?: number;
}

export interface ElectRoomHostOptions extends HostElectionOptions {
  candidates?: HostCandidate[];
  selfJoinedAt?: number;
}
