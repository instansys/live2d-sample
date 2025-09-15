import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import { NextResponse } from "next/server";
import 'dotenv/config';

export async function POST(request: Request) {
  const { messages } = await request.json();
  const response = await streamText({
    model: anthropic("claude-3-5-sonnet-20240620"),
    messages,
  });
  return new NextResponse(response.toTextStreamResponse().body);
}
