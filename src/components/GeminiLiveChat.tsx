"use client";
import { useState, useRef, useEffect } from "react";
import type { Live2DModel } from "pixi-live2d-display-lipsyncpatch/cubism4";
import { GeminiLiveClient } from "@/lib/gemini-live";
import {
  AudioRecorder,
  AudioPlayer,
  blobToBase64,
  createWaveFile,
  StreamingAudioPlayer,
  MicPcmStreamer,
} from "@/lib/audio-utils";
import { Modality } from "@google/genai";
import { wireLipsyncFromMediaStream } from "@/lib/lipsync";
import "dotenv/config";

interface GeminiLiveChatProps {
  onTranscript?: (transcript: string) => void;
  onResponse?: (response: string) => void;
  conversationHistory?: Array<{
    type: "user" | "assistant";
    content: string;
    timestamp: Date;
  }>;
  onHistoryUpdate?: (
    history: Array<{
      type: "user" | "assistant";
      content: string;
      timestamp: Date;
    }>
  ) => void;
  live2dModel?: Live2DModel | null;
}

export default function GeminiLiveChat({
  onTranscript,
  onResponse,
  conversationHistory = [],
  onHistoryUpdate,
  live2dModel,
}: GeminiLiveChatProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");
  const [response, setResponse] = useState<string>("");
  const [textInput, setTextInput] = useState<string>("");
  const [isSending, setIsSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  const geminiClientRef = useRef<GeminiLiveClient | null>(null);
  const audioRecorderRef = useRef<AudioRecorder | null>(null);
  const audioPlayerRef = useRef<AudioPlayer | null>(null);
  const streamingPlayerRef = useRef<StreamingAudioPlayer | null>(null);
  const micStreamerRef = useRef<MicPcmStreamer | null>(null);
  const hasStreamedThisTurnRef = useRef<boolean>(false);
  const lipsyncBindingRef = useRef<{
    dispose: () => void;
    resume: () => Promise<void>;
  } | null>(null);

  // Initialize audio utilities
  useEffect(() => {
    audioRecorderRef.current = new AudioRecorder();
    audioPlayerRef.current = new AudioPlayer();

    return () => {
      // Cleanup on unmount
      disconnect();
    };
  }, []);

  const connect = async () => {
    setIsConnecting(true);
    setError(null);

    try {
      // Get API key from environment
      const apiKey = process.env.GEMINI_API_KEY || "";

      const client = new GeminiLiveClient({
        apiKey: apiKey,
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        systemInstruction:
          "You are a helpful assistant and answer in a friendly tone.",
        onMessage: (message) => {
          // テキストや各種イベントのログ
          console.log("Gemini Live message:", message);
        },
        onError: (error) => {
          console.error("Gemini Live error:", error);
          setError(error.message);
        },
        onOpen: () => {
          console.log("Gemini Live connection opened");
          setIsConnected(true);
        },
        onClose: (reason) => {
          console.log("Gemini Live connection closed:", reason);
          setIsConnected(false);
        },
        onAudioChunk: async (pcm) => {
          // ストリーミング再生: 受信次第キューに積む
          try {
            if (!streamingPlayerRef.current) return;
            // 初回はAudioContextをresume
            await streamingPlayerRef.current.resume();
            streamingPlayerRef.current.enqueue(pcm);
            hasStreamedThisTurnRef.current = true;
          } catch (e) {
            console.warn("Streaming playback error:", e);
          }
        },
        onServerContent: (sc) => {
          // 中断時のみ未再生キューを破棄して即停止（turnComplete単独では止めない）
          if (sc?.interrupted && streamingPlayerRef.current) {
            streamingPlayerRef.current.flushAndStop();
          }
          // ターン完了時は次ターンに備えてフラグを初期化
          if (sc?.turnComplete) {
            hasStreamedThisTurnRef.current = false;
          }
        },
      });

      // ストリーミング音声応答
      await client.connect([Modality.AUDIO]);

      geminiClientRef.current = client;
      // ストリーミングプレイヤー初期化
      streamingPlayerRef.current = new StreamingAudioPlayer(24000);
      // ユーザークリック直後の文脈でAudioContextをresume（自動再生ポリシー対策）
      try {
        await streamingPlayerRef.current.resume();
      } catch {}

      // Live2Dリップシンク: AudioContext出力をMediaStream化して接続
      if (live2dModel && streamingPlayerRef.current) {
        const stream = streamingPlayerRef.current.getMediaStream();
        if (stream) {
          try {
            const { dispose, resume } = wireLipsyncFromMediaStream(
              live2dModel,
              stream
            );
            lipsyncBindingRef.current = { dispose, resume };
            // 初回再生に備えてresume
            await resume();
          } catch (e) {
            console.warn("Failed to setup lipsync from MediaStream:", e);
          }
        }
      }
      setIsConnected(true);
      console.log("Gemini Live APIに接続しました！");
    } catch (e) {
      console.error("接続エラー:", e);
      setError(
        `接続に失敗しました: ${e instanceof Error ? e.message : "不明なエラー"}`
      );
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = async () => {
    if (geminiClientRef.current) {
      geminiClientRef.current.disconnect();
      geminiClientRef.current = null;
    }
    if (streamingPlayerRef.current) {
      try {
        streamingPlayerRef.current.dispose();
      } catch {}
      streamingPlayerRef.current = null;
    }
    if (lipsyncBindingRef.current) {
      try {
        lipsyncBindingRef.current.dispose();
      } catch {}
      lipsyncBindingRef.current = null;
    }
    if (micStreamerRef.current?.isRunning()) {
      try {
        await micStreamerRef.current.stop();
      } catch {}
    }
    setIsConnected(false);
    setTranscript("");
    setResponse("");
    console.log("接続を切断しました");
  };

  const sendTextMessage = async () => {
    if (
      !textInput.trim() ||
      !isConnected ||
      isSending ||
      !geminiClientRef.current
    )
      return;

    setIsSending(true);
    setError(null);
    // 新しいターン開始時にストリーミング受信フラグをクリア
    hasStreamedThisTurnRef.current = false;

    try {
      console.log("Sending text message:", textInput);

      const messageText = textInput.trim();
      setTextInput(""); // Clear input immediately to prevent double sending

      // Send text to Gemini Live API
      const turns = await geminiClientRef.current.sendText(messageText);

      // Process response
      const responseText = geminiClientRef.current.extractTextResponses(turns);
      const audioData = geminiClientRef.current.combineAudioData(turns);

      // Create user message
      const userMessage = {
        type: "user" as const,
        content: messageText,
        timestamp: new Date(),
      };

      // Create assistant message if response exists
      let assistantMessage = null;
      if (responseText) {
        assistantMessage = {
          type: "assistant" as const,
          content: responseText,
          timestamp: new Date(),
        };
      }

      // Update history only once
      const updatedHistory = assistantMessage
        ? [...conversationHistory, userMessage, assistantMessage]
        : [...conversationHistory, userMessage];

      if (onHistoryUpdate) {
        onHistoryUpdate(updatedHistory);
      }

      // Play audio response if available (ストリーミング受信があれば二重再生を避ける)
      if (
        audioData &&
        audioPlayerRef.current &&
        live2dModel &&
        !hasStreamedThisTurnRef.current
      ) {
        setIsPlayingAudio(true);
        try {
          // Play audio through Live2D model for lip sync
          const audioBlob = createWaveFile(audioData, 24000);
          const audioUrl = URL.createObjectURL(audioBlob);

          await live2dModel.speak(audioUrl);

          // Cleanup URL
          URL.revokeObjectURL(audioUrl);
        } catch (audioError) {
          console.error("Audio playback error:", audioError);
          // Fallback to regular audio playback
          await audioPlayerRef.current.playAudioData(audioData, 24000);
        } finally {
          setIsPlayingAudio(false);
        }
      }
    } catch (e) {
      console.error("テキスト送信エラー:", e);
      setError(
        `テキスト送信に失敗しました: ${
          e instanceof Error ? e.message : "不明なエラー"
        }`
      );
    } finally {
      setIsSending(false);
    }
  };

  const startVoiceRecording = async () => {
    if (!audioRecorderRef.current || isRecording) return;

    try {
      await audioRecorderRef.current.startRecording();
      setIsRecording(true);
      setError(null);
    } catch (e) {
      console.error("録音開始エラー:", e);
      setError("マイクへのアクセスが拒否されました");
    }
  };

  const stopVoiceRecording = async () => {
    if (!audioRecorderRef.current || !isRecording || !geminiClientRef.current)
      return;

    try {
      const audioBlob = await audioRecorderRef.current.stopRecording();
      setIsRecording(false);

      // Convert audio to base64
      const base64Audio = await blobToBase64(audioBlob);

      console.log("Sending audio message");

      // Send audio to Gemini Live API
      const turns = await geminiClientRef.current.sendAudio(
        base64Audio,
        "audio/webm;codecs=opus"
      );

      // Process response
      const responseText = geminiClientRef.current.extractTextResponses(turns);
      const audioData = geminiClientRef.current.combineAudioData(turns);

      // Create messages for history
      const userMessage = {
        type: "user" as const,
        content: "[音声メッセージ]",
        timestamp: new Date(),
      };

      let assistantMessage = null;
      if (responseText) {
        assistantMessage = {
          type: "assistant" as const,
          content: responseText,
          timestamp: new Date(),
        };
      }

      // Update history only once
      const updatedHistory = assistantMessage
        ? [...conversationHistory, userMessage, assistantMessage]
        : [...conversationHistory, userMessage];

      if (onHistoryUpdate) {
        onHistoryUpdate(updatedHistory);
      }

      // Play audio response if available (ストリーミング受信があれば二重再生を避ける)
      if (
        audioData &&
        audioPlayerRef.current &&
        live2dModel &&
        !hasStreamedThisTurnRef.current
      ) {
        setIsPlayingAudio(true);
        try {
          // Play audio through Live2D model for lip sync
          const audioBlob = createWaveFile(audioData, 24000);
          const audioUrl = URL.createObjectURL(audioBlob);

          await live2dModel.speak(audioUrl);

          // Cleanup URL
          URL.revokeObjectURL(audioUrl);
        } catch (audioError) {
          console.error("Audio playback error:", audioError);
          // Fallback to regular audio playback
          await audioPlayerRef.current.playAudioData(audioData, 24000);
        } finally {
          setIsPlayingAudio(false);
        }
      }
    } catch (e) {
      console.error("音声送信エラー:", e);
      setError(
        `音声送信に失敗しました: ${
          e instanceof Error ? e.message : "不明なエラー"
        }`
      );
      setIsRecording(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-500">
        Gemini Live 音声会話
      </h3>

      {!isConnected && (
        <div className="space-y-3">
          <button
            onClick={connect}
            disabled={isConnecting}
            className="w-full px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400 transition-colors"
          >
            {isConnecting ? "接続中..." : "音声会話を開始"}
          </button>
        </div>
      )}

      {isConnected && (
        <div className="space-y-3">
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-sm text-green-600 font-medium">
              Gemini Live API接続中
            </span>
          </div>

          {/* Audio controls */}
          <div className="space-y-2">
            <div className="flex space-x-2">
              <button
                onClick={async () => {
                  if (!geminiClientRef.current) return;
                  if (!micStreamerRef.current) {
                    micStreamerRef.current = new MicPcmStreamer(16000);
                  }
                  if (micStreamerRef.current.isRunning()) {
                    await micStreamerRef.current.stop();
                    setIsRecording(false);
                    return;
                  }
                  try {
                    await micStreamerRef.current.start((pcm) => {
                      try {
                        geminiClientRef.current?.sendAudioChunk(pcm, 16000);
                      } catch {}
                    });
                    setIsRecording(true);
                    setError(null);
                  } catch (e) {
                    console.error("マイク開始エラー:", e);
                    setError("マイクへのアクセスが拒否されました");
                  }
                }}
                disabled={isPlayingAudio}
                className={`flex-1 px-4 py-3 text-white rounded transition-colors ${
                  isRecording
                    ? "bg-red-500 animate-pulse"
                    : "bg-blue-500 hover:bg-blue-600"
                } disabled:bg-gray-400`}
              >
                {isRecording ? "🎤 マイク送信中 (停止)" : "🎤 マイク送信開始"}
              </button>
            </div>
            <p className="text-xs text-gray-500 text-center">
              マイク常時オンでPCM(16kHz)をストリーミング送信します
            </p>
          </div>

          {/* Text input */}
          <div className="space-y-2">
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="テキストでメッセージを入力..."
              className="w-full h-20 p-2 border border-gray-300 text-gray-400 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendTextMessage();
                }
              }}
            />
            <button
              onClick={sendTextMessage}
              disabled={!textInput.trim() || isSending || isPlayingAudio}
              className="w-full px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 transition-colors text-sm"
            >
              {isSending ? "送信中..." : "テキスト送信"}
            </button>
          </div>

          <button
            onClick={disconnect}
            disabled={isRecording || isPlayingAudio}
            className="w-full px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:bg-gray-400 transition-colors"
          >
            音声会話を停止
          </button>
        </div>
      )}

      {/* Chat history */}
      <div className="mt-4 max-h-80 overflow-y-auto bg-white p-3 rounded border">
        <h4 className="text-sm font-medium text-gray-800 mb-3 sticky top-0 bg-white pb-2">
          チャット履歴
        </h4>

        {conversationHistory.map((message, index) => (
          <div
            key={index}
            className={`mb-3 ${
              message.type === "user" ? "text-right" : "text-left"
            }`}
          >
            <div
              className={`inline-block p-3 rounded-lg text-sm max-w-xs ${
                message.type === "user"
                  ? "bg-blue-500 text-white rounded-br-sm"
                  : "bg-gray-100 text-gray-800 rounded-bl-sm"
              }`}
            >
              {message.content}
            </div>
            <div
              className={`text-xs text-gray-500 mt-1 ${
                message.type === "user" ? "text-right" : "text-left"
              }`}
            >
              {message.timestamp.toLocaleTimeString()}
            </div>
          </div>
        ))}

        {/* Processing indicator */}
        {isSending && (
          <div className="mb-3 text-center">
            <div className="inline-block p-2 rounded-lg text-sm bg-gray-200 text-gray-600">
              送信中...
            </div>
          </div>
        )}

        {isPlayingAudio && (
          <div className="mb-3 text-center">
            <div className="inline-block p-2 rounded-lg text-sm bg-green-100 text-green-600">
              🎵 音声再生中...
            </div>
          </div>
        )}

        {conversationHistory.length === 0 && (
          <div className="text-center text-gray-500 text-sm py-4">
            会話を開始してください
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-100 border border-red-300 rounded text-red-700 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
