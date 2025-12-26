export const enum TriviaEventKind {
  Join = "join",
  Leave = "leave",
  GameStart = "gameStart",
  GameEnd = "gameEnd",
  RoundStart = "roundStart",
  RoundEnd = "roundEnd",
  AnswerSubmit = "answerSubmit",
}

export const TriviaEventTypes = [
  TriviaEventKind.Join,
  TriviaEventKind.Leave,
  TriviaEventKind.GameStart,
  TriviaEventKind.GameEnd,
  TriviaEventKind.RoundStart,
  TriviaEventKind.RoundEnd,
  TriviaEventKind.AnswerSubmit,
] as const;

export type TriviaEventType = TriviaEventKind;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };

export type TriviaEventPayload = Record<string, JsonValue>;

export interface TriviaEvent {
  type: TriviaEventType;
  payload?: TriviaEventPayload;
}

export interface PubsubMessageEvent {
  detail: {
    topic: string;
    data: Uint8Array;
  };
}

export interface PubsubService {
  subscribe: (topic: string) => Promise<void>;
  unsubscribe: (topic: string) => Promise<void>;
  publish: (topic: string, data: Uint8Array) => Promise<void>;
  addEventListener: (
    type: "message",
    listener: (event: PubsubMessageEvent) => void,
  ) => void;
  removeEventListener: (
    type: "message",
    listener: (event: PubsubMessageEvent) => void,
  ) => void;
}

export interface TriviaPubsub {
  topic: string;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
  publishEvent: (event: TriviaEvent) => Promise<void>;
  onEvent: (handler: (event: TriviaEvent) => void) => () => void;
  stop: () => Promise<void>;
}

export interface CreateTriviaPubsubOptions {
  pubsub: PubsubService;
  roomCode: string;
  autoSubscribe?: boolean;
}
