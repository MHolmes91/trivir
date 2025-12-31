import { createHeadlessPeer } from "../client-harness";
import type {
  HeadlessPeer,
  HeadlessPeerOptions,
} from "../client-harness/types";

export async function createBrowserHeadlessPeer(
  options: HeadlessPeerOptions,
): Promise<HeadlessPeer> {
  return createHeadlessPeer(options);
}
