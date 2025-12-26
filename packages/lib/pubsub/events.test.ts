import { describe, expect, it } from "bun:test";
import { createTriviaPubsub } from "./events";
import {
  TriviaEventTypes,
  type PubsubMessageEvent,
  type PubsubService,
  type TriviaEvent,
} from "./types";

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
    const event = {
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

describe("pubsub events", () => {
  it("Can subscribe to a room topic", async () => {
    const bus = new InMemoryPubsubBus();
    const pubsub = bus.createClient();

    const trivia = await createTriviaPubsub({
      pubsub,
      roomCode: "Room 42",
    });

    expect(pubsub.subscriptions.has(trivia.topic)).toBe(true);
  });

  it("Can publish/receive each event type", async () => {
    const bus = new InMemoryPubsubBus();
    const sender = bus.createClient();
    const receiver = bus.createClient();

    const senderTrivia = await createTriviaPubsub({
      pubsub: sender,
      roomCode: "Room 7",
    });
    const receiverTrivia = await createTriviaPubsub({
      pubsub: receiver,
      roomCode: "Room 7",
    });

    const received: TriviaEvent[] = [];
    receiverTrivia.onEvent((event) => {
      received.push(event);
    });

    for (const type of TriviaEventTypes) {
      await senderTrivia.publishEvent({
        type,
        payload: {
          note: type,
        },
      });
    }

    await waitForCount(() => received.length, TriviaEventTypes.length);

    expect(received.map((event) => event.type)).toEqual(TriviaEventTypes);
  });
});
