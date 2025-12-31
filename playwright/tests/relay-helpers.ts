import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { rm, mkdtemp } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DefaultRelayStartupTimeoutMs = 10_000;
const DefaultRelayHealthCheckTimeoutMs = 5_000;

export type RelayProcess = ChildProcess;
export type BunWebSocketServer = {
  process: ChildProcess;
  url: string;
};

export type RelayStartOptions = {
  entryPath: string;
  repoRoot: string;
  relayHost: string;
  relayPort?: number | string;
  relayListen?: string;
  allowInsecureWebSockets?: boolean;
  relayRuntime?: "bun" | "node";
  debugNamespaces: string;
  startupTimeoutMs?: number;
  healthCheckTimeoutMs?: number;
  dialHost?: string;
};

export type RelayHandle = {
  process: RelayProcess;
  multiaddr: string;
  cleanup?: () => Promise<void>;
};

function attachRelayLogging(relayProcess: RelayProcess): void {
  const stdout = relayProcess.stdout;
  const stderr = relayProcess.stderr;

  const logLine = (line: string, isError: boolean) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    if (isError) {
      console.error("[relay]", trimmed);
    } else {
      console.log("[relay]", trimmed);
    }
  };

  if (stdout) {
    stdout.on("data", (chunk: Buffer) => {
      chunk
        .toString()
        .split(/\r?\n/)
        .forEach((line) => logLine(line, false));
    });
  }

  if (stderr) {
    stderr.on("data", (chunk: Buffer) => {
      chunk
        .toString()
        .split(/\r?\n/)
        .forEach((line) => logLine(line, true));
    });
  }

  relayProcess.on("error", (error) => {
    console.error("[relay] process error", error);
  });

  relayProcess.on("exit", (code, signal) => {
    console.error("[relay] process exit", { code, signal });
  });
}

function attachBunWebSocketLogging(process: ChildProcess): void {
  const stdout = process.stdout;
  const stderr = process.stderr;

  const logLine = (line: string, isError: boolean) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    if (isError) {
      console.error("[bun-ws]", trimmed);
    } else {
      console.log("[bun-ws]", trimmed);
    }
  };

  if (stdout) {
    stdout.on("data", (chunk: Buffer) => {
      chunk
        .toString()
        .split(/\r?\n/)
        .forEach((line) => logLine(line, false));
    });
  }

  if (stderr) {
    stderr.on("data", (chunk: Buffer) => {
      chunk
        .toString()
        .split(/\r?\n/)
        .forEach((line) => logLine(line, true));
    });
  }

  process.on("error", (error) => {
    console.error("[bun-ws] process error", error);
  });

  process.on("exit", (code, signal) => {
    console.error("[bun-ws] process exit", { code, signal });
  });
}

async function waitForRelayAddress(
  relayProcess: RelayProcess,
  timeoutMs: number,
): Promise<string> {
  const stdout = relayProcess.stdout;
  const stderr = relayProcess.stderr;
  if (!stdout || !stderr) {
    throw new Error("Relay process streams are not available");
  }

  let buffer = "";

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Relay did not advertise a WebSocket multiaddr"));
    }, timeoutMs);

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      if (trimmed.startsWith("/") && trimmed.includes("/ws")) {
        cleanup();
        resolve(trimmed);
      }
    };

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      lines.forEach(handleLine);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onExit = (code: number | null) => {
      if (code && code !== 0) {
        cleanup();
        reject(new Error(`Relay exited with code ${code}`));
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      stdout.off("data", onData);
      stderr.off("data", onData);
      relayProcess.off("error", onError);
      relayProcess.off("exit", onExit);
    };

    stdout.on("data", onData);
    stderr.on("data", onData);
    relayProcess.on("error", onError);
    relayProcess.on("exit", onExit);
  });
}

async function waitForWebSocketUrl(
  process: ChildProcess,
  timeoutMs: number,
): Promise<string> {
  const stdout = process.stdout;
  const stderr = process.stderr;
  if (!stdout || !stderr) {
    throw new Error("Process streams are not available");
  }

  let buffer = "";

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("WebSocket server did not advertise a URL"));
    }, timeoutMs);

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) {
        cleanup();
        resolve(trimmed);
      }
    };

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      lines.forEach(handleLine);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onExit = (code: number | null) => {
      if (code && code !== 0) {
        cleanup();
        reject(new Error(`Process exited with code ${code}`));
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      stdout.off("data", onData);
      stderr.off("data", onData);
      process.off("error", onError);
      process.off("exit", onExit);
    };

    stdout.on("data", onData);
    stderr.on("data", onData);
    process.on("error", onError);
    process.on("exit", onExit);
  });
}

async function buildRelayForNode(entryPath: string): Promise<{
  filePath: string;
  cleanup: () => Promise<void>;
}> {
  const tempDir = await mkdtemp(join(tmpdir(), "trivia-relay-"));
  const outfile = join(tempDir, "relay.mjs");

  await new Promise<void>((resolve, reject) => {
    const build = spawn(
      "bun",
      [
        "build",
        entryPath,
        "--target",
        "node",
        "--format",
        "esm",
        "--outfile",
        outfile,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";

    build.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    build.on("error", (error) => {
      reject(error);
    });

    build.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`bun build failed: ${stderr}`));
      }
    });
  });

  return {
    filePath: outfile,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

function parseRelayAddress(relayMultiaddr: string): {
  host: string;
  port: number;
} {
  const hostMatch = relayMultiaddr.match(/\/(ip4|ip6|dns4|dns6)\/([^/]+)/);
  const portMatch = relayMultiaddr.match(/\/tcp\/(\d+)/);
  if (!hostMatch || !portMatch) {
    throw new Error(`Unable to parse relay host/port from ${relayMultiaddr}`);
  }
  const port = Number(portMatch[1]);
  if (!Number.isFinite(port)) {
    throw new Error(`Unable to parse relay port from ${relayMultiaddr}`);
  }
  return { host: hostMatch[2], port };
}

function rewriteMultiaddrHost(
  relayMultiaddr: string,
  dialHost: string,
): string {
  return relayMultiaddr.replace(
    /\/(ip4|ip6|dns4|dns6)\/[^/]+/,
    `/$1/${dialHost}`,
  );
}

async function waitForRelayTcp(
  relayMultiaddr: string,
  timeoutMs: number,
): Promise<void> {
  const { host, port } = parseRelayAddress(relayMultiaddr);
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = connect({ host, port });
        const onError = (error: Error) => {
          socket.destroy();
          reject(error);
        };
        socket.once("error", onError);
        socket.once("connect", () => {
          socket.end();
          resolve();
        });
      });
      console.log("[relay] health check passed", { host, port });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  const suffix = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(
    `Relay did not accept TCP connections on ${host}:${port}${suffix}`,
  );
}

async function waitForRelayWebSocket(
  relayMultiaddr: string,
  timeoutMs: number,
): Promise<void> {
  const { host, port } = parseRelayAddress(relayMultiaddr);
  const wsUrl = `ws://${host}:${port}`;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  const WebSocketImpl = globalThis.WebSocket;
  if (!WebSocketImpl) {
    console.warn("[relay] WebSocket not available, falling back to TCP check");
    await waitForRelayTcp(relayMultiaddr, timeoutMs);
    return;
  }

  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocketImpl(wsUrl);
        let opened = false;
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error("WebSocket health check timed out"));
        }, 1_000);

        const cleanup = () => {
          clearTimeout(timeout);
          socket.removeEventListener("error", onError as EventListener);
          socket.removeEventListener("open", onOpen as EventListener);
          socket.removeEventListener("close", onClose as EventListener);
        };

        const onError = (event: Event) => {
          cleanup();
          socket.close();
          reject(event);
        };
        const onOpen = () => {
          opened = true;
          cleanup();
          socket.close();
          resolve();
        };
        const onClose = () => {
          if (!opened) {
            cleanup();
            reject(new Error("WebSocket closed before opening"));
          }
        };
        socket.addEventListener("error", onError, { once: true });
        socket.addEventListener("open", onOpen, { once: true });
        socket.addEventListener("close", onClose, { once: true });
      });
      console.log("[relay] websocket check passed", { wsUrl });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  const suffix = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(
    `Relay did not accept WebSocket connections on ${wsUrl}${suffix}`,
  );
}

export async function startRelay(
  options: RelayStartOptions,
): Promise<RelayHandle> {
  const {
    entryPath,
    repoRoot,
    relayHost,
    relayPort,
    relayListen,
    allowInsecureWebSockets,
    relayRuntime = "bun",
    debugNamespaces,
    startupTimeoutMs = DefaultRelayStartupTimeoutMs,
    healthCheckTimeoutMs = DefaultRelayHealthCheckTimeoutMs,
    dialHost,
  } = options;

  let relayProcess: RelayProcess;
  let cleanup: (() => Promise<void>) | undefined;

  if (relayRuntime === "node") {
    const build = await buildRelayForNode(entryPath);
    cleanup = build.cleanup;
    relayProcess = spawn("node", [build.filePath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        RELAY_HOST: relayHost,
        ...(relayPort !== undefined ? { RELAY_PORT: String(relayPort) } : {}),
        ...(relayListen ? { RELAY_LISTEN: relayListen } : {}),
        ...(allowInsecureWebSockets !== undefined
          ? { RELAY_ALLOW_INSECURE_WS: String(allowInsecureWebSockets) }
          : {}),
        DEBUG: debugNamespaces,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }) as RelayProcess;
  } else {
    relayProcess = spawn("bun", [entryPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        RELAY_HOST: relayHost,
        ...(relayPort !== undefined ? { RELAY_PORT: String(relayPort) } : {}),
        ...(relayListen ? { RELAY_LISTEN: relayListen } : {}),
        ...(allowInsecureWebSockets !== undefined
          ? { RELAY_ALLOW_INSECURE_WS: String(allowInsecureWebSockets) }
          : {}),
        DEBUG: debugNamespaces,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }) as RelayProcess;
  }

  try {
    attachRelayLogging(relayProcess);
    const reportedMultiaddr = await waitForRelayAddress(
      relayProcess,
      startupTimeoutMs,
    );
    const dialMultiaddr = dialHost
      ? rewriteMultiaddrHost(reportedMultiaddr, dialHost)
      : reportedMultiaddr;

    console.log("[relay] multiaddr", reportedMultiaddr);
    if (dialMultiaddr !== reportedMultiaddr) {
      console.log("[relay] dial multiaddr", dialMultiaddr);
    }

    try {
      await waitForRelayWebSocket(dialMultiaddr, healthCheckTimeoutMs);
    } catch (error) {
      console.warn("[relay] websocket check failed, falling back", error);
      await waitForRelayTcp(dialMultiaddr, healthCheckTimeoutMs);
    }

    return { process: relayProcess, multiaddr: dialMultiaddr, cleanup };
  } catch (error) {
    await stopRelay(relayProcess);
    if (cleanup) {
      await cleanup();
    }
    throw error;
  }
}

export async function startRelayWithPortRetry(
  options: RelayStartOptions,
  startPort: number,
  attempts = 10,
): Promise<RelayHandle> {
  let lastError: unknown = null;

  for (let offset = 0; offset < attempts; offset += 1) {
    const port = startPort + offset;
    try {
      return await startRelay({ ...options, relayPort: port });
    } catch (error) {
      lastError = error;
      console.warn("[relay] port failed", { port, error });
    }
  }

  throw (
    lastError ??
    new Error(
      `Relay failed to start after ${attempts} attempts from ${startPort}`,
    )
  );
}

export async function startBunWebSocketEchoServer(
  timeoutMs = DefaultRelayStartupTimeoutMs,
): Promise<BunWebSocketServer> {
  const script = `
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response("ok");
  },
  websocket: {
    open(ws) {
      ws.send("ready");
    },
    message(ws, message) {
      ws.send(message);
    }
  }
});
console.log("ws://127.0.0.1:" + server.port);
const keepAlive = setInterval(() => {}, 1000);
const shutdown = () => {
  clearInterval(keepAlive);
  server.stop(true);
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
`;

  const process = spawn("bun", ["-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
  }) as ChildProcess;

  attachBunWebSocketLogging(process);
  const url = await waitForWebSocketUrl(process, timeoutMs);
  return { process, url };
}

export async function stopBunWebSocketServer(
  server: BunWebSocketServer | null,
): Promise<void> {
  if (!server) {
    return;
  }
  server.process.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    server.process.once("exit", () => resolve());
  });
}

export async function stopRelay(
  relayProcess: RelayProcess | null,
): Promise<void> {
  if (!relayProcess) {
    return;
  }
  relayProcess.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    relayProcess?.once("exit", () => resolve());
  });
}
