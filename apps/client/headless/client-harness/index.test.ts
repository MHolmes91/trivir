import { describe, expect, it } from "bun:test";
import { TriviaRoomPrefix } from "@lib/constants";
import { createPeerId } from "@lib/networking";
import type { RoomDirectory } from "@lib/networking/types";
import type {
  PubsubMessageEvent,
  PubsubService,
  TriviaEvent,
} from "@lib/pubsub/types";
import { TriviaEventKind } from "@lib/pubsub/types";
import { createHeadlessPeer } from "./index";
import type { Libp2pWithPubsub } from "./types";

type MessageListener = (event: PubsubMessageEvent) => void;

class InMemoryPubsubBus {
  private readonly subscribers = new Map<string, Set<InMemoryPubsub>>();

  createClient(): InMemoryPubsub {
    return new InMemoryPubsub(this);
  }

  subscribe(topic: string, client: InMemoryPubsub): void {
    const clients = this.subscribers.get(topic) ?? new Set<InMemoryPubsub>();
    clients.add(client);
    this.subscribers.set(topic, clients);
  }

  unsubscribe(topic: string, client: InMemoryPubsub): void {
    const clients = this.subscribers.get(topic);
    if (!clients) {
      return;
    }

    clients.delete(client);
    if (clients.size === 0) {
      this.subscribers.delete(topic);
    }
  }

  publish(topic: string, data: Uint8Array): void {
    const clients = this.subscribers.get(topic);
    if (!clients) {
      return;
    }

    for (const client of clients) {
      client.dispatchMessage(topic, data);
    }
  }
}

class InMemoryPubsub implements PubsubService {
  readonly subscriptions = new Set<string>();
  private readonly bus: InMemoryPubsubBus;
  private readonly listeners = new Set<MessageListener>();

  constructor(bus: InMemoryPubsubBus) {
    this.bus = bus;
  }

  async subscribe(topic: string): Promise<void> {
    this.subscriptions.add(topic);
    this.bus.subscribe(topic, this);
  }

  async unsubscribe(topic: string): Promise<void> {
    this.subscriptions.delete(topic);
    this.bus.unsubscribe(topic, this);
  }

  async publish(topic: string, data: Uint8Array): Promise<void> {
    this.bus.publish(topic, data);
  }

  addEventListener(type: "message", listener: MessageListener): void {
    if (type === "message") {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: "message", listener: MessageListener): void {
    if (type === "message") {
      this.listeners.delete(listener);
    }
  }

  dispatchMessage(topic: string, data: Uint8Array): void {
    const event: PubsubMessageEvent = {
      detail: {
        topic,
        data,
      },
    };

    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

class RecordingRoomDirectory implements RoomDirectory {
  readonly advertised = new Map<string, string>();

  async advertise(
    namespace: string,
    peerId: Libp2pWithPubsub["peerId"],
  ): Promise<void> {
    this.advertised.set(namespace, peerId.toString());
  }

  async *discover(): AsyncIterable<Libp2pWithPubsub["peerId"]> {
    yield* [];
  }
}

class TestLibp2pNode implements Libp2pWithPubsub {
  peerId: Libp2pWithPubsub["peerId"];
  services: { pubsub: PubsubService };
  roomDirectory?: RoomDirectory;
  private readonly dialed: string[];

  constructor(
    peerId: Libp2pWithPubsub["peerId"],
    pubsub: PubsubService,
    dialed: string[],
  ) {
    this.peerId = peerId;
    this.services = { pubsub };
    this.dialed = dialed;
  }

  async dial(addr: Parameters<Libp2pWithPubsub["dial"]>[0]): Promise<void> {
    this.dialed.push(addr.toString());
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {}
}

async function waitForCount(
  getCount: () => number,
  expected: number,
  timeoutMs = 200,
): Promise<void> {
  const started = Date.now();
  while (getCount() < expected) {
    if (Date.now() - started > timeoutMs) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe("headless client harness", () => {
  it("Can boot a peer with a room code and connect to the relay", async () => {
    const bus = new InMemoryPubsubBus();
    const dialed: string[] = [];
    const roomDirectory = new RecordingRoomDirectory();
    const relayMultiaddr = "/ip4/127.0.0.1/tcp/9999/ws";

    const peer = await createHeadlessPeer({
      roomCode: "Room 1",
      relayMultiaddrs: [relayMultiaddr],
      roomDirectory,
      peerId: await createPeerId({ storage: null }),
      libp2pFactory: async (peerId) =>
        new TestLibp2pNode(peerId, bus.createClient(), dialed),
    });

    expect(dialed).toEqual([relayMultiaddr]);
    expect(Array.from(roomDirectory.advertised.keys())).toEqual([
      `${TriviaRoomPrefix}room-1`,
    ]);

    await peer.stop();
  });

  it("Can publish/receive pubsub events for a room", async () => {
    const bus = new InMemoryPubsubBus();

    const sender = await createHeadlessPeer({
      roomCode: "Room 7",
      peerId: await createPeerId({ storage: null }),
      libp2pFactory: async (peerId) =>
        new TestLibp2pNode(peerId, bus.createClient(), []),
    });
    const receiver = await createHeadlessPeer({
      roomCode: "Room 7",
      peerId: await createPeerId({ storage: null }),
      libp2pFactory: async (peerId) =>
        new TestLibp2pNode(peerId, bus.createClient(), []),
    });

    const received: TriviaEvent[] = [];
    receiver.pubsub.onEvent((event) => {
      received.push(event);
    });

    await sender.pubsub.publishEvent({
      type: TriviaEventKind.Join,
      payload: {
        note: "ready",
      },
    });

    await waitForCount(() => received.length, 1);

    expect(received[0]?.type).toBe(TriviaEventKind.Join);

    await sender.stop();
    await receiver.stop();
  });
});
