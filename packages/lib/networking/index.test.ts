import { describe, expect, it } from "bun:test";
import {
  advertiseRoom,
  connectToRelay,
  createPeerId,
  createTriviaPeer,
  discoverRoomPeers,
  type Libp2pLike
} from "./index";
import type { PeerId } from "@libp2p/interface-peer-id";
import type { Multiaddr } from "@multiformats/multiaddr";

const RELAY_MULTIADDR =
  "/dns4/relay.example.com/tcp/443/wss/p2p/12D3KooWJmZCWny8tX6N4ydNfJgwJ2b9wH2iT4sQQPmvxg7zqyyx";

class MockRendezvous {
  registered: string[] = [];
  discoverRequests: string[] = [];
  discovered: Array<{ id: PeerId }> = [];

  async register(namespace: string): Promise<void> {
    this.registered.push(namespace);
  }

  async *discover(namespace: string): AsyncGenerator<{ id: PeerId }> {
    this.discoverRequests.push(namespace);
    for (const entry of this.discovered) {
      yield entry;
    }
  }
}

class MockNode implements Libp2pLike {
  peerId: PeerId;
  dialed: Multiaddr[] = [];
  services?: { rendezvous?: MockRendezvous };

  constructor(peerId: PeerId, rendezvous?: MockRendezvous) {
    this.peerId = peerId;
    this.services = { rendezvous };
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
      autoStart: false
    });
    const second = await createTriviaPeer({
      libp2pFactory: factory,
      autoStart: false
    });

    expect(first.peerId.toString()).not.toBe(second.peerId.toString());
  });

  it("Peer connects to relay multiaddr", async () => {
    const node = new MockNode(await createPeerId());

    await connectToRelay(node, RELAY_MULTIADDR);

    expect(node.dialed).toHaveLength(1);
    expect(node.dialed[0].toString()).toBe(RELAY_MULTIADDR);
  });

  it("Peer advertises and discovers room code peers", async () => {
    const rendezvous = new MockRendezvous();
    const node = new MockNode(await createPeerId(), rendezvous);
    const peer = await createPeerId();
    rendezvous.discovered.push({ id: peer });

    await advertiseRoom(node, "Room-42");

    const discovered: PeerId[] = [];
    for await (const id of discoverRoomPeers(node, "Room-42")) {
      discovered.push(id);
    }

    expect(rendezvous.registered[0]).toBe("trivia-room:room-42");
    expect(rendezvous.discoverRequests[0]).toBe("trivia-room:room-42");
    expect(discovered.map((entry) => entry.toString())).toEqual([peer.toString()]);
  });
});
