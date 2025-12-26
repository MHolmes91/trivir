import { describe, expect, it } from "bun:test";
import {
  advertiseRoom,
  connectToRelay,
  createInMemoryRoomDirectory,
  createPeerId,
  createTriviaPeer,
  discoverRoomPeers,
  electRoomHost,
  refreshPeerId,
} from "./index";
import type { Libp2pLike, RoomDirectory } from "./types";
import type { PeerId } from "@libp2p/interface-peer-id";
import type { Multiaddr } from "@multiformats/multiaddr";

const RelayMultiaddr =
  "/dns4/relay.example.com/tcp/443/wss/p2p/12D3KooWJmZCWny8tX6N4ydNfJgwJ2b9wH2iT4sQQPmvxg7zqyyx";

class MockNode implements Libp2pLike {
  peerId: PeerId;
  dialed: Multiaddr[] = [];
  roomDirectory?: RoomDirectory;

  constructor(peerId: PeerId, roomDirectory?: RoomDirectory) {
    this.peerId = peerId;
    this.roomDirectory = roomDirectory;
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  async dial(addr: Multiaddr): Promise<void> {
    this.dialed.push(addr);
  }
}

describe("networking", () => {
  it("Peer initializes with unique PeerID", async () => {
    const factory = async (peerId: PeerId) => new MockNode(peerId);

    const first = await createTriviaPeer({
      libp2pFactory: factory,
      autoStart: false,
    });
    const second = await createTriviaPeer({
      libp2pFactory: factory,
      autoStart: false,
    });

    expect(first.peerId.toString()).not.toBe(second.peerId.toString());
  });

  it("Persists peer ID in storage and can refresh", async () => {
    let stored: string | null = null;
    const storage = {
      get: () => stored,
      set: (value: string) => {
        stored = value;
      },
      clear: () => {
        stored = null;
      },
    };

    const first = await createPeerId({ storage });
    const second = await createPeerId({ storage });

    expect(second.toString()).toBe(first.toString());

    const refreshed = await refreshPeerId({ storage });
    expect(refreshed.toString()).not.toBe(first.toString());
  });

  it("Peer connects to relay multiaddr", async () => {
    const node = new MockNode(await createPeerId());

    await connectToRelay(node, RelayMultiaddr);

    expect(node.dialed).toHaveLength(1);
    expect(node.dialed[0].toString()).toBe(RelayMultiaddr);
  });

  it("Peer advertises and discovers room code peers", async () => {
    const directory = createInMemoryRoomDirectory();
    const advertiser = new MockNode(await createPeerId(), directory);
    const discoverer = new MockNode(await createPeerId(), directory);

    await advertiseRoom(advertiser, "Room-42");

    const discovered: PeerId[] = [];
    for await (const id of discoverRoomPeers(discoverer, "Room-42")) {
      discovered.push(id);
    }

    expect(discovered.map((entry) => entry.toString())).toEqual([
      advertiser.peerId.toString(),
    ]);
  });

  it("Elects host using join timestamps and room discovery", async () => {
    const directory = createInMemoryRoomDirectory();
    const peerA = new MockNode(await createPeerId(), directory);
    const peerB = new MockNode(await createPeerId(), directory);
    const peerC = new MockNode(await createPeerId(), directory);

    await advertiseRoom(peerA, "Room-Host");
    await advertiseRoom(peerB, "Room-Host");
    await advertiseRoom(peerC, "Room-Host");

    const selection = await electRoomHost(peerA, "Room-Host", {
      selfJoinedAt: 200,
      candidates: [
        { peerId: peerB.peerId, joinedAt: 100 },
        { peerId: peerC.peerId, joinedAt: 300 },
      ],
    });

    expect(selection?.peerId).toBe(peerB.peerId.toString());
    expect(selection?.joinedAt).toBe(100);
  });
});
