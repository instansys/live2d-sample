import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import 'dotenv/config';

export async function POST(request: Request) {
  try {
    const { messages } = await request.json();

    const result = await streamText({
      model: anthropic("claude-3-5-sonnet-20240620"),
      messages,
    });

    return result.toTextStreamResponse();
  } catch (error) {
    console.error("ストリーミングチャット処理エラー:", error);
    return new Response(
      JSON.stringify({ error: "ストリーミングチャット処理に失敗しました" }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
