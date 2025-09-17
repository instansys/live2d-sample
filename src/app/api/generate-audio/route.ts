import { NextResponse } from "next/server";
import { generateAudio } from "@/lib/tts";

export async function POST(request: Request) {
  try {
    const { text } = await request.json();
    console.log("音声生成開始:", text);

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: "テキストが指定されていません" },
        { status: 400 }
      );
    }

    const audioUrl = await generateAudio(text);
    
    console.log("音声生成完了:", text);
    return NextResponse.json({ audioUrl });
  } catch (error) {
    console.error("音声生成エラー:", error);
    return NextResponse.json(
      { error: "音声生成に失敗しました" },
      { status: 500 }
    );
  }
}