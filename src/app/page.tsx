"use client";
import { Application, Ticker, DisplayObject } from "pixi.js";
import { useEffect, useRef, useState } from "react";
import { Live2DModel } from "pixi-live2d-display-lipsyncpatch/cubism4";

const setModelPosition = (app: Application, model: Live2DModel) => {
  const scale = (app.renderer.width * 0.4) / model.width;
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

  const handleSendMessage = async () => {
    if (!inputText.trim() || isLoading) return;

    const userMessage: Message = { role: "user", content: inputText.trim() };
    setMessages(prev => [...prev, userMessage]);
    setInputText("");
    setIsLoading(true);

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

      const data = await response.json();
      const assistantMessage: Message = { 
        role: "assistant", 
        content: data.message 
      };
      
      setMessages(prev => [...prev, assistantMessage]);

      // 応答を音声で再生
      if (model && data.audioUrl) {
        try {
          await model.speak(data.audioUrl);
        } catch (error) {
          console.error("音声再生に失敗しました:", error);
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
