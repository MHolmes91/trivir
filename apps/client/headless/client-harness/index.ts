import { createTriviaPeer } from "@lib/networking";
import { createTriviaPubsub } from "@lib/pubsub/events";
import type { PubsubService } from "@lib/pubsub/types";
import type {
  HeadlessPeer,
  HeadlessPeerOptions,
  Libp2pWithPubsub,
} from "./types";

function getPubsubService(node: {
  services?: { pubsub?: PubsubService };
}): PubsubService {
  const pubsub = node.services?.pubsub;
  if (!pubsub) {
    throw new Error("Pubsub service is required for headless peers");
  }
  return pubsub;
}

export async function createHeadlessPeer(
  options: HeadlessPeerOptions,
): Promise<HeadlessPeer> {
  const peer = await createTriviaPeer(options);
  const pubsub = await createTriviaPubsub({
    pubsub: getPubsubService(peer.node as Libp2pWithPubsub),
    roomCode: options.roomCode,
  });

  return {
    peer,
    pubsub,
    roomCode: options.roomCode,
    stop: async () => {
      await pubsub.stop();
      await peer.stop();
    },
  };
}
