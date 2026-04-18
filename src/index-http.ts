import { createServer as createHttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";

const PORT = Number(process.env.EXPOSOMEQL_PORT ?? 3001);
const MCP_PATH = "/mcp";

async function main() {
  const mcpServer = await createServer();

  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
      return;
    }

    if (url.pathname !== MCP_PATH) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
      return;
    }

    if (req.method === "POST" && !sessionId) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) transports.delete(sid);
      };

      await mcpServer.connect(transport);

      const sid = transport.sessionId;
      if (sid) transports.set(sid, transport);

      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(400);
    res.end("Bad request: missing mcp-session-id header");
  });

  httpServer.listen(PORT, () => {
    console.error(`[exposomeql] MCP server running on http://localhost:${PORT}${MCP_PATH}`);
  });

  process.on("SIGTERM", () => {
    console.error("[exposomeql] SIGTERM received, shutting down");
    httpServer.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[exposomeql] Fatal error:", err);
  process.exit(1);
});
