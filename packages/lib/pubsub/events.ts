import {
  TriviaEventTypes,
  type CreateTriviaPubsubOptions,
  type PubsubMessageEvent,
  type TriviaEvent,
  type TriviaEventType,
  type TriviaPubsub,
} from "./types";
import { TriviaRoomPrefix } from "../constants";

export { TriviaEventTypes } from "./types";
export type {
  CreateTriviaPubsubOptions,
  PubsubMessageEvent,
  PubsubService,
  TriviaEvent,
  TriviaEventType,
  TriviaPubsub,
} from "./types";

const Encoder = new TextEncoder();
const Decoder = new TextDecoder();

export async function createTriviaPubsub(
  options: CreateTriviaPubsubOptions,
): Promise<TriviaPubsub> {
  const { pubsub, roomCode, autoSubscribe = true } = options;
  const topic = roomTopic(roomCode);
  const listeners = new Set<(event: TriviaEvent) => void>();

  const handleMessage = (event: PubsubMessageEvent) => {
    if (event.detail.topic !== topic) {
      return;
    }

    const decoded = decodeEvent(event.detail.data);
    if (!decoded) {
      return;
    }

    for (const listener of listeners) {
      listener(decoded);
    }
  };

  pubsub.addEventListener("message", handleMessage);

  if (autoSubscribe) {
    await pubsub.subscribe(topic);
  }

  return {
    topic,
    subscribe: async () => pubsub.subscribe(topic),
    unsubscribe: async () => pubsub.unsubscribe(topic),
    publishEvent: async (event: TriviaEvent) =>
      pubsub.publish(topic, encodeEvent(event)),
    onEvent: (handler: (event: TriviaEvent) => void) => {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    stop: async () => {
      listeners.clear();
      pubsub.removeEventListener("message", handleMessage);
      await pubsub.unsubscribe(topic);
    },
  };
}

export function isTriviaEventType(value: unknown): value is TriviaEventType {
  return TriviaEventTypes.includes(value as TriviaEventType);
}

export function encodeEvent(event: TriviaEvent): Uint8Array {
  return Encoder.encode(JSON.stringify(event));
}

export function decodeEvent(data: Uint8Array): TriviaEvent | null {
  try {
    const parsed = JSON.parse(Decoder.decode(data));
    if (!isTriviaEvent(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function isTriviaEvent(value: unknown): value is TriviaEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return isTriviaEventType(record.type);
}

export function roomTopic(roomCode: string): string {
  const normalized = roomCode.trim().toLowerCase().replace(/\s+/g, "-");
  if (!normalized) {
    throw new Error("Room code is required");
  }

  return `${TriviaRoomPrefix}${normalized}`;
}
