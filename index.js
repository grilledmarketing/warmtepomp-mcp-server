import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";

const WP_API_URL = "https://www.masterwatt.com/wp-json/wp/v2/epkb_post_type_1";

const server = new Server({
  name: "masterwatt-expert",
  version: "1.0.0",
}, {
  capabilities: {
    tools: {},
  },
});

// 1. Definieer de tool die de LLM kan gebruiken
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "zoek_warmtepomp_kennis",
        description: "Zoek in de officiële Masterwatt kennisbank naar technische informatie over warmtepompen, condensbewaking en principeschema's.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "De zoekterm of vraag van de gebruiker",
            },
          },
          required: ["query"],
        },
      },
    ],
  };
});

// 2. Handel de zoekopdracht af naar WordPress
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "zoek_warmtepomp_kennis") {
    const query = request.params.arguments.query;
    const response = await fetch(`${WP_API_URL}?search=${encodeURIComponent(query)}&_embed`);
    const data = await response.json();

    if (!data || data.length === 0) {
      return { content: [{ type: "text", text: "Geen specifieke informatie gevonden voor deze vraag in de Masterwatt kennisbank." }] };
    }

    // Pak de eerste 3 resultaten en strip de HTML
    const results = data.slice(0, 3).map(post => {
      const cleanContent = post.content.rendered.replace(/<[^>]*>?/gm, '').trim();
      return `TITEL: ${post.title.rendered}\nURL: ${post.link}\nINHOUD: ${cleanContent}\n---`;
    }).join("\n\n");

    return {
      content: [
        {
          type: "text",
          text: `Gevonden informatie in de Masterwatt kennisbank:\n\n${results}`,
        },
      ],
    };
  }
  throw new Error("Tool niet gevonden");
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);