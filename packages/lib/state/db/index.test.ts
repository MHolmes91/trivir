import { describe, expect, it } from "bun:test";
import { createRoomStateDb } from "./index";

type WaitPredicate<T> = (value: T) => boolean;

async function waitFor<T>(
  action: () => Promise<T>,
  predicate: WaitPredicate<T>,
  timeoutMs = 2000,
  intervalMs = 25,
): Promise<T> {
  const start = Date.now();
  let value = await action();

  while (!predicate(value) && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    value = await action();
  }

  return value;
}

type MockGunData = {
  key: string;
  value: unknown;
  children: Map<string, MockGunData>;
};

// Test-only fake; not preferred over real Gun instances.
class MockGunNode {
  private readonly data: MockGunData;
  private readonly mapMode: boolean;

  constructor(data?: MockGunData, mapMode = false) {
    this.data =
      data ??
      ({
        key: "",
        value: null,
        children: new Map<string, MockGunData>(),
      } satisfies MockGunData);
    this.mapMode = mapMode;
  }

  get(key: string): MockGunNode {
    let child = this.data.children.get(key);
    if (!child) {
      child = { key, value: null, children: new Map<string, MockGunData>() };
      this.data.children.set(key, child);
    }
    return new MockGunNode(child);
  }

  put(value: unknown, cb?: (ack: { err?: string }) => void): void {
    this.data.value = value;
    cb?.({});
  }

  set(value: unknown, cb?: (ack: { err?: string }) => void): void {
    const key = `item-${this.data.children.size + 1}`;
    this.get(key).put(value);
    cb?.({});
  }

  map(): MockGunNode {
    return new MockGunNode(this.data, true);
  }

  once(cb: (value: unknown, key: string) => void): void {
    if (this.mapMode) {
      for (const [key, child] of this.data.children) {
        cb(child.value, key);
      }
      return;
    }
    cb(this.data.value, this.data.key);
  }

  on(event: string, handler: (message: unknown) => void): void {
    void event;
    void handler;
  }
}

function createMockGun(): MockGunNode {
  return new MockGunNode();
}

describe("state db", () => {
  it("Write/read state across peers", async () => {
    const gun = createMockGun();

    const dbA = await createRoomStateDb({ roomCode: "Room Sync", gun });
    const dbB = await createRoomStateDb({ roomCode: "Room Sync", gun });

    await dbA.setPlayer({ id: "player-1", name: "Ada" });
    await dbA.setScore({ playerId: "player-1", score: 10 });
    await dbA.appendEvent(
      {
        id: "event-1",
        type: "join",
        payload: { playerId: "player-1" },
      },
      { timestamp: 1000 },
    );

    const players = await waitFor(
      () => dbB.listPlayers(),
      (list) => list.some((player) => player.id === "player-1"),
    );
    const scores = await waitFor(
      () => dbB.listScores(),
      (list) => list.some((score) => score.playerId === "player-1"),
    );
    const events = await waitFor(
      () => dbB.listEvents(),
      (list) => list.some((entry) => entry.id === "event-1"),
    );

    expect(players.find((player) => player.id === "player-1")?.name).toBe(
      "Ada",
    );
    expect(scores.find((score) => score.playerId === "player-1")?.score).toBe(
      10,
    );

    const event = events.find((entry) => entry.id === "event-1");
    expect(event?.type).toBe("join");
    expect(await dbB.verifyEvent(event!)).toBe(true);
  }, 10000);

  it("Sync events and resolve conflicts correctly", async () => {
    const gun = createMockGun();

    const dbA = await createRoomStateDb({ roomCode: "Room 9", gun });
    const dbB = await createRoomStateDb({ roomCode: "Room 9", gun });

    await dbA.appendEvent(
      {
        id: "event-2",
        type: "roundStart",
        payload: { round: 1 },
      },
      { timestamp: 1000 },
    );

    await dbB.appendEvent(
      {
        id: "event-2",
        type: "roundStart",
        payload: { round: 2 },
      },
      { timestamp: 2000 },
    );

    const events = await waitFor(
      () => dbA.listEvents(),
      (list) =>
        list.some(
          (entry) => entry.id === "event-2" && entry.timestamp === 2000,
        ),
    );

    const resolved = events.find((entry) => entry.id === "event-2");
    const payload = resolved?.payload as { round: number } | undefined;

    expect(resolved?.timestamp).toBe(2000);
    expect(payload?.round).toBe(2);
  }, 10000);
});
