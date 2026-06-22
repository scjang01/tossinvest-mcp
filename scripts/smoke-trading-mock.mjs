#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
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

    if (req.method === "POST" && url.pathname === "/api/v1/orders") {
      requireAuth(req);
      requireAccount(req);
      if (jsonBody?.clientOrderId === "mock-yolo-001") {
        assert.deepEqual(jsonBody, {
          clientOrderId: "mock-yolo-001",
          symbol: "005930",
          side: "BUY",
          orderType: "LIMIT",
          quantity: "1",
          price: "3"
        });

        return sendJson(res, 200, {
          result: {
            orderId: "mock-order-yolo",
            clientOrderId: "mock-yolo-001"
          }
        });
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
      assert.equal(jsonBody, undefined);

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
      TOSSINVEST_ENABLE_TRADING: "true"
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
        "POST /api/v1/orders/mock-order-created/modify",
        "POST /api/v1/orders/mock-order-replaced/cancel"
      ]
    );

    await client.close();

    const yoloClient = new Client({ name: "trading-yolo-mock-smoke", version: "0.0.0" });
    const yoloTransport = new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
      env: {
        ...process.env,
        TOSSINVEST_API_KEY: "mock-api-key",
        TOSSINVEST_SECRET_KEY: "mock-secret-key",
        TOSSINVEST_ACCOUNT: "1",
        TOSSINVEST_BASE_URL: baseUrl,
        TOSSINVEST_ENABLE_TRADING: "true",
        TOSSINVEST_YOLO_TRADING: "true"
      }
    });

    await yoloClient.connect(yoloTransport);
    const yoloCreateResult = textResult(
      await yoloClient.callTool({
        name: "toss_create_order",
        arguments: {
          clientOrderId: "mock-yolo-001",
          symbol: "005930",
          side: "BUY",
          orderType: "LIMIT",
          quantity: "1",
          price: "3"
        }
      })
    );
    orderIdFrom(yoloCreateResult, "mock-order-yolo");
    await yoloClient.close();

    console.log("Mock trading smoke test completed.");
    console.log(`- mock baseUrl: ${baseUrl}`);
    console.log("- confirmed missing confirmOrderAction is blocked before any order request");
    console.log("- confirmed TOSSINVEST_YOLO_TRADING=true allows create without confirmOrderAction on mock server");
    console.log("- confirmed create, modify, and cancel calls hit only the local mock server");
    console.log(`- total mock requests: ${received.length}`);
  } finally {
    await client.close().catch(() => undefined);
    await closeServer(mockServer);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Mock trading smoke test failed: ${message}`);
  process.exit(1);
});
