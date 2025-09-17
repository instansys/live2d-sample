"use client";
import { Application, Ticker, DisplayObject } from "pixi.js";
import { useEffect, useRef, useState } from "react";
import { Live2DModel } from "pixi-live2d-display-lipsyncpatch/cubism4";

const setModelPosition = (app: Application, model: Live2DModel) => {
  const scale = (app.renderer.width * 1.6) / model.width;
  model.scale.set(scale);
  model.x = app.renderer.width / 2;
  model.y = app.renderer.height - model.height * scale * 0.3;
};

const motions = [
  { name: "アイドル", group: "Idle", index: 0 },
  { name: "アイドル2", group: "Idle", index: 1 },
  { name: "タップ1", group: "TapBody", index: 0 },
  { name: "タップ2", group: "TapBody", index: 1 },
  { name: "タップ3", group: "TapBody", index: 2 },
  { name: "タップ4", group: "TapBody", index: 3 },
];

const expressions = [
  { name: "表情1", file: "F01" },
  { name: "表情2", file: "F02" },
  { name: "表情3", file: "F03" },
  { name: "表情4", file: "F04" },
  { name: "表情5", file: "F05" },
];

const sounds = [
  { name: "音声1", file: "haru_Info_04.wav" },
  { name: "音声2", file: "haru_Info_14.wav" },
  { name: "音声3", file: "haru_normal_6.wav" },
  { name: "音声4", file: "haru_talk_13.wav" },
];

type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function Live2D() {
  const canvasContainerRef = useRef<HTMLCanvasElement>(null);
  const [app, setApp] = useState<Application | null>(null);
  const [model, setModel] = useState<Live2DModel | null>(null);
  const [inputText, setInputText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const audioQueueRef = useRef<{ text: string; audioUrl: string | null; id: number }[]>([]);
  const chunkIdRef = useRef<number>(0);
  const isProcessingQueueRef = useRef<boolean>(false);

  const playMotion = (group: string, index: number) => {
    if (model) {
      model.motion(group, index, 3); // group, index, priority=3
    }
  };

  const playExpression = (expressionFile: string) => {
    if (model) {
      model.expression(expressionFile);
    }
  };

  const playSound = async (soundFile: string) => {
    if (model) {
      const audioUrl = `/live2d/Resources/Haru/sounds/${soundFile}`;
      try {
        await model.speak(audioUrl);
      } catch (error) {
        console.error("音声再生に失敗しました:", error);
      }
    }
  };

  const splitByPunctuation = (text: string): { completed: string[], remaining: string } => {
    const completed: string[] = [];
    let currentText = text;
    
    const punctuationMarks = ['。', '、', '.', ',', '!', '?', '！', '？'];
    
    while (currentText.length > 0) {
      let foundPunctuation = false;
      
      for (let i = 0; i < currentText.length; i++) {
        const char = currentText[i];
        if (punctuationMarks.includes(char)) {
          const chunk = currentText.substring(0, i + 1).trim();
          if (chunk.length > 0) {
            completed.push(chunk);
          }
          currentText = currentText.substring(i + 1).trim();
          foundPunctuation = true;
          break;
        }
      }
      
      // 句読点が見つからなかった場合、全て残りテキストとして扱う
      if (!foundPunctuation) {
        break;
      }
    }
    
    return { completed, remaining: currentText };
  };

  // onFinish付きの順序保証音声キュー処理
  const processAudioQueue = () => {
    if (isProcessingQueueRef.current || !model || audioQueueRef.current.length === 0) {
      return;
    }

    // 最初の要素が音声生成完了しているかチェック
    const firstItem = audioQueueRef.current[0];
    
    if (!firstItem || firstItem.audioUrl === null) {
      // まだ音声生成中なので少し待ってから再試行
      setTimeout(() => processAudioQueue(), 100);
      return;
    }

    isProcessingQueueRef.current = true;
    setIsPlayingAudio(true);
    
    const audioItem = audioQueueRef.current.shift()!;

    // onFinishコールバックを使って次の音声再生を制御
    model.speak(audioItem.audioUrl!, {
      onFinish: () => {
        setIsPlayingAudio(false);
        isProcessingQueueRef.current = false;
        
        // 次の音声があれば継続処理
        if (audioQueueRef.current.length > 0) {
          setTimeout(() => processAudioQueue(), 50);
        }
      },
      onError: (err) => {
        console.error("音声再生エラー:", audioItem.text, err);
        setIsPlayingAudio(false);
        isProcessingQueueRef.current = false;
        
        // エラーでも次の音声に進む
        if (audioQueueRef.current.length > 0) {
          setTimeout(() => processAudioQueue(), 50);
        }
      }
    });
  };

  // 音声をキューに追加（順序保証版）
  const addToAudioQueue = (sentence: string) => {
    const chunkId = chunkIdRef.current++;
    
    // まずキューに仮エントリを追加（順序を保証）
    const queueItem = {
      id: chunkId,
      text: sentence,
      audioUrl: null as string | null
    };
    audioQueueRef.current.push(queueItem);
    
    // 非同期で音声生成
    (async () => {
      try {
        const response = await fetch("/api/generate-audio", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: sentence }),
        });

        if (!response.ok) {
          throw new Error("音声生成に失敗しました");
        }

        const data = await response.json();
        if (data.audioUrl) {
          // キュー内の該当アイテムを更新
          const item = audioQueueRef.current.find(item => item.id === chunkId);
          if (item) {
            item.audioUrl = data.audioUrl;
          }
          
          // キュー処理を開始（最初のチャンクの場合は即座に、その他は少し遅延）
          if (chunkId === 0) {
            setTimeout(() => processAudioQueue(), 50);
          } else {
            processAudioQueue();
          }
        }
      } catch (error) {
        console.error("音声生成エラー:", error);
        // エラーの場合はキューから削除
        audioQueueRef.current = audioQueueRef.current.filter(item => item.id !== chunkId);
      }
    })();
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || isLoading) return;

    const userMessage: Message = { role: "user", content: inputText.trim() };
    setMessages(prev => [...prev, userMessage]);
    setInputText("");
    setIsLoading(true);
    
    // 状態をリセット
    chunkIdRef.current = 0;
    audioQueueRef.current = [];
    isProcessingQueueRef.current = false;
    setIsPlayingAudio(false);

    // アシスタントメッセージの初期化
    const assistantMessageIndex = messages.length + 1;
    setMessages(prev => [...prev, { role: "assistant", content: "" }]);

    let fullResponse = "";
    const processedSentences: string[] = [];
    let remainingText = "";

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [...messages, userMessage],
        }),
      });

      if (!response.ok) {
        throw new Error("チャット応答の取得に失敗しました");
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("ストリームリーダーの取得に失敗しました");
      }

      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullResponse += chunk;
        remainingText += chunk;

        // リアルタイムテキスト表示の更新
        setMessages(prev => {
          const newMessages = [...prev];
          newMessages[assistantMessageIndex] = {
            role: "assistant",
            content: fullResponse,
          };
          return newMessages;
        });

        // 句読点で分割して音声生成
        const splitResult = splitByPunctuation(remainingText);
        
        // 完成したチャンクを処理
        for (const chunk of splitResult.completed) {
          if (!processedSentences.includes(chunk)) {
            processedSentences.push(chunk);
            addToAudioQueue(chunk);
          }
        }
        
        // 残りのテキストを更新
        remainingText = splitResult.remaining;
      }

      // 最後に残ったテキストがあれば音声生成
      if (remainingText.trim() && remainingText.trim().length > 3) {
        const finalText = remainingText.trim();
        if (!processedSentences.includes(finalText)) {
          addToAudioQueue(finalText);
        }
      }

    } catch (error) {
      console.error("メッセージ送信に失敗しました:", error);
      alert("メッセージの送信に失敗しました");
    } finally {
      setIsLoading(false);
    }
  };

  const initApp = () => {
    if (!canvasContainerRef.current) return;

    const app = new Application({
      width: canvasContainerRef.current.clientWidth,
      height: canvasContainerRef.current.clientHeight,
      view: canvasContainerRef.current,
      background: 0xffffff,
    });

    setApp(app);
    initLive2D(app);
  };

  const initLive2D = async (currentApp: Application) => {
    if (!canvasContainerRef.current) return;

    try {
      const { Live2DModel } = await import(
        "pixi-live2d-display-lipsyncpatch/cubism4"
      );
      const model = await Live2DModel.from(
        "/live2d/Resources/Haru/Haru.model3.json",
        { ticker: Ticker.shared },
      );

      currentApp.stage.addChild(model as unknown as DisplayObject);

      model.anchor.set(0.5, 0.5);
      setModelPosition(currentApp, model);

      model.on("hit", (hitAreas) => {
        if (hitAreas.includes("Body")) {
          model.motion("Tap@Body");
        }
      });

      setModel(model);
    } catch (error) {
      console.error("Live2Dモデルの読み込みに失敗しました:", error);
    }
  };

  useEffect(() => {
    if (!app || !model) return;

    const onResize = () => {
      if (!canvasContainerRef.current) return;

      app.renderer.resize(
        canvasContainerRef.current.clientWidth,
        canvasContainerRef.current.clientHeight,
      );

      setModelPosition(app, model);
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [app, model]);

  useEffect(() => {
    initApp();
  }, []);

  return (
    <div className="flex h-screen">
      <div className="flex-1">
        <canvas ref={canvasContainerRef} className="w-full h-full" />
      </div>
      <div className="w-80 p-4 bg-gray-100 overflow-y-auto">
        <div className="space-y-6">
          <div>
            <h3 className="text-lg text-gray-700 font-semibold mb-2">チャット</h3>
            <div className="space-y-3">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="メッセージを入力してください"
                className="w-full h-24 p-3 border border-gray-300 text-gray-700 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
              />
              <button
                onClick={handleSendMessage}
                disabled={isLoading || !inputText.trim()}
                className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 transition-colors"
              >
                {isLoading ? "処理中..." : "送信"}
              </button>
            </div>
            {messages.length > 0 && (
              <div className="mt-4 max-h-48 overflow-y-auto bg-white p-3 rounded border">
                {messages.map((message, index) => (
                  <div key={index} className={`mb-2 ${message.role === 'user' ? 'text-right' : 'text-left'}`}>
                    <div className={`inline-block p-2 rounded text-sm max-w-xs ${
                      message.role === 'user' 
                        ? 'bg-blue-500 text-white' 
                        : 'bg-gray-200 text-gray-800'
                    }`}>
                      {message.content}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-2">モーション</h3>
            <div className="grid grid-cols-2 gap-2">
              {motions.map((motion, idx) => (
                <button
                  key={`${motion.group}-${motion.index}`}
                  onClick={() => playMotion(motion.group, motion.index)}
                  className="px-3 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                >
                  {motion.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-2">表情</h3>
            <div className="grid grid-cols-2 gap-2">
              {expressions.map((expression) => (
                <button
                  key={expression.file}
                  onClick={() => playExpression(expression.file)}
                  className="px-3 py-2 text-sm bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
                >
                  {expression.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-2">音声</h3>
            <div className="grid grid-cols-1 gap-2">
              {sounds.map((sound) => (
                <button
                  key={sound.file}
                  onClick={() => playSound(sound.file)}
                  className="px-3 py-2 text-sm bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors"
                >
                  {sound.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
