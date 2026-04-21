import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import fetch from "node-fetch";
import cors from "cors"; // STAP 1: Importeer CORS

const WP_API_URL = "https://www.masterwatt.com/wp-json/wp/v2/epkb_post_type_1";
const app = express();

app.use(cors()); // STAP 2: Activeer CORS voor alle inkomende verzoeken
app.use(express.json());

// Interne legenda voor jouw ogen in de logs
const SOURCE_MAP = {
  "1": "ChatGPT_CustomGPT",
  "2": "Google_Gemini",
  "3": "Claude_Projects",
  "4": "Website_WebMCP",
  "5": "Internal_Testing"
};

const server = new Server({
  name: "mw-expert",
  version: "1.3.1",
}, {
  capabilities: { tools: {} },
});

// Logging functie voor Railway
const logActivity = (ds_id, action, detail) => {
  const sourceName = SOURCE_MAP[ds_id] || `Unknown_Source_${ds_id}`;
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] SRC: ${sourceName} | ACT: ${action} | DET: ${detail}`);
};

// --- Speciale route voor ChatGPT Actions (JSON i.p.v. SSE) ---
app.get("/api/search", async (req, res) => {
  const query = req.query.query;
  const ds = req.query.ds || '1'; 
  
  logActivity(ds, "API_SEARCH", query);

  if (!query) {
    return res.status(400).json({ error: "Geen zoekterm opgegeven." });
  }

  try {
    // Voeg een timeout toe aan de fetch om 'hangen' te voorkomen
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8 seconden timeout

    const response = await fetch(`${WP_API_URL}?search=${encodeURIComponent(query)}`, {
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    const data = await response.json();
    
    if (!data || data.length === 0) {
      return res.json({ results: "Geen resultaten gevonden in de Masterwatt kennisbank." });
    }

    const results = data.slice(0, 3).map(post => {
      const cleanContent = post.content.rendered.replace(/<[^>]*>?/gm, '').substring(0, 1200);
      return `TITEL: ${post.title.rendered}\nURL: ${post.link}\nINHOUD: ${cleanContent}...`;
    }).join("\n\n");

    res.json({ results: results });
  } catch (error) {
    console.error("API Error:", error);
    res.status(500).json({ error: "De kennisbank reageert momenteel niet. Probeer het later opnieuw." });
  }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "mw_search",
        description: "Search the Masterwatt technical knowledge base for heat pump information.",
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
    logActivity(ds, "SEARCH", args.query);
    const response = await fetch(`${WP_API_URL}?search=${encodeURIComponent(args.query)}`);
    const data = await response.json();
    
    if (!data || data.length === 0) {
      return { content: [{ type: "text", text: "Geen resultaten gevonden." }] };
    }

    const results = data.slice(0, 3).map(post => {
      const cleanContent = post.content.rendered.replace(/<[^>]*>?/gm, '').substring(0, 1200);
      return `TITEL: ${post.title.rendered}\nURL: ${post.link}\nINHOUD: ${cleanContent}...`;
    }).join("\n\n");

    return { content: [{ type: "text", text: results }] };
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
app.listen(PORT, () => console.log(`Masterwatt Server draait op poort ${PORT}`));
