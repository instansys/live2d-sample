"use client";
import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";
import { useState, useRef, useEffect } from "react";
import type { Live2DModel } from 'pixi-live2d-display-lipsyncpatch/cubism4';

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
  live2dModel?: Live2DModel | null;
}

export default function RealtimeChat({
  onTranscript,
  onResponse,
  conversationHistory = [],
  onHistoryUpdate,
  live2dModel,
}: RealtimeChatProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");
  const [response, setResponse] = useState<string>("");
  const [textInput, setTextInput] = useState<string>("");
  const [isSending, setIsSending] = useState(false);
  const sessionRef = useRef<RealtimeSession | null>(null);
  const lipsyncRef = useRef<{ 
    dispose: () => void; 
    resume: () => Promise<void>;
    triggerSpeaking?: (delay?: number) => void;
  } | null>(null);
  
  // タイミング調査用の状態
  const [audioTimestamps, setAudioTimestamps] = useState<{
    textReceived: number;
    audioStarted: number;
    estimatedDelay: number;
  }>({ textReceived: 0, audioStarted: 0, estimatedDelay: 500 }); // デフォルト500ms遅延

  // Live2Dモデルが用意できたらリップシンクを設定し、自動で音声監視を開始
  useEffect(() => {
    if (live2dModel && sessionRef.current && isConnected && !lipsyncRef.current) {
      const setupLipsync = async () => {
        try {
          console.log('Setting up lipsync with Live2D model');
          const { setupRealtimeLipsync } = await import("@/lib/lipsync");
          const lipsync = setupRealtimeLipsync(live2dModel, sessionRef.current);
          lipsyncRef.current = lipsync;
          
          // 音声再生の準備とリップシンク監視を自動開始
          lipsync.resume().then(() => {
            console.log('Lipsync resumed successfully');
            // 自動で音声監視を開始
            if (lipsync.triggerSpeaking) {
              console.log('Auto-starting audio monitoring...');
              lipsync.triggerSpeaking();
            }
          }).catch((e) => {
            console.warn('Initial lipsync resume failed:', e);
            // エラーが発生しても音声監視は試行する
            if (lipsync.triggerSpeaking) {
              console.log('Auto-starting audio monitoring despite resume error...');
              lipsync.triggerSpeaking();
            }
            setError('音声再生の準備ができませんでした。ページをクリックしてください');
          });
        } catch (e) {
          console.error('Failed to setup lipsync:', e);
          setError(`リップシンク設定に失敗しました: ${e instanceof Error ? e.message : '不明なエラー'}`);
        }
      };
      
      setupLipsync();
    }
  }, [live2dModel, isConnected]);

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
      session.on("conversation.item.input", (event: { 
        type?: string; 
        message?: { 
          content: Array<{ type: string; text?: string }>
        } 
      }) => {
        console.log("Input event:", event);
        if (event.type === "message" && event.message) {
          const userMessage = event.message.content[0];
          if (userMessage.type === "input_text") {
            const userText = userMessage.text;
            console.log("User text:", userText);
            setTranscript(userText || "");
            if (onTranscript && userText) {
              onTranscript(userText);
            }
          }
        }
      });

      session.on("conversation.item.output", (event: {
        type?: string;
        message?: {
          content: Array<{ type: string; text?: string }>
        }
      }) => {
        console.log("Output event:", event);
        if (event.type === "message" && event.message) {
          const assistantMessage = event.message.content[0];
          if (assistantMessage.type === "output_text") {
            const assistantText = assistantMessage.text;
            console.log("Assistant text:", assistantText);
            setResponse(assistantText || "");
            
            // リップシンクをトリガー（遅延補正付き）
            if (lipsyncRef.current?.triggerSpeaking && assistantText) {
              const currentTime = Date.now();
              setAudioTimestamps(prev => ({ ...prev, textReceived: currentTime }));
              
              // 推定遅延でリップシンクを遅らせる
              console.log('[TIMING] Text response received, triggering lipsync with delay:', audioTimestamps.estimatedDelay);
              lipsyncRef.current.triggerSpeaking(audioTimestamps.estimatedDelay);
            }
            
            if (onResponse && assistantText) {
              onResponse(assistantText);
            }
          }
        }
      });

      // output_audioイベントを追加
      session.on("conversation.item.output", (event: {
        type?: string;
        transcript?: string;
      }) => {
        console.log("Output event:", event);
        if (event.type === "output_audio" && event.transcript) {
          console.log("Assistant transcript:", event.transcript);
          setResponse(event.transcript);
          
          // リップシンクをトリガー（音声レスポンス、遅延補正付き）
          if (lipsyncRef.current?.triggerSpeaking) {
            const currentTime = Date.now();
            setAudioTimestamps(prev => ({ ...prev, textReceived: currentTime }));
            
            console.log('[TIMING] Audio response received, triggering lipsync with delay:', audioTimestamps.estimatedDelay);
            lipsyncRef.current.triggerSpeaking(audioTimestamps.estimatedDelay);
          }
          
          if (onResponse) {
            onResponse(event.transcript);
          }
        }
      });

      // 追加のイベントリスナー（音声データを詳しく調査）
      session.on("response.audio.delta", (event: { delta?: unknown }) => {
        console.log("Audio delta event:", event);
        
        // 音声データの詳細を調査
        if (event.delta) {
          console.log("Audio delta type:", typeof event.delta);
          console.log("Audio delta constructor:", event.delta.constructor?.name);
          
          // ArrayBufferかどうかチェック
          if (event.delta instanceof ArrayBuffer) {
            console.log("Audio delta is ArrayBuffer, length:", event.delta.byteLength);
            
            // リップシンクに音声データを送信
            if (lipsyncRef.current?.triggerSpeaking) {
              console.log('[TIMING] Audio delta received, triggering lipsync');
              // 実際の音声データでリップシンク処理
              lipsyncRef.current.triggerSpeaking();
            }
          }
          
          // Base64文字列かどうかチェック
          if (typeof event.delta === 'string') {
            console.log("Audio delta is string, length:", event.delta.length);
            if (event.delta.startsWith('data:audio/') || event.delta.length > 100) {
              console.log("Audio delta appears to be audio data");
              
              if (lipsyncRef.current?.triggerSpeaking) {
                console.log('[TIMING] Audio string data received, triggering lipsync');
                lipsyncRef.current.triggerSpeaking();
              }
            }
          }
        }
      });

      session.on("response.text.delta", (event: { delta?: string }) => {
        console.log("Text delta event:", event);
        if (event.delta) {
          setResponse((prev) => prev + event.delta);
          
          // リップシンクをトリガー（ストリーミングテキスト、遅延補正付き）
          if (lipsyncRef.current?.triggerSpeaking) {
            const currentTime = Date.now();
            setAudioTimestamps(prev => ({ ...prev, textReceived: currentTime }));
            
            console.log('[TIMING] Streaming text received, triggering lipsync with delay:', audioTimestamps.estimatedDelay);
            lipsyncRef.current.triggerSpeaking(audioTimestamps.estimatedDelay);
          }
          
          if (onResponse) {
            onResponse(event.delta);
          }
        }
      });

      // 会話履歴の更新を監視
      session.on("history_updated", (history: Array<{
        type?: string;
        role?: string;
        content?: unknown;
        transcript?: string;
        created_at?: number;
      }>) => {
        console.log("History updated:", history);
        // 履歴をローカル状態に変換
        const formattedHistory = history
          .filter(
            (item) =>
              item.type === "message" || item.type === "output_audio"
          )
          .map((item) => {
            console.log("Processing item:", item);
            // contentの処理を改善
            let content = "";
            if (item.type === "output_audio") {
              // output_audioタイプの場合はtranscriptフィールドを直接取得
              content = item.transcript || "";
              console.log("output_audio content:", content);
            } else if (Array.isArray(item.content)) {
              const contentArray = item.content as Array<{ 
                type?: string; 
                text?: string; 
                transcript?: string; 
                audio?: unknown; 
              }>;
              // contentの最初の要素からテキストを抽出
              const firstContent = contentArray[0];
              if (firstContent) {
                content = firstContent.text || firstContent.transcript || "";
                console.log('Extracted content from array:', content, 'from:', firstContent);
              }
            } else if (typeof item.content === "string") {
              content = item.content;
            } else if (item.content && typeof item.content === "object") {
              // transcriptフィールドを優先的に取得
              const contentObj = item.content as { 
                transcript?: string; 
                text?: string; 
                type?: string;
              };
              content = contentObj.transcript || contentObj.text || JSON.stringify(contentObj);
              console.log('Extracted content from object:', content, 'from:', contentObj);
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
            // アシスタントメッセージでリップシンクをトリガー（遅延補正付き）
            if (lipsyncRef.current?.triggerSpeaking && lastMessage.content) {
              const currentTime = Date.now();
              setAudioTimestamps(prev => ({ ...prev, textReceived: currentTime }));
              
              console.log('[TIMING] History update with assistant message, triggering lipsync with delay:', audioTimestamps.estimatedDelay);
              lipsyncRef.current.triggerSpeaking(audioTimestamps.estimatedDelay);
            }
            onResponse(lastMessage.content);
          }
        }
      });

      // すべてのイベントをログに出力（音声関連を詳細に）
      session.on("*", (event: unknown) => {
        const eventObj = event as any;
        
        // 音声関連のイベントを詳しくログ出力
        if (eventObj?.type?.toLowerCase().includes('audio') || 
            eventObj?.event?.toLowerCase().includes('audio')) {
          console.log("Audio event detected:", eventObj);
          
          // 音声データがあるかチェック
          if (eventObj.delta || eventObj.audio || eventObj.data) {
            console.log("Audio data found in event:", {
              delta: eventObj.delta ? 'has delta' : 'no delta',
              audio: eventObj.audio ? 'has audio' : 'no audio', 
              data: eventObj.data ? 'has data' : 'no data'
            });
          }
        } else {
          console.log("All events:", event);
        }
      });

      await session.connect({
        apiKey: clientSecret,
      });

      setIsConnected(true);
      console.log("Realtime APIに接続しました！");
      
      // リップシンクが既に設定されていればresumeと監視を開始
      if (lipsyncRef.current) {
        try {
          await lipsyncRef.current.resume();
          // 接続後に自動で音声監視を開始
          if (lipsyncRef.current.triggerSpeaking) {
            console.log('Auto-starting audio monitoring after connection...');
            lipsyncRef.current.triggerSpeaking();
          }
        } catch (e) {
          console.warn('Lipsync resume failed after connection:', e);
          // エラーが発生しても音声監視は試行する
          if (lipsyncRef.current?.triggerSpeaking) {
            console.log('Auto-starting audio monitoring despite error...');
            lipsyncRef.current.triggerSpeaking();
          }
        }
      }
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
    // リップシンクのクリーンアップ
    if (lipsyncRef.current) {
      try {
        lipsyncRef.current.dispose();
        lipsyncRef.current = null;
        console.log("Lipsync disposed");
      } catch (e) {
        console.error("Lipsync dispose error:", e);
      }
    }

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
    if (!textInput.trim() || !isConnected || isSending || !sessionRef.current) return;

    setIsSending(true);
    try {
      console.log("Sending text message:", textInput);
      console.log("Session object:", sessionRef.current);
      console.log("Session methods:", Object.getOwnPropertyNames(sessionRef.current));
      
      const session = sessionRef.current;
      
      // RealtimeSessionのメソッドを確認
      try {
        if (session && typeof session.sendMessage === 'function') {
          console.log("Using sendMessage method");
          await session.sendMessage({
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
        } else if (session && typeof (session as any).send === 'function') {
          console.log("Using send method");
          // 代替メソッド
          await (session as any).send({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: textInput,
                },
              ],
            },
          });
        } else {
          console.error("Available methods:", session ? Object.getOwnPropertyNames(Object.getPrototypeOf(session)) : "null");
          throw new Error("送信メソッドが見つかりません");
        }
      } catch (methodError) {
        console.error("Method execution error:", methodError);
        throw methodError;
      }

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
