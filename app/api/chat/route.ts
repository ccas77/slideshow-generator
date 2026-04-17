import { NextRequest, NextResponse } from "next/server";
import {
  bookStats,
  authorStats,
  adsMonitoring,
  countryStats,
  PCParams,
} from "@/lib/publisher-champ";

export const maxDuration = 60;

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

function systemPrompt() {
  return `You are a KDP data assistant. Today is ${new Date().toISOString().split("T")[0]}.

Call tools to fetch the user's real Publisher Champ data, then answer.

Rules:
- Be SHORT. Lead with numbers. No filler, no intros, no "let me look that up."
- Use fixed_range_selection shortcuts when they match (e.g. "this month" → "This Month")
- Default to USD unless told otherwise
- Format money as $1,234.56
- Use bullet points or short tables for multi-book answers
- Only highlight something noteworthy if it's genuinely unusual
- Never dump raw JSON`;
}

const TOOLS = [
  {
    name: "book_stats",
    description:
      "Get per-book sales, royalties, reads, ad spend, and more for a date range. Returns detailed data per book including units sold by format, KU reads, ad spend, gross/net royalty, country breakdown, etc.",
    input_schema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "YYYY-MM-DD" },
        end_date: { type: "string", description: "YYYY-MM-DD" },
        fixed_range_selection: {
          type: "string",
          enum: [
            "Today", "Yesterday", "This Week", "Last Week",
            "This Month", "Last Month", "Last 7 days", "Last 30 days",
            "Last 90 days", "This Year", "Last Year",
          ],
        },
        currency: { type: "string", description: "3-letter code e.g. USD" },
        countries: { type: "string", description: "Comma-separated country codes e.g. US,UK,DE" },
        include_country_breakdown: { type: "boolean" },
        include_platform_breakdown: { type: "boolean" },
      },
      required: [],
    },
  },
  {
    name: "author_stats",
    description:
      "Get per-author breakdowns of units sold, royalties, and KU reads for a date range. Useful for multi-pen-name publishers.",
    input_schema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "YYYY-MM-DD" },
        end_date: { type: "string", description: "YYYY-MM-DD" },
        fixed_range_selection: {
          type: "string",
          enum: [
            "Today", "Yesterday", "This Week", "Last Week",
            "This Month", "Last Month", "Last 7 days", "Last 30 days",
            "Last 90 days", "This Year", "Last Year",
          ],
        },
        currency: { type: "string", description: "3-letter code e.g. USD" },
      },
      required: [],
    },
  },
  {
    name: "ads_monitoring",
    description:
      "Get ad performance metrics grouped by ASIN: spend, impressions, clicks, CTR, CPC, orders, sales, ACOS, TACOS, KENP reads, ROI, etc.",
    input_schema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "YYYY-MM-DD" },
        end_date: { type: "string", description: "YYYY-MM-DD" },
        fixed_range_selection: {
          type: "string",
          enum: [
            "Today", "Yesterday", "This Week", "Last Week",
            "This Month", "Last Month", "Last 7 days", "Last 30 days",
            "Last 90 days", "This Year", "Last Year",
          ],
        },
        currency: { type: "string", description: "3-letter code e.g. USD" },
        countries: { type: "string", description: "Comma-separated country codes" },
      },
      required: [],
    },
  },
  {
    name: "country_stats",
    description:
      "Get royalties and ad spend broken down by country/marketplace. Shows earnings, spend, and ad sales per country with currency conversion.",
    input_schema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "YYYY-MM-DD" },
        end_date: { type: "string", description: "YYYY-MM-DD" },
        fixed_range_selection: {
          type: "string",
          enum: [
            "Today", "Yesterday", "This Week", "Last Week",
            "This Month", "Last Month", "Last 7 days", "Last 30 days",
            "Last 90 days", "This Year", "Last Year",
          ],
        },
        currency: { type: "string", description: "3-letter code e.g. USD" },
        countries: { type: "string", description: "Comma-separated country codes" },
      },
      required: [],
    },
  },
];

const toolFns: Record<string, (p: PCParams) => Promise<unknown>> = {
  book_stats: bookStats,
  author_stats: authorStats,
  ads_monitoring: adsMonitoring,
  country_stats: countryStats,
};

interface AnthropicMessage {
  role: "user" | "assistant";
  content: unknown;
}

async function callClaude(messages: AnthropicMessage[]) {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt(),
      tools: TOOLS,
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error: ${err}`);
  }
  return res.json();
}

export async function POST(req: NextRequest) {
  const pw = req.headers.get("x-password");
  if (pw !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { messages, pcApiKey, pcAccountId } = await req.json();

  if (!pcApiKey || !pcAccountId) {
    return NextResponse.json(
      { error: "Publisher Champ API key and account ID required" },
      { status: 400 }
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    let anthropicMessages: AnthropicMessage[] = messages.map(
      (m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })
    );

    let response = await callClaude(anthropicMessages);

    // Process tool calls in a loop
    while (response.stop_reason === "tool_use") {
      const assistantContent = response.content;
      anthropicMessages = [
        ...anthropicMessages,
        { role: "assistant", content: assistantContent },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolResults: any[] = [];

      for (const block of assistantContent) {
        if (block.type === "tool_use") {
          const fn = toolFns[block.name];
          if (!fn) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify({ error: `Unknown tool: ${block.name}` }),
              is_error: true,
            });
            continue;
          }

          try {
            const input = block.input as Record<string, unknown>;
            const params: PCParams = {
              api_key: pcApiKey,
              account_id: pcAccountId,
              ...input,
            } as PCParams;
            const result = await fn(params);
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          } catch (err) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              }),
              is_error: true,
            });
          }
        }
      }

      anthropicMessages = [
        ...anthropicMessages,
        { role: "user", content: toolResults },
      ];

      response = await callClaude(anthropicMessages);
    }

    // Extract text response
    const text = response.content
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("");

    return NextResponse.json({ text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
