export interface GunChain {
  get: (key: string) => GunChain;
  put: (value: unknown, cb?: (ack: { err?: string }) => void) => void;
  set: (value: unknown, cb?: (ack: { err?: string }) => void) => void;
  map: () => GunChain;
  once: (cb: (value: unknown, key: string) => void) => void;
  on?: (event: string, handler: ((message: unknown) => void) | unknown) => void;
}

export type GunInstance = GunChain;

export interface PlayerState {
  id: string;
  name: string;
  joinedAt: number;
}

export interface ScoreState {
  playerId: string;
  score: number;
  updatedAt: number;
}

export interface EventLogEntry {
  id: string;
  type: string;
  payload: unknown;
  timestamp: number;
  signature?: string;
  publicKey?: string;
}

export interface CreateStateDbOptions {
  roomCode: string;
  gun?: GunInstance;
  peers?: string[];
  keys?: GunKeyPair;
}

export interface GunKeyPair {
  pub: string;
  priv: string;
  epriv?: string;
  epub?: string;
}

export interface RoomStateDb {
  gun: GunInstance;
  keys: GunKeyPair;
  setPlayer: (player: Omit<PlayerState, "joinedAt">) => Promise<void>;
  listPlayers: () => Promise<PlayerState[]>;
  setScore: (score: Omit<ScoreState, "updatedAt">) => Promise<void>;
  listScores: () => Promise<ScoreState[]>;
  appendEvent: (
    event: Omit<EventLogEntry, "timestamp">,
    overrides?: { timestamp?: number },
  ) => Promise<void>;
  listEvents: () => Promise<EventLogEntry[]>;
  verifyEvent: (event: EventLogEntry) => Promise<boolean>;
}
