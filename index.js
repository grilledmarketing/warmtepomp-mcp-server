import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const WP_API_URL = "https://www.masterwatt.com/wp-json/wp/v2/epkb_post_type_1";
const app = express();

app.use(cors());
app.use(express.json());

// Bron-mapping voor UTM_SOURCE (altijd kleine letters)
const SOURCE_MAP = {
  "1": "chatgpt",
  "2": "gemini",
  "3": "claude",
  "4": "webmcp",
  "5": "internal-test"
};

const server = new Server({
  name: "mw-expert",
  version: "1.4.0",
}, {
  capabilities: { tools: {} },
});

// Helper functie om UTM links te genereren
const getTrackedUrl = (originalUrl, ds_id) => {
  const source = SOURCE_MAP[ds_id] || "onbekend";
  const medium = "llm";
  const campaign = "masterwatt-ai";
  
  // Controleer of er al een query parameter in de URL zit
  const separator = originalUrl.includes('?') ? '&' : '?';
  return `${originalUrl}${separator}utm_source=${source}&utm_medium=${medium}&utm_campaign=${campaign}`;
};

// Logging functie voor Railway
const logActivity = (ds_id, action, detail) => {
  const sourceLabel = SOURCE_MAP[ds_id]?.toUpperCase() || `UNKNOWN_${ds_id}`;
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] SRC: ${sourceLabel} | ACT: ${action} | DET: ${detail}`);
};

// --- API Route voor ChatGPT Actions ---
app.get("/api/search", async (req, res) => {
  const query = req.query.query;
  const ds = req.query.ds || '1'; 
  
  logActivity(ds, "API_SEARCH", query);

  if (!query) return res.status(400).json({ error: "Geen zoekterm." });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(`${WP_API_URL}?search=${encodeURIComponent(query)}`, {
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    const data = await response.json();
    
    if (!data || data.length === 0) {
      return res.json({ results: "Geen resultaten gevonden in de Masterwatt kennisbank." });
    }

    const results = data.slice(0, 3).map(post => {
      const trackedUrl = getTrackedUrl(post.link, ds);
      const cleanContent = post.content.rendered.replace(/<[^>]*>?/gm, '').substring(0, 1000);
      return `TITEL: ${post.title.rendered}\nURL: ${trackedUrl}\nINHOUD: ${cleanContent}...`;
    }).join("\n\n");

    res.json({ results: results });
  } catch (error) {
    res.status(500).json({ error: "Kennisbank onbereikbaar." });
  }
});

// --- MCP Protocol Handlers (voor Claude & WebMCP) ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "mw_search",
        description: "Zoek in de Masterwatt technische kennisbank.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const ds = app.get('current_ds') || '0';

  if (name === "mw_search") {
    logActivity(ds, "MCP_SEARCH", args.query);
    const response = await fetch(`${WP_API_URL}?search=${encodeURIComponent(args.query)}`);
    const data = await response.json();
    
    if (!data || data.length === 0) {
      return { content: [{ type: "text", text: "Geen resultaten gevonden." }] };
    }

    const results = data.slice(0, 3).map(post => {
      const trackedUrl = getTrackedUrl(post.link, ds);
      const cleanContent = post.content.rendered.replace(/<[^>]*>?/gm, '').substring(0, 1000);
      return `TITEL: ${post.title.rendered}\nURL: ${trackedUrl}\nINHOUD: ${cleanContent}...`;
    }).join("\n\n");

    return { content: [{ type: "text", text: results }] };
  }
});

app.get("/sse", async (req, res) => {
  const ds = req.query.ds || '0';
  app.set('current_ds', ds); 
  const transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res); // Simplificatie voor demo
  if (transport) await transport.handlePostMessage(req, res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Masterwatt AI Server live op poort ${PORT}`));
