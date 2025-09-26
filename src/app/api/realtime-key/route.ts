import { NextResponse } from "next/server";
import 'dotenv/config';

export async function POST() {
  try {
    const { OPENAI_API_KEY } = process.env;

    if (!OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 }
      );
    }

    // OpenAI Realtime APIの一時的なクライアントシークレットを生成
    const response = await fetch(
      "https://api.openai.com/v1/realtime/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session: {
            type: "realtime",
            model: "gpt-realtime",
          },
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      console.error("OpenAI API error:", errorData);
      return NextResponse.json(
        { error: "Failed to generate client secret" },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json({
      clientSecret: data.value,
    });
  } catch (error) {
    console.error("Error generating client secret:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
