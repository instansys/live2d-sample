"use client";

// Fork元の方を使う場合は import * as PIXI from 'pixi.js'; と呼び方、などなど変わるので、そちらのREADMEを参照して変えましょう
import { Application, Ticker, DisplayObject } from "pixi.js";
import { useEffect, useRef, useState } from "react";
import { Live2DModel } from "pixi-live2d-display-lipsyncpatch/cubism4";

const setModelPosition = (
  app: Application,
  model: Live2DModel
) => {
  const scale = (app.renderer.width * 0.4) / model.width;
  model.scale.set(scale);
  model.x = app.renderer.width / 2;
  model.y = app.renderer.height - model.height * scale * 0.3;
};

export default function Live2D() {
  const canvasContainerRef = useRef<HTMLCanvasElement>(null);
  const [app, setApp] = useState<Application | null>(null);
  const [model, setModel] = useState<Live2DModel | null>(null);

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
      const { Live2DModel } = await import("pixi-live2d-display-lipsyncpatch/cubism4");
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
      console.error("Failed to load Live2D model:", error);
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
  }, []);

  return <canvas ref={canvasContainerRef} className="w-full h-full" />;
}
