import { NextResponse } from "next/server";

const VOICEVOX_BASE_URL = "http://localhost:50021"; // voicevoxのローカルエンドポイント
const SPEAKER_ID = 1; // ずんだもん

export async function POST(request: Request) {
  try {
    const { text } = await request.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: "テキストが指定されていません" },
        { status: 400 }
      );
    }

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
      return NextResponse.json(
        { error: "音声クエリの生成に失敗しました" },
        { status: 500 }
      );
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
      return NextResponse.json(
        { error: "音声合成に失敗しました" },
        { status: 500 }
      );
    }

    // 音声データをBase64エンコード
    const audioBuffer = await synthesisResponse.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString('base64');
    
    return NextResponse.json({
      audioUrl: `data:audio/wav;base64,${audioBase64}`,
    });
  } catch (error) {
    console.error("音声生成エラー:", error);
    return NextResponse.json(
      { error: "音声生成に失敗しました" },
      { status: 500 }
    );
  }
}