import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { formatToolError } from "../toss/errors.js";

export async function runTool<T>(operation: () => Promise<T>): Promise<CallToolResult> {
  try {
    const output = await operation();

    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      structuredContent: { result: output }
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: formatToolError(error) }],
      isError: true
    };
  }
}
