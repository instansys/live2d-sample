"use client";
import { Application, Ticker, DisplayObject } from "pixi.js";
import { useEffect, useRef, useState } from "react";
import { Live2DModel } from "pixi-live2d-display-lipsyncpatch/cubism4";
import RealtimeChat from "../components/RealtimeChat";

const setModelPosition = (app: Application, model: Live2DModel) => {
  const scale = (app.renderer.width * 1.6) / model.width;
  model.scale.set(scale);
  model.x = app.renderer.width / 2;
  model.y = app.renderer.height - model.height * scale * 0.1;
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

export default function Live2D() {
  const canvasContainerRef = useRef<HTMLCanvasElement>(null);
  const [app, setApp] = useState<Application | null>(null);
  const [model, setModel] = useState<Live2DModel | null>(null);
  const [conversationHistory, setConversationHistory] = useState<
    Array<{
      type: "user" | "assistant";
      content: string;
      timestamp: Date;
    }>
  >([]);

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

  // 転写テキストの処理
  const handleRealtimeTranscript = (transcript: string) => {
    // 重複を避けるため、最新のメッセージが同じでない場合のみ追加
    setConversationHistory((prev) => {
      const lastMessage = prev[prev.length - 1];
      if (
        lastMessage &&
        lastMessage.type === "user" &&
        lastMessage.content === transcript
      ) {
        return prev;
      }
      return [
        ...prev,
        {
          type: "user",
          content: transcript,
          timestamp: new Date(),
        },
      ];
    });
  };

  // レスポンステキストの処理
  const handleRealtimeResponse = (response: string) => {
    // 重複を避けるため、最新のメッセージが同じでない場合のみ追加
    setConversationHistory((prev) => {
      const lastMessage = prev[prev.length - 1];
      if (
        lastMessage &&
        lastMessage.type === "assistant" &&
        lastMessage.content === response
      ) {
        return prev;
      }
      return [
        ...prev,
        {
          type: "assistant",
          content: response,
          timestamp: new Date(),
        },
      ];
    });
  };

  // 履歴更新の処理
  const handleHistoryUpdate = (
    history: Array<{
      type: "user" | "assistant";
      content: string;
      timestamp: Date;
    }>
  ) => {
    setConversationHistory(history);
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
        { ticker: Ticker.shared }
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
        canvasContainerRef.current.clientHeight
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-screen">
      <div className="flex-1">
        <canvas ref={canvasContainerRef} className="w-full h-full" />
      </div>
      <div className="w-80 p-4 bg-gray-100 overflow-y-auto">
        <div className="space-y-6">
          <RealtimeChat
            onTranscript={handleRealtimeTranscript}
            onResponse={handleRealtimeResponse}
            conversationHistory={conversationHistory}
            onHistoryUpdate={handleHistoryUpdate}
            live2dModel={model}
          />

          <div>
            <h3 className="text-lg font-semibold mb-2">モーション</h3>
            <div className="grid grid-cols-2 gap-2">
              {motions.map((motion) => (
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
