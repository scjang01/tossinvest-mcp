#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const received = [];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function requireAuth(req) {
  assert.equal(req.headers.authorization, "Bearer mock-access-token");
}

function requireAccount(req) {
  assert.equal(req.headers["x-tossinvest-account"], "1");
}

async function handleRequest(req, res) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const rawBody = await readBody(req);
  const contentType = req.headers["content-type"] ?? "";
  const jsonBody = rawBody && contentType.includes("application/json") ? JSON.parse(rawBody) : undefined;

  received.push({
    method: req.method,
    path: url.pathname,
    headers: req.headers,
    body: jsonBody
  });

  try {
    if (req.method === "POST" && url.pathname === "/oauth2/token") {
      assert.match(rawBody, /grant_type=client_credentials/);
      return sendJson(res, 200, {
        access_token: "mock-access-token",
        token_type: "Bearer",
        expires_in: 3600
      });
    }

    if (req.method === "GET" && url.pathname === "/api/v1/prices") {
      requireAuth(req);
      return sendJson(res, 200, {
        result: [{ symbol: url.searchParams.get("symbols"), lastPrice: "1", currency: "KRW" }]
      });
    }

    if (req.method === "GET" && url.pathname === "/api/v1/orderbook") {
      requireAuth(req);
      return sendJson(res, 200, {
        result: {
          timestamp: "2026-06-26T09:30:00.000+09:00",
          currency: "KRW",
          asks: [{ price: "100", volume: "10" }, { price: "101", volume: "10" }],
          bids: [{ price: "99", volume: "10" }, { price: "98", volume: "10" }]
        }
      });
    }

    if (
      req.method === "GET" &&
      url.pathname.startsWith("/api/v1/orders/") &&
      !url.pathname.endsWith("/modify") &&
      !url.pathname.endsWith("/cancel")
    ) {
      requireAuth(req);
      requireAccount(req);
      // KR order detail used by the modify guard to enforce KR/US quantity rules.
      return sendJson(res, 200, {
        result: {
          orderId: url.pathname.split("/").pop(),
          symbol: "005930",
          currency: "KRW",
          orderType: "LIMIT",
          quantity: "1",
          price: "1"
        }
      });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/orders") {
      requireAuth(req);
      requireAccount(req);

      if (jsonBody?.clientOrderId === "mock-sell-001") {
        assert.deepEqual(jsonBody, {
          clientOrderId: "mock-sell-001",
          symbol: "005930",
          side: "SELL",
          orderType: "LIMIT",
          quantity: "1",
          price: "999999"
        });
        return sendJson(res, 200, { result: { orderId: "mock-order-sell", clientOrderId: "mock-sell-001" } });
      }

      if (jsonBody?.clientOrderId === "mock-market-001") {
        assert.deepEqual(jsonBody, {
          clientOrderId: "mock-market-001",
          symbol: "005930",
          side: "BUY",
          orderType: "MARKET",
          quantity: "1"
        });
        return sendJson(res, 200, { result: { orderId: "mock-order-market", clientOrderId: "mock-market-001" } });
      }

      assert.deepEqual(jsonBody, {
        clientOrderId: "mock-create-001",
        symbol: "005930",
        side: "BUY",
        orderType: "LIMIT",
        quantity: "1",
        price: "1"
      });

      return sendJson(res, 200, {
        result: {
          orderId: "mock-order-created",
          clientOrderId: "mock-create-001"
        }
      });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/orders/mock-order-created/modify") {
      requireAuth(req);
      requireAccount(req);
      assert.deepEqual(jsonBody, {
        orderType: "LIMIT",
        quantity: "1",
        price: "2"
      });

      return sendJson(res, 200, {
        result: {
          orderId: "mock-order-replaced"
        }
      });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/orders/mock-order-replaced/cancel") {
      requireAuth(req);
      requireAccount(req);
      // Cancel sends an empty JSON body so Toss receives Content-Type: application/json.
      assert.deepEqual(jsonBody, {});

      return sendJson(res, 200, {
        result: {
          orderId: "mock-order-canceled"
        }
      });
    }

    return sendJson(res, 404, {
      error: {
        requestId: "mock-request",
        code: "not-found",
        message: `No mock route for ${req.method} ${url.pathname}`
      }
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: {
        requestId: "mock-request",
        code: "mock-assertion-failed",
        message: error instanceof Error ? error.message : String(error)
      }
    });
  }
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.equal(typeof address, "object");
      resolve(address.port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function textResult(result) {
  assert.notEqual(result.isError, true, result.content?.[0]?.text ?? "Tool returned an error result.");
  const content = result.content?.[0];
  assert.equal(content?.type, "text");
  return JSON.parse(content.text);
}

function orderIdFrom(result, expected) {
  const orderId = result?.result?.orderId ?? result?.result?.result?.orderId;
  assert.equal(orderId, expected, `Unexpected tool result: ${JSON.stringify(result)}`);
  return orderId;
}

async function main() {
  const mockServer = createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      sendJson(res, 500, {
        error: {
          requestId: "mock-request",
          code: "mock-server-error",
          message: error instanceof Error ? error.message : String(error)
        }
      });
    });
  });

  const port = await listen(mockServer);
  const baseUrl = `http://127.0.0.1:${port}`;

  const stateDir = mkdtempSync(join(tmpdir(), "tossinvest-smoke-"));
  const statePath = join(stateDir, "guard-state.json");

  const client = new Client({ name: "trading-mock-smoke", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: {
      ...process.env,
      TOSSINVEST_API_KEY: "mock-api-key",
      TOSSINVEST_SECRET_KEY: "mock-secret-key",
      TOSSINVEST_ACCOUNT: "1",
      TOSSINVEST_BASE_URL: baseUrl,
      TOSSINVEST_ENABLE_TRADING: "true",
      TOSSINVEST_GUARD_STATE_PATH: statePath
    }
  });

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    assert.ok(toolNames.includes("toss_create_order"));
    assert.ok(toolNames.includes("toss_modify_order"));
    assert.ok(toolNames.includes("toss_cancel_order"));

    const blockedCreate = await client.callTool({
      name: "toss_create_order",
      arguments: {
        symbol: "005930",
        side: "BUY",
        orderType: "LIMIT",
        quantity: "1",
        price: "1"
      }
    });
    assert.equal(blockedCreate.isError, true);

    const blockedSell = await client.callTool({
      name: "toss_create_order",
      arguments: {
        confirmOrderAction: true,
        symbol: "005930",
        side: "SELL",
        orderType: "LIMIT",
        quantity: "1",
        price: "1"
      }
    });
    assert.equal(blockedSell.isError, true);

    const ordersBeforeCreate = received.filter((request) => request.path === "/api/v1/orders" && request.method === "POST");
    assert.equal(ordersBeforeCreate.length, 0, "Blocked orders must not hit the order API.");

    const createResult = textResult(
      await client.callTool({
        name: "toss_create_order",
        arguments: {
          confirmOrderAction: true,
          clientOrderId: "mock-create-001",
          symbol: "005930",
          side: "BUY",
          orderType: "LIMIT",
          quantity: "1",
          price: "1"
        }
      })
    );
    const createdOrderId = orderIdFrom(createResult, "mock-order-created");

    const modifyResult = textResult(
      await client.callTool({
        name: "toss_modify_order",
        arguments: {
          confirmOrderAction: true,
          orderId: createdOrderId,
          quantity: "1",
          price: "2"
        }
      })
    );
    const replacedOrderId = orderIdFrom(modifyResult, "mock-order-replaced");

    const cancelResult = textResult(
      await client.callTool({
        name: "toss_cancel_order",
        arguments: {
          confirmOrderAction: true,
          orderId: replacedOrderId
        }
      })
    );
    orderIdFrom(cancelResult, "mock-order-canceled");

    const orderRequests = received.filter((request) => request.path.startsWith("/api/v1/orders"));
    assert.deepEqual(
      orderRequests.map((request) => `${request.method} ${request.path}`),
      [
        "POST /api/v1/orders",
        "GET /api/v1/orders/mock-order-created",
        "POST /api/v1/orders/mock-order-created/modify",
        "POST /api/v1/orders/mock-order-replaced/cancel"
      ]
    );

    await client.close();

    const stateRecords = JSON.parse(readFileSync(statePath, "utf8"));
    assert.ok(Array.isArray(stateRecords), "Guard state file must contain an array.");
    assert.equal(stateRecords.length, 1, "Only the successful create should be recorded in guard state.");
    assert.equal(stateRecords[0].orderId, "mock-order-created");
    assert.equal(stateRecords[0].clientOrderId, "mock-create-001");
    assert.equal(stateRecords[0].currency, "KRW");
    assert.equal(stateRecords[0].estimatedAmount, 1);

    // Second server with sell + market enabled: verify those paths reach the order API.
    const stateDir2 = mkdtempSync(join(tmpdir(), "tossinvest-smoke2-"));
    const statePath2 = join(stateDir2, "guard-state.json");
    const client2 = new Client({ name: "trading-mock-smoke-sellmkt", version: "0.0.0" });
    const transport2 = new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
      env: {
        ...process.env,
        TOSSINVEST_API_KEY: "mock-api-key",
        TOSSINVEST_SECRET_KEY: "mock-secret-key",
        TOSSINVEST_ACCOUNT: "1",
        TOSSINVEST_BASE_URL: baseUrl,
        TOSSINVEST_ENABLE_TRADING: "true",
        TOSSINVEST_ALLOW_SELL_ORDERS: "true",
        TOSSINVEST_ALLOW_MARKET_ORDERS: "true",
        TOSSINVEST_GUARD_STATE_PATH: statePath2
      }
    });

    try {
      await client2.connect(transport2);

      const sellResult = textResult(
        await client2.callTool({
          name: "toss_create_order",
          arguments: {
            confirmOrderAction: true,
            clientOrderId: "mock-sell-001",
            symbol: "005930",
            side: "SELL",
            orderType: "LIMIT",
            quantity: "1",
            price: "999999"
          }
        })
      );
      orderIdFrom(sellResult, "mock-order-sell");

      const marketResult = textResult(
        await client2.callTool({
          name: "toss_create_order",
          arguments: {
            confirmOrderAction: true,
            clientOrderId: "mock-market-001",
            symbol: "005930",
            side: "BUY",
            orderType: "MARKET",
            quantity: "1"
          }
        })
      );
      orderIdFrom(marketResult, "mock-order-market");
    } finally {
      await client2.close().catch(() => undefined);
      rmSync(stateDir2, { recursive: true, force: true });
    }

    console.log("Mock trading smoke test completed.");
    console.log(`- mock baseUrl: ${baseUrl}`);
    console.log("- confirmed missing confirmOrderAction is blocked before any order request");
    console.log("- confirmed a default-disabled sell order is blocked before any order request");
    console.log("- confirmed create, modify, and cancel calls hit only the local mock server");
    console.log("- confirmed modify sends orderType and the cancel lifecycle works");
    console.log("- confirmed sell + market orders reach the API when enabled");
    console.log("- confirmed a successful create is recorded in the guard state file");
    console.log(`- total mock requests: ${received.length}`);
  } finally {
    await client.close().catch(() => undefined);
    await closeServer(mockServer);
    rmSync(stateDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Mock trading smoke test failed: ${message}`);
  process.exit(1);
});
