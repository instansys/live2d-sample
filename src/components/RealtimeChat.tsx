"use client";
import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";
import { useState, useRef } from "react";

interface RealtimeChatProps {
  onTranscript?: (transcript: string) => void;
  onResponse?: (response: string) => void;
  conversationHistory?: Array<{
    type: "user" | "assistant";
    content: string;
    timestamp: Date;
  }>;
}

export default function RealtimeChat({
  onTranscript,
  onResponse,
  conversationHistory = [],
}: RealtimeChatProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");
  const [response, setResponse] = useState<string>("");
  const sessionRef = useRef<RealtimeSession | null>(null);

  const connect = async () => {
    setIsConnecting(true);
    setError(null);

    try {
      // サーバーからクライアントシークレットを取得
      const keyResponse = await fetch("/api/realtime-key", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!keyResponse.ok) {
        throw new Error("クライアントシークレットの取得に失敗しました");
      }

      const { clientSecret } = await keyResponse.json();

      const agent = new RealtimeAgent({
        name: "Assistant",
        instructions: "You are a helpful assistant. Respond in Japanese.",
      });

      const session = new RealtimeSession(agent);
      sessionRef.current = session;

      // イベントリスナーを設定
      session.on("conversation.item.input", (event: any) => {
        if (event.type === "message" && event.message) {
          const userMessage = event.message.content[0];
          if (userMessage.type === "input_text") {
            const userText = userMessage.text;
            setTranscript(userText);
            if (onTranscript) {
              onTranscript(userText);
            }
          }
        }
      });

      session.on("conversation.item.output", (event: any) => {
        if (event.type === "message" && event.message) {
          const assistantMessage = event.message.content[0];
          if (assistantMessage.type === "output_text") {
            const assistantText = assistantMessage.text;
            setResponse(assistantText);
            if (onResponse) {
              onResponse(assistantText);
            }
          }
        }
      });

      await session.connect({
        apiKey: clientSecret,
      });

      setIsConnected(true);
      console.log("Realtime APIに接続しました！");
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
    if (sessionRef.current) {
      try {
        // RealtimeSessionの正しい切断方法を使用
        await sessionRef.current.close();
        sessionRef.current = null;
        setIsConnected(false);
        setTranscript("");
        setResponse("");
        console.log("接続を切断しました");
      } catch (e) {
        console.error("切断エラー:", e);
      }
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">音声会話</h3>

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
              音声会話が有効です
            </span>
          </div>

          <button
            onClick={disconnect}
            className="w-full px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
          >
            音声会話を停止
          </button>
        </div>
      )}

      {/* 会話履歴の表示 */}
      {conversationHistory.length > 0 && (
        <div className="mt-4 max-h-64 overflow-y-auto bg-white p-3 rounded border">
          <h4 className="text-sm font-medium text-gray-800 mb-2">会話履歴</h4>
          {conversationHistory.map((message, index) => (
            <div
              key={index}
              className={`mb-2 ${
                message.type === "user" ? "text-right" : "text-left"
              }`}
            >
              <div
                className={`inline-block p-2 rounded text-sm max-w-xs ${
                  message.type === "user"
                    ? "bg-blue-500 text-white"
                    : "bg-gray-200 text-gray-800"
                }`}
              >
                {message.content}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {message.timestamp.toLocaleTimeString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 現在の会話 */}
      {(transcript || response) && (
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded">
          <h4 className="text-sm font-medium text-blue-800 mb-2">現在の会話</h4>
          {transcript && (
            <div className="mb-2">
              <span className="text-xs text-blue-600 font-medium">あなた:</span>
              <p className="text-sm text-blue-700">{transcript}</p>
            </div>
          )}
          {response && (
            <div>
              <span className="text-xs text-blue-600 font-medium">
                アシスタント:
              </span>
              <p className="text-sm text-blue-700">{response}</p>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-100 border border-red-300 rounded text-red-700 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
