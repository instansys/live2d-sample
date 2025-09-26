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
  onHistoryUpdate?: (
    history: Array<{
      type: "user" | "assistant";
      content: string;
      timestamp: Date;
    }>
  ) => void;
}

export default function RealtimeChat({
  onTranscript,
  onResponse,
  conversationHistory = [],
  onHistoryUpdate,
}: RealtimeChatProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");
  const [response, setResponse] = useState<string>("");
  const [textInput, setTextInput] = useState<string>("");
  const [isSending, setIsSending] = useState(false);
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
        console.log("Input event:", event);
        if (event.type === "message" && event.message) {
          const userMessage = event.message.content[0];
          if (userMessage.type === "input_text") {
            const userText = userMessage.text;
            console.log("User text:", userText);
            setTranscript(userText);
            if (onTranscript) {
              onTranscript(userText);
            }
          }
        }
      });

      session.on("conversation.item.output", (event: any) => {
        console.log("Output event:", event);
        if (event.type === "message" && event.message) {
          const assistantMessage = event.message.content[0];
          if (assistantMessage.type === "output_text") {
            const assistantText = assistantMessage.text;
            console.log("Assistant text:", assistantText);
            setResponse(assistantText);
            if (onResponse) {
              onResponse(assistantText);
            }
          }
        }
      });

      // output_audioイベントを追加
      session.on("conversation.item.output", (event: any) => {
        console.log("Output event:", event);
        if (event.type === "output_audio" && event.transcript) {
          console.log("Assistant transcript:", event.transcript);
          setResponse(event.transcript);
          if (onResponse) {
            onResponse(event.transcript);
          }
        }
      });

      // 追加のイベントリスナー
      session.on("response.audio.delta", (event: any) => {
        console.log("Audio delta event:", event);
      });

      session.on("response.text.delta", (event: any) => {
        console.log("Text delta event:", event);
        if (event.delta) {
          setResponse((prev) => prev + event.delta);
          if (onResponse) {
            onResponse(event.delta);
          }
        }
      });

      // 会話履歴の更新を監視
      session.on("history_updated", (history: any) => {
        console.log("History updated:", history);
        // 履歴をローカル状態に変換
        const formattedHistory = history
          .filter(
            (item: any) =>
              item.type === "message" || item.type === "output_audio"
          )
          .map((item: any) => {
            console.log("Processing item:", item);
            // contentの処理を改善
            let content = "";
            if (item.type === "output_audio") {
              // output_audioタイプの場合はtranscriptフィールドを直接取得
              content = item.transcript || "";
              console.log("output_audio content:", content);
            } else if (Array.isArray(item.content)) {
              content = item.content[0]?.text || item.content[0] || "";
            } else if (typeof item.content === "string") {
              content = item.content;
            } else if (item.content && typeof item.content === "object") {
              // transcriptフィールドを優先的に取得
              content = item.content.transcript || item.content.text || "";
            }

            const result = {
              type: item.role === "user" ? "user" : "assistant",
              content: content,
              timestamp: new Date(item.created_at || Date.now()),
            };
            console.log("Formatted result:", result);
            return result;
          });

        // 親コンポーネントに履歴を渡す
        if (onHistoryUpdate) {
          onHistoryUpdate(formattedHistory);
        }

        // 最新のメッセージを個別に処理
        if (formattedHistory.length > 0) {
          const lastMessage = formattedHistory[formattedHistory.length - 1];
          if (lastMessage.type === "user" && onTranscript) {
            onTranscript(lastMessage.content);
          } else if (lastMessage.type === "assistant" && onResponse) {
            onResponse(lastMessage.content);
          }
        }
      });

      // すべてのイベントをログに出力
      session.on("*", (event: any) => {
        console.log("All events:", event);
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

  const sendTextMessage = async () => {
    if (!textInput.trim() || !isConnected || isSending) return;

    setIsSending(true);
    try {
      // テキストメッセージをRealtime APIに送信
      await (sessionRef.current as any).sendMessage({
        type: "message",
        message: {
          role: "user",
          content: [
            {
              type: "input_text",
              text: textInput,
            },
          ],
        },
      });

      // ローカル状態を更新
      setTranscript(textInput);
      if (onTranscript) {
        onTranscript(textInput);
      }

      setTextInput("");
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

          {/* テキスト入力フィールド */}
          <div className="space-y-2">
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="テキストでメッセージを入力..."
              className="w-full h-20 p-2 border border-gray-300 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendTextMessage();
                }
              }}
            />
            <button
              onClick={sendTextMessage}
              disabled={!textInput.trim() || isSending}
              className="w-full px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 transition-colors text-sm"
            >
              {isSending ? "送信中..." : "テキスト送信"}
            </button>
          </div>

          <button
            onClick={disconnect}
            className="w-full px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
          >
            音声会話を停止
          </button>
        </div>
      )}

      {/* チャット履歴の表示 */}
      <div className="mt-4 max-h-80 overflow-y-auto bg-white p-3 rounded border">
        <h4 className="text-sm font-medium text-gray-800 mb-3 sticky top-0 bg-white pb-2">
          チャット履歴
        </h4>

        {/* 会話履歴 */}
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
              {(() => {
                if (typeof message.content === "string") {
                  return message.content;
                } else if (
                  message.content &&
                  typeof message.content === "object"
                ) {
                  // オブジェクトの場合はtranscriptフィールドを取得
                  return (
                    message.content.transcript ||
                    message.content.text ||
                    JSON.stringify(message.content)
                  );
                } else {
                  return String(message.content || "");
                }
              })()}
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

        {/* 現在の会話（まだ履歴に追加されていないもの） */}
        {transcript && (
          <div className="mb-3 text-right">
            <div className="inline-block p-3 rounded-lg text-sm max-w-xs bg-blue-500 text-white rounded-br-sm">
              {(() => {
                if (typeof transcript === "string") {
                  return transcript;
                } else if (transcript && typeof transcript === "object") {
                  return (
                    transcript.transcript ||
                    transcript.text ||
                    JSON.stringify(transcript)
                  );
                } else {
                  return String(transcript || "");
                }
              })()}
            </div>
            <div className="text-xs text-gray-500 mt-1 text-right">あなた</div>
          </div>
        )}

        {response && (
          <div className="mb-3 text-left">
            <div className="inline-block p-3 rounded-lg text-sm max-w-xs bg-gray-100 text-gray-800 rounded-bl-sm">
              {(() => {
                if (typeof response === "string") {
                  return response;
                } else if (response && typeof response === "object") {
                  return (
                    response.transcript ||
                    response.text ||
                    JSON.stringify(response)
                  );
                } else {
                  return String(response || "");
                }
              })()}
            </div>
            <div className="text-xs text-gray-500 mt-1 text-left">
              アシスタント
            </div>
          </div>
        )}

        {/* 履歴が空の場合の表示 */}
        {conversationHistory.length === 0 && !transcript && !response && (
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
