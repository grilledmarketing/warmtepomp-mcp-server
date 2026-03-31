import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import fetch from "node-fetch";

const WP_API_URL = "https://www.masterwatt.com/wp-json/wp/v2/epkb_post_type_1";
const app = express();

const server = new Server({
  name: "masterwatt-expert",
  version: "1.0.0",
}, {
  capabilities: {
    tools: {},
  },
});

// 1. Definieer de tool
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "zoek_warmtepomp_kennis",
        description: "Zoek in de officiële Masterwatt kennisbank naar technische informatie over warmtepompen.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Zoekterm" },
          },
          required: ["query"],
        },
      },
    ],
  };
});

// 2. Handel de zoekopdracht af
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "zoek_warmtepomp_kennis") {
    const query = request.params.arguments.query;
    const response = await fetch(`${WP_API_URL}?search=${encodeURIComponent(query)}`);
    const data = await response.json();

    if (!data || data.length === 0) {
      return { content: [{ type: "text", text: "Niets gevonden." }] };
    }

    const results = data.slice(0, 3).map(post => {
      const cleanContent = post.content.rendered.replace(/<[^>]*>?/gm, '').substring(0, 1000);
      return `TITEL: ${post.title.rendered}\nURL: ${post.link}\nINHOUD: ${cleanContent}...`;
    }).join("\n\n");

    return { content: [{ type: "text", text: results }] };
  }
});

// 3. De HTTP/SSE koppeling voor Railway
let transport;

app.get("/sse", async (req, res) => {
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Masterwatt MCP server draait op poort ${PORT}`);
});
