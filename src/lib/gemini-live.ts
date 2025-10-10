import { GoogleGenAI, Modality } from "@google/genai";
import { int16ArrayToBase64 } from "./audio-utils";

interface GeminiLiveConfig {
  apiKey: string;
  model?: string;
  systemInstruction?: string;
  onMessage?: (message: unknown) => void;
  onError?: (error: Error) => void;
  onOpen?: () => void;
  onClose?: (reason: string) => void;
  onAudioChunk?: (pcm: Int16Array) => void; // 受信PCM(24k/mono/LE)
  onServerContent?: (server: {
    turnComplete?: boolean;
    interrupted?: boolean;
  }) => void; // 中断/完了通知
}

interface LiveMessage {
  serverContent?: {
    turnComplete?: boolean;
    interrupted?: boolean;
  };
  data?: string;
  text?: string;
}

// 最小限のLiveセッション型（SDKの内部実装に依存しないために必要メソッドのみ定義）
interface LiveSession {
  sendClientContent(payload: { turns: string }): void;
  sendRealtimeInput(payload: {
    audio: { data: string; mimeType: string };
  }): void;
  close(): void;
}

export class GeminiLiveClient {
  private ai: GoogleGenAI;
  private session: LiveSession | null = null;
  private responseQueue: LiveMessage[] = [];
  private config: GeminiLiveConfig;
  private isConnected = false;

  constructor(config: GeminiLiveConfig) {
    this.config = config;
    // 公式サンプル通りの初期化
    this.ai = new GoogleGenAI({
      apiKey: config.apiKey,
    });
  }

  async connect(responseModalities: Modality[] = [Modality.AUDIO]) {
    if (this.isConnected) {
      throw new Error("Already connected");
    }

    const model =
      this.config.model || "gemini-2.5-flash-native-audio-preview-09-2025";
    const sessionConfig = {
      responseModalities: responseModalities,
      systemInstruction:
        this.config.systemInstruction ||
        "You are a helpful assistant and answer in a friendly tone.",
    };

    try {
      // 公式サンプル通りの実装
      this.session = (await this.ai.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            console.debug("Gemini Live session opened");
            this.isConnected = true;
            this.config.onOpen?.();
          },
          onmessage: (message: unknown) => {
            console.debug("Received message:", message);
            const msg = (message ?? {}) as Partial<LiveMessage> &
              Record<string, unknown>;
            this.responseQueue.push(msg as LiveMessage);
            this.config.onMessage?.(msg);

            // 受信ストリーミング音声チャンクをデコードして即時コールバック
            try {
              if (msg?.data) {
                const base64 = msg.data as string;
                const binary = atob(base64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++)
                  bytes[i] = binary.charCodeAt(i);
                const int16 = new Int16Array(
                  bytes.buffer,
                  bytes.byteOffset,
                  Math.floor(bytes.byteLength / 2)
                );
                this.config.onAudioChunk?.(int16);
              }
            } catch (e) {
              console.warn("Failed to decode audio chunk:", e);
            }

            // 中断/ターン完了の通知
            if (msg?.serverContent) {
              const sc = msg.serverContent as {
                turnComplete?: boolean;
                interrupted?: boolean;
              };
              if (sc.turnComplete || sc.interrupted) {
                this.config.onServerContent?.(sc);
              }
            }
          },
          onerror: (e: unknown) => {
            const err = (e as { message?: string })?.message ?? "Unknown error";
            console.error("Gemini Live error:", err);
            this.config.onError?.(new Error(err));
          },
          onclose: (e: unknown) => {
            const reason = (e as { reason?: string })?.reason ?? "";
            console.debug("Gemini Live closed:", reason);
            this.isConnected = false;
            this.config.onClose?.(reason);
          },
        },
        config: sessionConfig,
      })) as unknown as LiveSession;
    } catch (error) {
      console.error("Failed to connect to Gemini Live API:", error);
      throw error;
    }
  }

  async sendText(text: string): Promise<LiveMessage[]> {
    if (!this.isConnected || !this.session) {
      throw new Error("Not connected");
    }

    // Clear previous messages
    this.responseQueue = [];

    // Send text message (公式サンプル通り)
    this.session.sendClientContent({ turns: text });

    // Wait for response
    return this.waitForTurn();
  }

  async sendAudio(
    audioData: string,
    mimeType: string = "audio/pcm;rate=16000"
  ): Promise<LiveMessage[]> {
    if (!this.isConnected || !this.session) {
      throw new Error("Not connected");
    }

    // Clear previous messages
    this.responseQueue = [];

    // Send audio data (公式サンプル通り)
    this.session.sendRealtimeInput({
      audio: {
        data: audioData,
        mimeType: mimeType,
      },
    });

    // Wait for response
    return this.waitForTurn();
  }

  // PCMチャンクを即時送信
  sendAudioChunk(pcmChunk: Int16Array, sampleRate: number = 16000) {
    if (!this.isConnected || !this.session) {
      throw new Error("Not connected");
    }
    const base64 = int16ArrayToBase64(pcmChunk);
    this.session.sendRealtimeInput({
      audio: {
        data: base64,
        mimeType: `audio/pcm;rate=${sampleRate}`,
      },
    });
  }

  private async waitMessage(): Promise<LiveMessage> {
    // 公式サンプル通りの実装
    return new Promise((resolve) => {
      const checkQueue = () => {
        const message = this.responseQueue.shift();
        if (message) {
          resolve(message);
        } else {
          setTimeout(checkQueue, 100);
        }
      };
      checkQueue();
    });
  }

  private async waitForTurn(): Promise<LiveMessage[]> {
    // 公式サンプル通りの実装
    const turns: LiveMessage[] = [];
    let done = false;

    while (!done) {
      const message = await this.waitMessage();
      turns.push(message);

      if (message.serverContent && message.serverContent.turnComplete) {
        done = true;
      }

      // Handle interruption
      if (message.serverContent && message.serverContent.interrupted) {
        console.debug("Generation was interrupted");
        done = true;
      }
    }

    return turns;
  }

  // Audio utility methods (公式サンプル通り)
  combineAudioData(turns: LiveMessage[]): Int16Array | null {
    const combinedAudio = turns.reduce((acc: number[], turn: LiveMessage) => {
      if (turn.data) {
        // ブラウザ環境でBase64をArrayBufferに変換
        const binaryString = atob(turn.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const intArray = new Int16Array(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength / Int16Array.BYTES_PER_ELEMENT
        );
        return acc.concat(Array.from(intArray));
      }
      return acc;
    }, []);

    return combinedAudio.length > 0 ? new Int16Array(combinedAudio) : null;
  }

  extractTextResponses(turns: LiveMessage[]): string {
    return turns
      .filter((turn) => turn.text)
      .map((turn) => turn.text)
      .join(" ")
      .trim();
  }

  disconnect() {
    if (this.session) {
      this.session.close();
      this.session = null;
      this.isConnected = false;
    }
  }

  isSessionConnected(): boolean {
    return this.isConnected;
  }
}
