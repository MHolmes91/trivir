import Gun from "gun";
import SEA from "gun/sea";

import type {
  CreateStateDbOptions,
  EventLogEntry,
  GunChain,
  GunInstance,
  GunLink,
  PlayerState,
  RoomStateDb,
  ScoreState,
} from "../types";

type MapEntry<T> = {
  key: string;
  value: T;
};

const DefaultCollectTimeoutMs = 100;
const DefaultPutTimeoutMs = 200;

/**
 * Creates room-scoped GunDB helpers with SEA event signing.
 */
export async function createRoomStateDb(
  options: CreateStateDbOptions,
): Promise<RoomStateDb> {
  const gun =
    options.gun ??
    (Gun({
      peers: options.peers ?? [],
      localStorage: false,
      multicast: false,
    }) as unknown as GunChain);
  const keys = options.keys ?? (await SEA.pair());
  const room = gun.get("rooms").get(normalizeRoomCode(options.roomCode));
  const players = room.get<PlayerState>("players");
  const scores = room.get<ScoreState>("scores");
  const events = room.get<EventLogEntry>("events");
  const playerIndex = room.get<boolean>("playerIndex");
  const scoreIndex = room.get<boolean>("scoreIndex");
  const eventIndex = room.get<boolean>("eventIndex");

  return {
    gun,
    keys,
    setPlayer: async (player) => {
      const record: PlayerState = {
        ...player,
        joinedAt: Date.now(),
      };
      await putPromise(players.get(record.id), record);
      await putPromise(playerIndex.get(record.id), true);
    },
    listPlayers: async () => {
      const ids = await readIndexKeys(playerIndex);
      const records = await readByKeys<PlayerState>(players, ids);
      return resolveLatestPlayers(records);
    },
    setScore: async (score) => {
      const record: ScoreState = {
        ...score,
        updatedAt: Date.now(),
      };
      await putPromise(scores.get(record.playerId), record);
      await putPromise(scoreIndex.get(record.playerId), true);
    },
    listScores: async () => {
      const ids = await readIndexKeys(scoreIndex);
      const records = await readByKeys<ScoreState>(scores, ids);
      return resolveLatestScores(records);
    },
    appendEvent: async (event, overrides = {}) => {
      const timestamp = overrides.timestamp ?? Date.now();
      const record: EventLogEntry = {
        ...event,
        timestamp,
      };
      const signature = await SEA.sign(record, keys);
      await putPromise(events.get(record.id), {
        ...record,
        signature,
        publicKey: keys.pub,
      });
      await putPromise(eventIndex.get(record.id), true);
    },
    listEvents: async () => {
      const ids = await readIndexKeys(eventIndex);
      const records = await readByKeys<EventLogEntry>(events, ids);
      return resolveLatestEvents(records);
    },
    verifyEvent: async (event) => {
      if (!event.signature || !event.publicKey) {
        return false;
      }
      const verified = await SEA.verify(event.signature, event.publicKey);
      if (!isEventLogEntry(verified)) {
        return false;
      }
      return verified.id === event.id && verified.timestamp === event.timestamp;
    },
  };
}

export function linkGunPeers(left: GunInstance, right: GunInstance): void {
  left.on?.("out", (message: unknown) => {
    right.on?.("in", message);
  });
  right.on?.("out", (message: unknown) => {
    left.on?.("in", message);
  });
}

function normalizeRoomCode(roomCode: string): string {
  const normalized = roomCode.trim().toLowerCase().replace(/\s+/g, "-");
  if (!normalized) {
    throw new Error("Room code is required");
  }
  return normalized;
}

function resolveLatestPlayers(players: PlayerState[]): PlayerState[] {
  const byPlayer = new Map<string, PlayerState>();
  for (const player of players) {
    if (!player?.id) {
      continue;
    }
    const existing = byPlayer.get(player.id);
    if (!existing || player.joinedAt >= existing.joinedAt) {
      byPlayer.set(player.id, player);
    }
  }
  return Array.from(byPlayer.values());
}

function resolveLatestScores(scores: ScoreState[]): ScoreState[] {
  const byPlayer = new Map<string, ScoreState>();
  for (const score of scores) {
    if (!score?.playerId) {
      continue;
    }
    const existing = byPlayer.get(score.playerId);
    if (!existing || score.updatedAt >= existing.updatedAt) {
      byPlayer.set(score.playerId, score);
    }
  }
  return Array.from(byPlayer.values());
}

function resolveLatestEvents(events: EventLogEntry[]): EventLogEntry[] {
  const byId = new Map<string, EventLogEntry>();
  for (const entry of events) {
    if (!entry?.id) {
      continue;
    }
    const existing = byId.get(entry.id);
    if (!existing || entry.timestamp >= existing.timestamp) {
      byId.set(entry.id, entry);
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function isEventLogEntry(value: unknown): value is EventLogEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as { id?: unknown; timestamp?: unknown };
  return typeof record.id === "string" && typeof record.timestamp === "number";
}

function isGunLink(value: unknown): value is GunLink {
  return Boolean(value && typeof value === "object" && "#" in value);
}

async function collectMap<T>(
  node: GunChain<T>,
  timeoutMs = DefaultCollectTimeoutMs,
): Promise<Array<MapEntry<T>>> {
  return new Promise((resolve) => {
    const results: Array<MapEntry<T>> = [];
    const seen = new Set<string>();
    const timeout = setTimeout(() => resolve(results), timeoutMs);

    node.map().once((value, key: string) => {
      if (value == null || seen.has(key)) {
        return;
      }
      seen.add(key);
      if (isGunLink(value)) {
        node.get<T>(key).once((resolved) => {
          if (resolved == null || isGunLink(resolved)) {
            return;
          }
          const typedResolved = resolved as T;
          results.push({ key, value: typedResolved });
          clearTimeout(timeout);
          setTimeout(() => resolve(results), timeoutMs);
        });
        return;
      }
      const typedValue = value as T;
      results.push({ key, value: typedValue });
      clearTimeout(timeout);
      setTimeout(() => resolve(results), timeoutMs);
    });
  });
}

async function readIndexKeys(node: GunChain<boolean>): Promise<string[]> {
  const entries = await collectMap<boolean>(node);
  return entries.map(({ key }) => key);
}

async function readByKey<T>(
  node: GunChain<T>,
  key: string,
  timeoutMs = DefaultCollectTimeoutMs,
): Promise<T | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), timeoutMs);
    node.get<T>(key).once((value) => {
      clearTimeout(timeout);
      if (value == null || isGunLink(value)) {
        resolve(null);
        return;
      }
      resolve(value as T);
    });
  });
}

async function readByKeys<T>(node: GunChain<T>, keys: string[]): Promise<T[]> {
  const entries = await Promise.all(keys.map((key) => readByKey<T>(node, key)));
  return entries.filter(isDefined);
}

function isDefined<T>(value: T | null): value is T {
  return value !== null;
}

async function putPromise<T>(
  node: GunChain<T>,
  value: T,
  timeoutMs = DefaultPutTimeoutMs,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    }, timeoutMs);

    node.put(value, (ack: { err?: string }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (ack?.err) {
        reject(new Error(ack.err));
      } else {
        resolve();
      }
    });
  });
}
