import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Config } from "./config.js";
import { TossClient } from "./toss/client.js";
import { registerAccountTools } from "./tools/account.js";
import { registerMarketTools } from "./tools/market.js";
import { registerExtendedMarketTools } from "./tools/extended-market.js";
import { setServerWarnings } from "./tools/common.js";
import { registerOrderTools } from "./tools/orders.js";

export function createServer(config: Config): McpServer {
  const server = new McpServer({
    name: "tossinvest-mcp",
    version: "0.3.1",
  });
  const client = new TossClient(config);
  setServerWarnings(server, config.warnings ?? []);

  registerMarketTools(server, client);
  registerExtendedMarketTools(server, client);
  registerAccountTools(server, client, config);
  registerOrderTools(server, client, config);

  return server;
}
