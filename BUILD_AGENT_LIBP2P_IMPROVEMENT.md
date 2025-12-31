# libp2p Circuit Relay + WebRTC Signalling and NAT Traversal

This document guides the implementation of a decentralized peer connection system using:

- libp2p core
- GossipSub for peer discovery (signalling)
- Circuit Relay V2 for NAT traversal (TURN-like fallback)
- WebRTC transport (browser)
- WebSockets fallback

## Overview

## Documentation Links

Use these sources for up-to-date behavior and APIs:

- libp2p concepts: https://docs.libp2p.io/
- js-libp2p (implementation and examples): https://github.com/libp2p/js-libp2p
- GossipSub concept: https://docs.libp2p.io/concepts/pubsub/
- js-libp2p-gossipsub package: https://github.com/ChainSafe/js-libp2p-gossipsub
- Circuit Relay v2: https://docs.libp2p.io/concepts/nat/circuit-relay/
- DCUtR / hole punching: https://docs.libp2p.io/concepts/nat/hole-punching/
- AutoNAT: https://docs.libp2p.io/concepts/nat/autonat/
- WebRTC transport (js-libp2p): https://github.com/libp2p/js-libp2p/tree/master/packages/transport-webrtc
- WebRTC direct transport (js-libp2p): https://github.com/libp2p/js-libp2p/tree/master/packages/transport-webrtc-direct
- WebSockets transport (js-libp2p): https://github.com/libp2p/js-libp2p/tree/master/packages/transport-websockets
- multiaddr format: https://github.com/multiformats/multiaddr

Instead of separate STUN/TURN and signalling servers, we use:

- A public libp2p relay node
- GossipSub to exchange multiaddrs
- Circuit Relay to fall back when direct WebRTC fails

This lets two peers behind NATs find and connect to each other.

---

## 1) Relay Node (Public)

The relay node is a publicly reachable libp2p node that:

- Accepts circuit relays
- Runs GossipSub
- Listens on WebSockets

### Example: Node.js Relay

```js
import { createLibp2p } from "libp2p";
import { webSockets } from "@libp2p/websockets";
import { circuitRelayServer } from "@libp2p/circuit-relay-v2";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";

async function startRelay() {
  const relay = await createLibp2p({
    addresses: {
      listen: ["/ip4/0.0.0.0/tcp/9090/ws"],
    },
    transports: [webSockets()],
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
    services: {
      relay: circuitRelayServer(), // enables relay
      pubsub: gossipsub(), // GossipSub
    },
  });

  await relay.start();
  console.log("Relay running at:");
  relay.getMultiaddrs().forEach((addr) => console.log(addr.toString()));
}

startRelay().catch(console.error);
```

This node will let peers hop through it if direct connections fail.

---

## 2) Browser/Peer Node

Each peer browser node must:

- Support WebRTC and WebSockets
- Enable libp2p relay client mode
- Connect to the relay multiaddr
- Participate in GossipSub

### Example: Browser libp2p

```js
import { createLibp2p } from "libp2p";
import { webRTCDirect } from "@libp2p/webrtc";
import { webSockets } from "@libp2p/websockets";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";

async function createBrowserNode(relayAddr) {
  const node = await createLibp2p({
    transports: [
      webRTCDirect(), // WebRTC transport
      webSockets(), // WebSocket transport
    ],
    pubsub: gossipsub(), // GossipSub for discovery
    relay: {
      enabled: true, // client mode
      hop: { enabled: false },
    },
    addresses: {
      listen: [
        relayAddr, // public relay multiaddr
      ],
    },
  });

  await node.start();
  console.log("Browser node started!");
  return node;
}
```

Replace `relayAddr` with the multiaddr string your relay outputs (for example, `/p2p-circuit/...`).

---

## 3) Peer Discovery via GossipSub

Instead of a signalling server, use a shared PubSub channel.

### Announce your multiaddr

```js
await node.pubsub.subscribe("p2p-discovery");

const announce = {
  peerId: node.peerId.toString(),
  addrs: node.getMultiaddrs().map((a) => a.toString()),
};

await node.pubsub.publish("p2p-discovery", JSON.stringify(announce));
```

### Listen for announcements

```js
node.pubsub.addEventListener("message", ({ detail }) => {
  const data = JSON.parse(detail.data.toString());
  console.log("Discovered peer:", data.peerId);
  console.log("Their addrs:", data.addrs);
  // Store these for dialing
});
```

This lets peers broadcast their relay + direct addresses to others.

---

## 4) Dialing a Peer

When a peer's multiaddr is known:

```js
await node.dial(remoteMultiaddr);
```

libp2p will try:

1. Direct WebRTC
2. Relay fallback (`/p2p-circuit`)
3. WebSocket fallback

If the relay is used, libp2p will automatically create a circuit between peers.

---

## 5) Optional Connection Upgrades (Hole Punching)

To improve efficiency:

- Enable hole punching if available
- Try Direct Connection Upgrade Through Relay (DCUtR)
- Use AutoNAT modules to detect NAT state

These are optional enhancements and not required to get basic relay signalling working.

---

## 6) Debugging Tips

Log these events to see how connections happen:

```js
node.addEventListener("peer:connect", (evt) => {
  console.log("Connected to peer:", evt.detail.remotePeer.toString());
});

node.addEventListener("peer:discovery", (evt) => {
  console.log("Discovered via mDNS/pubsub:", evt.detail.id.toString());
});
```

Inspect whether peers are:

- Using `/webrtc`
- Falling back to `/p2p-circuit`
- Hit NAT edges requiring relay

---

## 7) Notes and Best Practices

### Relay vs TURN

- Circuit Relay is not a full TURN server
- It is a libp2p hop that forwards encrypted streams
- You can deploy multiple relays for resilience

### Signalling

- GossipSub channels replace classical signalling APIs
- Peers announce themselves and pick each other up

### Scalability

- Add more public relays
- Rotate relay addresses if needed
- Tune pubsub options for churn

---

## Summary

With this system:

- No central STUN/TURN
- No dedicated signalling server
- NAT traversal is handled via libp2p circuits
- Peer discovery via GossipSub

Just drop this file into your repo and use it as ground truth for the agent.
