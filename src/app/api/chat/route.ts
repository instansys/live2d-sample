import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { NextResponse } from "next/server";
import 'dotenv/config';

const VOICEVOX_BASE_URL = "http://localhost:50021"; // voicevoxのローカルエンドポイント
const SPEAKER_ID = 1; // ずんだもん

async function generateAudioFromText(text: string): Promise<string | null> {
  try {
    // 音声合成用のクエリ作成
    const queryResponse = await fetch(
      `${VOICEVOX_BASE_URL}/audio_query?speaker=${SPEAKER_ID}&text=${encodeURIComponent(text)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!queryResponse.ok) {
      console.error("音声クエリの生成に失敗しました:", queryResponse.statusText);
      return null;
    }

    const queryData = await queryResponse.json();

    // 音声合成実行
    const synthesisResponse = await fetch(
      `${VOICEVOX_BASE_URL}/synthesis?speaker=${SPEAKER_ID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(queryData),
      }
    );

    if (!synthesisResponse.ok) {
      console.error("音声合成に失敗しました:", synthesisResponse.statusText);
      return null;
    }

    // 音声データをBase64エンコード
    const audioBuffer = await synthesisResponse.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString('base64');
    
    return `data:audio/wav;base64,${audioBase64}`;
  } catch (error) {
    console.error("音声生成エラー:", error);
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const { messages } = await request.json();

    const response = await generateText({
      model: anthropic("claude-3-5-sonnet-20240620"),
      messages,
    });
    const responseText = response.text;
    
    // 応答を音声に変換
    const audioUrl = await generateAudioFromText(responseText);

    return NextResponse.json({
      message: responseText,
      audioUrl: audioUrl,
    });
  } catch (error) {
    console.error("チャット処理エラー:", error);
    return NextResponse.json(
      { error: "チャット処理に失敗しました" },
      { status: 500 }
    );
  }
}
