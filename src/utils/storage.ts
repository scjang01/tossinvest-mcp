import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import lockfile from "proper-lockfile";
import type { Config } from "../config.js";
export function runtimeDir(config: Config): string {
  return (
    config.runtimeDir ??
    join(
      process.platform === "win32"
        ? (process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"))
        : process.platform === "darwin"
          ? join(homedir(), "Library", "Application Support")
          : (process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")),
      "tossinvest-mcp",
    )
  );
}
export function credentialId(config: Config): string {
  return createHash("sha256")
    .update(`${config.baseUrl}\n${config.clientId}`)
    .digest("hex")
    .slice(0, 32);
}
export function atomicWrite(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(value), {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temp, path);
  } catch (error) {
    // Failed writes must not leave token/journal fragments behind or mask the
    // original failure, which the order recovery path needs to classify.
    try {
      unlinkSync(temp);
    } catch {}
    throw error;
  }
}
export async function withFileLock<T>(
  path: string,
  fn: () => Promise<T>,
): Promise<T> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(path, {
    realpath: false,
    stale: 120000,
    update: 10000,
    retries: {
      retries: 150,
      factor: 1,
      minTimeout: 100,
      maxTimeout: 1000,
      randomize: true,
    },
  });
  try {
    return await fn();
  } finally {
    // Cleanup failure must not turn an accepted broker operation into a retryable failure.
    try {
      await release();
    } catch (error) {
      console.error(
        `[storage] lock release failed; do not retry accepted operations: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
