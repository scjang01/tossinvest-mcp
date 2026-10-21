import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  McpServer,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatToolError } from "../toss/errors.js";
const warnings = new WeakMap<McpServer, string[]>();
export function setServerWarnings(server: McpServer, values: string[]) {
  warnings.set(server, [...values]);
}
export async function runTool<T>(
  operation: () => Promise<T>,
): Promise<CallToolResult> {
  try {
    const output = await operation();
    const structured =
      output !== null && typeof output === "object" && !Array.isArray(output)
        ? (output as Record<string, unknown>)
        : { result: output };
    return {
      content: [{ type: "text", text: JSON.stringify(structured) }],
      structuredContent: structured,
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: formatToolError(error) }],
      isError: true,
    };
  }
}
export function registrar(server: McpServer) {
  return function <S extends z.ZodRawShape>(
    name: string,
    definition: { title: string; description: string; inputSchema: S },
    handler: (input: z.infer<z.ZodObject<S>>) => Promise<CallToolResult>,
  ) {
    const callback = async (input: unknown): Promise<CallToolResult> => {
      const pending = warnings.get(server)?.splice(0) ?? [];
      const result = await handler(input as z.infer<z.ZodObject<S>>);
      if (!pending.length) return result;
      const body = result.structuredContent ?? {
        error: result.content
          .filter((x) => x.type === "text")
          .map((x) => x.text)
          .join("\n"),
      };
      const structured = {
        ...body,
        _warnings: [
          ...pending,
          ...(Array.isArray(body._warnings) ? body._warnings : []),
        ],
      };
      return {
        ...result,
        structuredContent: structured,
        content: [{ type: "text", text: JSON.stringify(structured) }],
      };
    };
    server.registerTool<z.ZodRawShape, z.ZodObject<S>>(
      name,
      {
        ...definition,
        inputSchema: z.strictObject(definition.inputSchema),
        annotations: {
          readOnlyHint: !/(create|modify|cancel)_/.test(name),
          destructiveHint: /(create|modify|cancel)_/.test(name),
          openWorldHint: true,
        },
      },
      callback as ToolCallback<z.ZodObject<S>>,
    );
  };
}
