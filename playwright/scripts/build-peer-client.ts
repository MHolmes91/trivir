import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const playwrightRoot = resolve(scriptDir, "..");
const generatedDir = resolve(playwrightRoot, ".generated");
const entryFile = resolve(playwrightRoot, "fixtures", "peer-client.ts");
const outputFile = resolve(generatedDir, "peer-client.js");

async function buildPeerClient(): Promise<void> {
  await rm(generatedDir, { recursive: true, force: true });
  await mkdir(generatedDir, { recursive: true });

  await new Promise<void>((resolveBuild, rejectBuild) => {
    const build = spawn(
      "bun",
      [
        "build",
        entryFile,
        "--outfile",
        outputFile,
        "--format",
        "iife",
        "--target",
        "browser",
      ],
      { stdio: "inherit" },
    );

    build.on("error", (error) => {
      rejectBuild(error);
    });

    build.on("exit", (code) => {
      if (code === 0) {
        resolveBuild();
      } else {
        rejectBuild(new Error(`bun build failed with exit code ${code}`));
      }
    });
  });
}

buildPeerClient().catch((error) => {
  console.error("Failed to build peer client", error);
  process.exit(1);
});
