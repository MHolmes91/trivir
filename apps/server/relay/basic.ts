import { startBasicRelay } from "./basic/index";

async function main(): Promise<void> {
  const relay = await startBasicRelay();

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, stopping relay...`);
    await relay.stop();
    process.exit(0);
  };

  ["SIGINT", "SIGTERM"].forEach((signal) => {
    process.on(signal, () => {
      void shutdown(signal);
    });
  });
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Relay failed to start", error);
    process.exit(1);
  });
}
