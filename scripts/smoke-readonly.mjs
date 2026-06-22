#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(path) {
  const file = resolve(path);
  const content = readFileSync(file, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim();

    if (key && value && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function mask(value) {
  if (!value) {
    return "(empty)";
  }

  if (value.length <= 8) {
    return "****";
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function main() {
  loadEnvFile(".env.local");

  if (process.env.TOSSINVEST_ENABLE_TRADING === "true") {
    throw new Error("Refusing to run smoke-readonly while TOSSINVEST_ENABLE_TRADING=true.");
  }

  const { loadConfig } = await import("../dist/config.js");
  const { TossClient } = await import("../dist/toss/client.js");

  const config = loadConfig(process.env);
  const client = new TossClient(config);

  console.log("Read-only Toss API smoke test");
  console.log(`- clientId: ${mask(config.clientId)}`);
  console.log(`- baseUrl: ${config.baseUrl}`);
  console.log(`- default accountSeq: ${config.defaultAccountSeq}`);
  console.log("");

  console.log("1. Checking OAuth token and accounts...");
  const accounts = await client.request({ path: "/api/v1/accounts" });
  console.log(JSON.stringify(accounts, null, 2));
  console.log("");

  console.log("2. Checking public price API with 005930...");
  const prices = await client.request({ path: "/api/v1/prices", query: { symbols: "005930" } });
  console.log(JSON.stringify(prices, null, 2));
  console.log("");

  console.log("3. Checking holdings with configured accountSeq...");
  const holdings = await client.request({
    path: "/api/v1/holdings",
    accountSeq: config.defaultAccountSeq
  });
  console.log(JSON.stringify(holdings, null, 2));

  console.log("");
  console.log("Smoke test completed without sending any order request.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Smoke test failed: ${message}`);
  process.exit(1);
});
