const VOICEVOX_BASE_URL = "http://localhost:50021";
const SPEAKER_ID = 1; // ずんだもん

/**
 * 音声合成部分
 * @param text 音声に変換したいテキスト
 * @returns base64のaudioURL
 */
export async function generateAudio(text: string): Promise<string> {
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
    throw new Error(`音声クエリの生成に失敗: ${queryResponse.statusText}`);
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
    throw new Error(`音声合成に失敗: ${synthesisResponse.statusText}`);
  }

  // 音声データをBase64エンコード
  const audioBuffer = await synthesisResponse.arrayBuffer();
  const audioBase64 = Buffer.from(audioBuffer).toString('base64');
  
  return `data:audio/wav;base64,${audioBase64}`;
}
