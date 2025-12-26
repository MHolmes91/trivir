import { describe, expect, it } from "bun:test";
import { createPeerId } from "../index";
import { electHost } from "./index";

describe("host election", () => {
  it("Each peer computes the same host selection", async () => {
    const [peerA, peerB, peerC] = await Promise.all([
      createPeerId(),
      createPeerId(),
      createPeerId(),
    ]);

    const candidates = [
      { peerId: peerA, joinedAt: 100 },
      { peerId: peerB, joinedAt: 200 },
      { peerId: peerC, joinedAt: 150 },
    ];

    const selectionA = electHost([candidates[1], candidates[2], candidates[0]]);
    const selectionB = electHost([candidates[2], candidates[0], candidates[1]]);

    expect(selectionA?.peerId).toBe(peerA.toString());
    expect(selectionB?.peerId).toBe(peerA.toString());
  });

  it("Simulate 3 peers, remove host, verify next host selection", async () => {
    const [peerA, peerB, peerC] = await Promise.all([
      createPeerId(),
      createPeerId(),
      createPeerId(),
    ]);

    const candidates = [
      { peerId: peerA, joinedAt: 100 },
      { peerId: peerB, joinedAt: 200 },
      { peerId: peerC, joinedAt: 150 },
    ];

    const selection = electHost([candidates[1], candidates[2]], {
      currentHostId: peerA,
    });

    expect(selection?.peerId).toBe(peerC.toString());
  });

  it("Deterministic fallback rules (PeerID sort / timestamp)", () => {
    const candidates = [
      { peerId: "peer-b", joinedAt: 1000 },
      { peerId: "peer-a", joinedAt: 1000 },
      { peerId: "peer-c" },
    ];

    const selection = electHost(candidates);

    expect(selection?.peerId).toBe("peer-a");
  });
});
