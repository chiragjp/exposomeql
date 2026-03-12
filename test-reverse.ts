import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
  });
  const client = new Client({ name: "test", version: "0.1.0" });
  await client.connect(transport);

  const result = await client.callTool({ name: "epwas_reverse_triangulate", arguments: { phenotype: "LBXGH" } });
  const text = (result.content as any)[0]?.text ?? "";
  console.log("isError:", result.isError);
  console.log("Response (first 2000 chars):");
  console.log(text.substring(0, 2000));

  await client.close();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
