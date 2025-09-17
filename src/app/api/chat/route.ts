import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import 'dotenv/config';

export async function POST(request: Request) {
  try {
    const { messages } = await request.json();
    console.log("チャット開始:", messages[messages.length - 1]?.content?.substring(0, 50) + "...");

    const result = await streamText({
      model: anthropic("claude-3-5-sonnet-20240620"),
      messages,
    });

    // ストリームを変換してログ出力
    const transformStream = new TransformStream({
      transform(chunk, controller) {
        const text = new TextDecoder().decode(chunk);
        console.log("ストリーミング受信:", text);
        controller.enqueue(chunk);
      }
    });

    const response = result.toTextStreamResponse();
    return new Response(response.body?.pipeThrough(transformStream), {
      headers: response.headers,
      status: response.status
    });
  } catch (error) {
    console.error("ストリーミングチャット処理エラー:", error);
    return new Response(
      JSON.stringify({ error: "ストリーミングチャット処理に失敗しました" }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
