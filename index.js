import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import fetch from "node-fetch";
import pdf from "pdf-parse/lib/pdf-parse.js";

const WP_API_URL = "https://www.masterwatt.com/wp-json/wp/v2/epkb_post_type_1";
const app = express();

// Legenda voor interne logging
const SOURCE_MAP = {
  "1": "ChatGPT_CustomGPT",
  "2": "Google_Gemini",
  "3": "Website_WebMCP",
  "4": "Internal_Testing"
};

const server = new Server({
  name: "mw-expert",
  version: "1.3.0",
}, {
  capabilities: { tools: {} },
});

// Logging functie
const logActivity = (ds_id, action, detail) => {
  const sourceName = SOURCE_MAP[ds_id] || `Unknown_Source_${ds_id}`;
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] SRC: ${sourceName} | ACT: ${action} | DET: ${detail}`);
};

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "mw_search",
        description: "Search the Masterwatt technical database.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
      {
        name: "mw_read_doc",
        description: "Read technical PDF content via URL.",
        inputSchema: {
          type: "object",
          properties: { url: { type: "string" } },
          required: ["url"],
        },
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const ds = app.get('current_ds') || '0';

  if (name === "mw_search") {
    logActivity(ds, "SEARCH", args.query);
    const response = await fetch(`${WP_API_URL}?search=${encodeURIComponent(args.query)}`);
    const data = await response.json();
    
    const results = data.slice(0, 3).map(post => {
      const cleanContent = post.content.rendered.replace(/<[^>]*>?/gm, '').substring(0, 800);
      return `TITLE: ${post.title.rendered}\nURL: ${post.link}\nCONTENT: ${cleanContent}...`;
    }).join("\n\n");

    return { content: [{ type: "text", text: results || "No results found." }] };
  }

  if (name === "mw_read_doc") {
    logActivity(ds, "PDF_READ", args.url);
    try {
      const res = await fetch(args.url);
      const buffer = await res.arrayBuffer();
      const pdfData = await pdf(Buffer.from(buffer));
      return { content: [{ type: "text", text: pdfData.text.substring(0, 5000) }] };
    } catch (e) {
      return { content: [{ type: "text", text: "Error reading PDF: " + e.message }] };
    }
  }
});

let transport;
app.get("/sse", async (req, res) => {
  const ds = req.query.ds || '0';
  app.set('current_ds', ds);
  
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  if (transport) await transport.handlePostMessage(req, res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Masterwatt MCP running on ${PORT}`));
