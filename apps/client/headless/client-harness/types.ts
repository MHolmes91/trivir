import type {
  CreateTriviaPeerOptions,
  Libp2pLike,
  TriviaPeer,
} from "@lib/networking/types";
import type { PubsubService, TriviaPubsub } from "@lib/pubsub/types";

export interface Libp2pWithPubsub extends Libp2pLike {
  services: {
    pubsub: PubsubService;
  };
}

export interface HeadlessPeerOptions extends CreateTriviaPeerOptions {
  roomCode: string;
}

export interface HeadlessPeer {
  peer: TriviaPeer;
  pubsub: TriviaPubsub;
  roomCode: string;
  stop: () => Promise<void>;
}
