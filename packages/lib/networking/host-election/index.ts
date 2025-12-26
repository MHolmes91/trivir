import type {
  HostCandidate,
  HostElectionOptions,
  HostSelection,
} from "../types";

export function electHost(
  candidates: HostCandidate[],
  options: HostElectionOptions = {},
): HostSelection | null {
  if (!candidates.length) {
    return null;
  }

  const normalized = normalizeCandidates(candidates);
  if (!normalized.length) {
    return null;
  }

  const currentHostId = options.currentHostId
    ? peerIdToString(options.currentHostId)
    : null;
  if (currentHostId) {
    const existing = normalized.find(
      (candidate) => candidate.peerId === currentHostId,
    );
    if (existing) {
      return existing;
    }
  }

  normalized.sort(compareCandidates);
  return normalized[0] ?? null;
}

function normalizeCandidates(candidates: HostCandidate[]): HostSelection[] {
  const byPeerId = new Map<string, HostSelection>();

  for (const candidate of candidates) {
    const peerId = peerIdToString(candidate.peerId).trim();
    if (!peerId) {
      throw new Error("Peer id is required");
    }
    const joinedAt = candidate.joinedAt;
    if (joinedAt !== undefined && !Number.isFinite(joinedAt)) {
      throw new Error("Join timestamp must be finite");
    }

    const existing = byPeerId.get(peerId);
    if (!existing) {
      byPeerId.set(peerId, { peerId, joinedAt });
      continue;
    }

    const resolvedJoinedAt = resolveJoinTimestamp(existing.joinedAt, joinedAt);
    byPeerId.set(peerId, { peerId, joinedAt: resolvedJoinedAt });
  }

  return Array.from(byPeerId.values());
}

function resolveJoinTimestamp(
  existing?: number,
  next?: number,
): number | undefined {
  if (existing === undefined) {
    return next;
  }
  if (next === undefined) {
    return existing;
  }
  return Math.min(existing, next);
}

function compareCandidates(a: HostSelection, b: HostSelection): number {
  const aJoined = a.joinedAt;
  const bJoined = b.joinedAt;

  if (aJoined !== undefined && bJoined !== undefined && aJoined !== bJoined) {
    return aJoined - bJoined;
  }
  if (aJoined !== undefined && bJoined === undefined) {
    return -1;
  }
  if (aJoined === undefined && bJoined !== undefined) {
    return 1;
  }
  if (a.peerId === b.peerId) {
    return 0;
  }
  return a.peerId < b.peerId ? -1 : 1;
}

function peerIdToString(peerId: HostCandidate["peerId"]): string {
  return typeof peerId === "string" ? peerId : peerId.toString();
}
