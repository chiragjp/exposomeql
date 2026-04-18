// Spawns the ExposomeQL MCP server as a subprocess and exposes a thin client
// for tool listing + invocation. Used by run.ts; not for production.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

export interface ToolDescriptor {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export class ExposomeqlClient {
  private client: Client;
  private transport: StdioClientTransport;

  constructor() {
    this.transport = new StdioClientTransport({
      command: process.execPath, // node
      args: [path.join(REPO_ROOT, "dist", "index.js")],
      env: {
        ...(Object.fromEntries(
          Object.entries(process.env).filter(([, v]) => v !== undefined)
        ) as Record<string, string>),
      },
      stderr: "pipe", // suppress noisy server logs from polluting eval stdout
    });
    this.client = new Client({ name: "exposomeql-eval", version: "0.0.1" }, { capabilities: {} });
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }

  async listTools(): Promise<ToolDescriptor[]> {
    const res = await this.client.listTools();
    return res.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      input_schema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    }));
  }

  async callTool(name: string, args: unknown): Promise<{ text: string; isError: boolean }> {
    const res = await this.client.callTool({ name, arguments: args as Record<string, unknown> });
    const content = (res.content as Array<{ type: string; text?: string }>) ?? [];
    const text = content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
    return { text, isError: Boolean(res.isError) };
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
