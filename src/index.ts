import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[exposomeql] MCP server running on stdio");
}

main().catch((err) => {
  console.error("[exposomeql] Fatal error:", err);
  process.exit(1);
});
