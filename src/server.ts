import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "./config.js";
import { DuckDBManager } from "./data/duckdb-manager.js";
import { VariableResolver } from "./variables/variable-resolver.js";
import { RExecutor } from "./r-bridge/r-executor.js";
import { registerTools } from "./tools/index.js";
import { registerResources } from "./resources/index.js";
import type { AppContext } from "./types.js";

export async function createServer(): Promise<McpServer> {
  const config = loadConfig();

  const server = new McpServer({
    name: "exposomeql",
    version: "0.2.0",
  });

  // Initialize subsystems
  const db = new DuckDBManager();
  await db.initialize(config);

  const resolver = new VariableResolver(db);
  await resolver.initialize();

  const rExec = new RExecutor(config);

  // Discover HHEAR cohorts
  const cohorts = await db.discoverCohorts(config.hhearDataDir);

  const ctx: AppContext = { db, resolver, rExec, cohorts };

  // Register tools and resources
  registerTools(server, ctx);
  registerResources(server, ctx);

  console.error("[exposomeql] Server initialized with data from:", config.dataDir);
  if (cohorts.length > 0) {
    console.error(`[exposomeql] HHEAR cohorts available: ${cohorts.map(c => c.id).join(", ")}`);
  }

  return server;
}
