import type { Live2DModel } from "pixi-live2d-display-lipsyncpatch/cubism4";

/**
 * WebRTCのリモート MediaStream からリップシンクのみ接続する。
 * model.speak は使わず、再生は audioEl に任せる。
 */
export function wireLipsyncFromMediaStream(
  model: Live2DModel,
  remoteStream: MediaStream
) {
  try {
    // 再生用の <audio> を自前で作る
    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    audioEl.srcObject = remoteStream;
    audioEl.muted = false; // 音声を再生する

    // Web Audio 解析チェーン
    const audioCtx = new AudioContext();
    const streamSource = audioCtx.createMediaStreamSource(remoteStream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -10;
    analyser.smoothingTimeConstant = 0.85;

    // 解析だけしたいので destination には繋がない（音は <audio> 側が出す）
    streamSource.connect(analyser);

    // ライブラリの内部更新条件を満たすため currentXxx を直接差し込む
    const mm = model.internalModel.motionManager as {
      currentAudio?: HTMLAudioElement;
      currentContext?: AudioContext;
      currentAnalyzer?: AnalyserNode;
    };
    model.internalModel.lipSync = true;
    mm.currentAudio = audioEl; // これが truthy だと内部で mouthSync() が動く
    mm.currentContext = audioCtx;
    mm.currentAnalyzer = analyser;

    console.log("MediaStream lipsync configured");

    // ブラウザの自動再生制限対応
    const resume = async () => {
      try {
        await audioCtx.resume();
      } catch (e) {
        console.warn("AudioContext resume failed:", e);
      }
      try {
        await audioEl.play();
      } catch (e) {
        console.warn("Audio play failed:", e);
      }
    };

    // 解除関数
    const dispose = () => {
      try {
        audioEl.pause();
      } catch {}
      audioEl.srcObject = null;
      mm.currentAnalyzer = undefined;
      mm.currentContext = undefined;
      mm.currentAudio = undefined;
      try {
        audioCtx.close();
      } catch {}
      console.log("MediaStream lipsync disposed");
    };

    return { audioEl, audioCtx, analyser, resume, dispose };
  } catch (error) {
    console.error("Failed to setup MediaStream lipsync:", error);
    throw error;
  }
}

/**
 * 既存の <audio> 要素に Web Audio を接続してリップシンクを設定
 */
export function wireLipsyncFromAudioElement(
  model: Live2DModel,
  audioEl: HTMLAudioElement
) {
  try {
    const mm = model.internalModel.motionManager as {
      currentAudio?: HTMLAudioElement;
      currentContext?: AudioContext;
      currentAnalyzer?: AnalyserNode;
    };
    model.internalModel.lipSync = true;

    // 既存 <audio> に紐づく AudioContext/Analyser を生成（MediaElementSource）
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(audioEl);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -10;
    analyser.smoothingTimeConstant = 0.85;

    source.connect(analyser);
    source.connect(ctx.destination);

    mm.currentAudio = audioEl;
    mm.currentContext = ctx;
    mm.currentAnalyzer = analyser;

    console.log("AudioElement lipsync configured");

    const resume = async () => {
      try {
        await ctx.resume();
      } catch (e) {
        console.warn("AudioContext resume failed:", e);
      }
      try {
        await audioEl.play();
      } catch (e) {
        console.warn("Audio play failed:", e);
      }
    };

    const dispose = () => {
      mm.currentAnalyzer = undefined;
      mm.currentContext = undefined;
      mm.currentAudio = undefined;
      try {
        source.disconnect();
      } catch {}
      try {
        ctx.close();
      } catch {}
      console.log("AudioElement lipsync disposed");
    };

    return { analyser, resume, dispose };
  } catch (error) {
    console.error("Failed to setup AudioElement lipsync:", error);
    throw error;
  }
}

/**
 * ブラウザの実際の音声出力を監視してリップシンクを行う
 */
export function setupAudioBasedLipsync(model: Live2DModel, session?: unknown) {
  try {
    console.log("[LIPSYNC] Setting up audio-based lipsync...");

    const mm = model.internalModel.motionManager as {
      currentAudio?: HTMLAudioElement;
      currentContext?: AudioContext;
      currentAnalyzer?: AnalyserNode;
    };
    model.internalModel.lipSync = true;

    // ダミーのオーディオ要素
    const dummyAudio = document.createElement("audio");
    dummyAudio.muted = true;

    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -10;
    analyser.smoothingTimeConstant = 0.85;

    mm.currentAudio = dummyAudio;
    mm.currentContext = audioCtx;
    mm.currentAnalyzer = analyser;

    let animationId: number | null = null;
    let isMonitoring = false;

    // システムの音声出力をキャプチャする関数
    const setupAudioCapture = async () => {
      try {
        console.log("[LIPSYNC] Attempting system audio capture...");

        // 方法1: getDisplayMedia で画面キャプチャ（音声付き）を試行
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: false,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            sampleRate: 44100,
          },
        });

        console.log(
          "[LIPSYNC] System audio capture started via getDisplayMedia"
        );

        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        // destination には接続しない（再生はしない、解析のみ）

        return {
          stream,
          source,
          dispose: () => {
            source.disconnect();
            stream.getTracks().forEach((track) => track.stop());
          },
        };
      } catch (e) {
        console.warn("[LIPSYNC] getDisplayMedia failed:", e);

        // 方法2: ユーザーメディア（マイク）経由でテスト
        try {
          console.log("[LIPSYNC] Attempting microphone access for testing...");
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          });

          console.log("[LIPSYNC] Microphone access successful (for testing)");

          const source = audioCtx.createMediaStreamSource(micStream);
          source.connect(analyser);

          // 注意：これはマイクからの音声なので、実際の出力音声ではない
          // デバッグ用として一時的に使用

          return {
            stream: micStream,
            source,
            dispose: () => {
              source.disconnect();
              micStream.getTracks().forEach((track) => track.stop());
            },
          };
        } catch (micError) {
          console.warn("[LIPSYNC] Microphone access also failed:", micError);
          return null;
        }
      }
    };

    // ページ内のaudio要素を監視する方法（動的生成対応・改善版）
    const setupPageAudioMonitoring = () => {
      const audioElements = document.querySelectorAll("audio");
      console.log("[LIPSYNC] Found audio elements:", audioElements.length);

      // 既存のaudio要素を詳しくチェック
      for (const audioEl of audioElements) {
        try {
          if (audioEl instanceof HTMLAudioElement) {
            console.log("[LIPSYNC] Audio element details:", {
              src: audioEl.src || "no src",
              srcObject: audioEl.srcObject ? "has srcObject" : "no srcObject",
              readyState: audioEl.readyState,
              paused: audioEl.paused,
              muted: audioEl.muted,
              volume: audioEl.volume,
              id: audioEl.id || "no id",
              className: audioEl.className || "no class",
            });

            // srcObjectがあるaudio要素（WebRTC音声など）を優先
            if (audioEl.srcObject || audioEl.src || !audioEl.paused) {
              const source = audioCtx.createMediaElementSource(audioEl);
              source.connect(analyser);
              source.connect(audioCtx.destination); // 音声も出力

              console.log("[LIPSYNC] Connected to page audio element");
              return {
                element: audioEl,
                source,
                dispose: () => {
                  try {
                    source.disconnect();
                  } catch (e) {
                    console.warn("Failed to disconnect audio source:", e);
                  }
                },
              };
            }
          }
        } catch (e) {
          console.warn("[LIPSYNC] Failed to connect to audio element:", e);
          // 次の要素を試す
          continue;
        }
      }

      let connectedSource: MediaElementAudioSourceNode | null = null;
      let connectedElement: HTMLAudioElement | null = null;

      // MutationObserverで新しいaudio要素を監視（強化版）
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            // 直接のaudio要素
            if (node instanceof HTMLAudioElement) {
              console.log("[LIPSYNC] New audio element detected:", {
                src: node.src || "no src",
                srcObject: node.srcObject ? "has srcObject" : "no srcObject",
                autoplay: node.autoplay,
                muted: node.muted,
                volume: node.volume,
                id: node.id || "no id",
                className: node.className || "no class",
                style: node.style.cssText || "no inline style",
              });

              // 既に接続済みでない場合のみ接続
              if (!connectedSource) {
                try {
                  const source = audioCtx.createMediaElementSource(node);
                  source.connect(analyser);
                  source.connect(audioCtx.destination);

                  connectedSource = source;
                  connectedElement = node;

                  console.log(
                    "[LIPSYNC] Connected to dynamically created audio element"
                  );

                  // audio要素のイベントも監視
                  const onPlay = () => {
                    console.log("[LIPSYNC] Audio element started playing");
                    isMonitoring = true;
                    if (animationId === null) {
                      animationId = requestAnimationFrame(analyzeAudio);
                    }
                  };

                  const onLoadStart = () => {
                    console.log("[LIPSYNC] Audio element load started");
                  };

                  const onCanPlay = () => {
                    console.log("[LIPSYNC] Audio element can play");
                  };

                  const onPause = () => {
                    console.log("[LIPSYNC] Audio element paused");
                  };

                  const onVolumeChange = () => {
                    console.log(
                      "[LIPSYNC] Audio element volume changed:",
                      node.volume,
                      node.muted
                    );
                  };

                  node.addEventListener("play", onPlay);
                  node.addEventListener("pause", onPause);
                  node.addEventListener("ended", onPause);
                  node.addEventListener("loadstart", onLoadStart);
                  node.addEventListener("canplay", onCanPlay);
                  node.addEventListener("volumechange", onVolumeChange);
                } catch (e) {
                  console.warn(
                    "[LIPSYNC] Failed to connect to dynamic audio element:",
                    e
                  );
                }
              }
            }

            // 子要素にaudio要素がある場合もチェック
            if (node instanceof Element) {
              const childAudioElements = node.querySelectorAll("audio");
              if (childAudioElements.length > 0) {
                console.log(
                  "[LIPSYNC] Found audio elements in added node:",
                  childAudioElements.length
                );

                childAudioElements.forEach((childAudio) => {
                  if (
                    childAudio instanceof HTMLAudioElement &&
                    !connectedSource
                  ) {
                    console.log(
                      "[LIPSYNC] Attempting to connect to child audio element"
                    );
                    try {
                      const source =
                        audioCtx.createMediaElementSource(childAudio);
                      source.connect(analyser);
                      source.connect(audioCtx.destination);

                      connectedSource = source;
                      connectedElement = childAudio;

                      console.log("[LIPSYNC] Connected to child audio element");
                    } catch (e) {
                      console.warn(
                        "[LIPSYNC] Failed to connect to child audio element:",
                        e
                      );
                    }
                  }
                });
              }
            }
          });
        });
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true, // src属性の変更も監視
        attributeFilter: ["src", "srcobject"],
      });

      console.log(
        "[LIPSYNC] Started enhanced MutationObserver for audio elements"
      );

      return {
        observer,
        dispose: () => {
          observer.disconnect();
          if (connectedSource) {
            try {
              connectedSource.disconnect();
            } catch (e) {
              console.warn(
                "Failed to disconnect MutationObserver audio source:",
                e
              );
            }
          }
          console.log("[LIPSYNC] Audio element observer disposed");
        },
      };
    };

    // リアルタイム音声解析とリップシンク
    const analyzeAudio = () => {
      if (!isMonitoring || !analyser) {
        if (animationId !== null) {
          animationId = requestAnimationFrame(analyzeAudio);
        }
        return;
      }

      try {
        // ライブラリと同じ方法で音声解析
        const pcmData = new Float32Array(analyser.fftSize);
        let sumSquares = 0;
        analyser.getFloatTimeDomainData(pcmData);

        for (const amplitude of pcmData) {
          sumSquares += amplitude * amplitude;
        }

        // ライブラリと同じRMS計算
        const rms = Math.sqrt((sumSquares / pcmData.length) * 20);
        const clampedRms = Math.max(0, Math.min(10, rms)); // 異常値を制限

        // 音声の閾値を設定（静寂判定）
        const silenceThreshold = 0.01; // この値以下は静寂とみなす

        if (clampedRms < silenceThreshold) {
          // 静寂時は口を閉じる
          const paramIndex =
            model.internalModel.coreModel.getParameterIndex("ParamMouthOpenY");
          if (paramIndex >= 0) {
            model.internalModel.coreModel.setParameterValueByIndex(
              paramIndex,
              0
            );
          }
          return; // 処理を終了
        }

        // ライブラリと同じパラメータ変換（調整版）
        let value = clampedRms;
        let min_ = 0;
        const max_ = 0.8; // 最大値を0.8に制限（元々は1.0）
        const weight = 0.6; // 重みを0.6に減少（元々は1.2）

        if (value > 0) {
          min_ = 0.2; // 最小値を0.2に減少（元々は0.4）
        }

        value = Math.max(min_, Math.min(max_, value * weight));

        // パラメータ適用
        const paramIndex =
          model.internalModel.coreModel.getParameterIndex("ParamMouthOpenY");
        if (paramIndex >= 0) {
          model.internalModel.coreModel.setParameterValueByIndex(
            paramIndex,
            value
          );
        }

        // デバッグログ（実際の音声検知時のみ）
        if (rms > silenceThreshold) {
          console.log(
            `[LIPSYNC] Real audio detected - RMS: ${rms.toFixed(
              3
            )}, Mouth: ${value.toFixed(3)}`
          );
        }
      } catch (e) {
        console.warn("[LIPSYNC] Audio analysis error:", e);
      }

      if (animationId !== null) {
        animationId = requestAnimationFrame(analyzeAudio);
      }
    };

    let audioCapture: any = null;

    // WebRTC音声ストリームを探す方法（改善版）
    const setupWebRTCAudioMonitoring = () => {
      console.log("[LIPSYNC] Searching for WebRTC audio streams...");

      const potentialConnections = [];

      // 1. セッションオブジェクトから詳細探索
      if (session) {
        console.log("[LIPSYNC] Deep scanning session object...");
        const sessionObj = session as any;

        // セッションの基本構造をログ出力
        console.log("[LIPSYNC] Session keys:", Object.keys(sessionObj));
        console.log(
          "[LIPSYNC] Session constructor:",
          sessionObj.constructor?.name
        );

        // プロトタイプチェーンも確認
        let proto = Object.getPrototypeOf(sessionObj);
        let level = 0;
        while (proto && level < 3) {
          console.log(
            `[LIPSYNC] Prototype level ${level}:`,
            Object.getOwnPropertyNames(proto)
          );
          proto = Object.getPrototypeOf(proto);
          level++;
        }

        // 内部の重要そうなプロパティをチェック
        const importantKeys = [
          "transport",
          "connection",
          "client",
          "ws",
          "webSocket",
          "_transport",
          "_connection",
          "peerConnection",
          "pc",
          "rtc",
          "audio",
          "media",
          "stream",
          "_pc",
          "_peerConnection",
          "_webrtc",
          "rtcPeerConnection",
          "webRtcConnection",
          "_session",
          "session",
        ];

        importantKeys.forEach((key) => {
          if (sessionObj[key] !== undefined) {
            console.log(
              `[LIPSYNC] Found session.${key}:`,
              typeof sessionObj[key],
              sessionObj[key]
            );
          }
        });

        // transport オブジェクトを詳細に調査
        if (sessionObj.transport) {
          console.log("[LIPSYNC] Investigating transport object...");
          const transport = sessionObj.transport;
          console.log("[LIPSYNC] Transport keys:", Object.keys(transport));
          console.log(
            "[LIPSYNC] Transport constructor:",
            transport.constructor?.name
          );

          // transport のプロパティをすべてチェック
          Object.keys(transport).forEach((key) => {
            const value = transport[key];
            console.log(`[LIPSYNC] transport.${key}:`, typeof value, value);

            // RTCPeerConnection を探す
            if (value instanceof RTCPeerConnection) {
              console.log(
                `[LIPSYNC] Found RTCPeerConnection at transport.${key}!`,
                value
              );
              potentialConnections.push(value);
            }
          });

          // プロトタイプレベルのプロパティも実際に取得してみる
          const prototypeProps = [
            "callId",
            "status",
            "connectionState",
            "muted",
          ];
          prototypeProps.forEach((prop) => {
            if (prop in transport) {
              try {
                const value = transport[prop];
                console.log(
                  `[LIPSYNC] transport.${prop} (from prototype):`,
                  typeof value,
                  value
                );

                // connectionStateからRTCPeerConnectionを取得！
                if (
                  prop === "connectionState" &&
                  value &&
                  value.peerConnection instanceof RTCPeerConnection
                ) {
                  console.log(
                    "[LIPSYNC] Found RTCPeerConnection in connectionState!",
                    value.peerConnection
                  );
                  potentialConnections.push(value.peerConnection);
                }
              } catch (e) {
                console.warn(
                  `[LIPSYNC] Failed to access transport.${prop}:`,
                  e
                );
              }
            }
          });

          // transport のプロトタイプも調査
          let transportProto = Object.getPrototypeOf(transport);
          let level = 0;
          while (transportProto && level < 2) {
            console.log(
              `[LIPSYNC] Transport prototype level ${level}:`,
              Object.getOwnPropertyNames(transportProto)
            );
            level++;
            transportProto = Object.getPrototypeOf(transportProto);
          }

          // transport 内を再帰的に探索
          const transportConnections = findRTCConnectionsInObject(
            transport,
            new Set(),
            4
          );
          if (transportConnections.length > 0) {
            console.log(
              "[LIPSYNC] Found RTC connections in transport:",
              transportConnections.length
            );
            potentialConnections.push(...transportConnections);
          }

          // プライベートプロパティとシンボルも探索
          const allProps = [
            ...Object.getOwnPropertyNames(transport),
            ...Object.getOwnPropertySymbols(transport),
          ];
          console.log(
            "[LIPSYNC] All transport properties (including symbols):",
            allProps.length
          );

          allProps.forEach((prop) => {
            try {
              const value = transport[prop];
              if (value && typeof value === "object") {
                const propName =
                  typeof prop === "symbol" ? prop.toString() : prop;
                console.log(
                  `[LIPSYNC] Checking transport[${propName}]:`,
                  typeof value,
                  value?.constructor?.name
                );

                if (value instanceof RTCPeerConnection) {
                  console.log(
                    `[LIPSYNC] Found RTCPeerConnection in property ${propName}!`,
                    value
                  );
                  potentialConnections.push(value);
                }
              }
            } catch (e) {
              // アクセスできないプロパティをスキップ
            }
          });
        }

        const sessionConnections = findRTCConnectionsInObject(
          session,
          new Set(),
          5
        ); // より深く探索
        potentialConnections.push(...sessionConnections);

        // セッション内のネストしたオブジェクトも調べる
        const keysToCheck = [
          "transport",
          "connection",
          "client",
          "ws",
          "webSocket",
          "_transport",
          "_connection",
        ];
        keysToCheck.forEach((key) => {
          if (sessionObj[key]) {
            const nestedConnections = findRTCConnectionsInObject(
              sessionObj[key],
              new Set(),
              3
            );
            potentialConnections.push(...nestedConnections);
          }
        });
      }

      // 2. グローバル変数から探す（拡張版）
      const globalConnections = [
        (window as any).peerConnection,
        (window as any).pc,
        (window as any).rtcConnection,
        (window as any).webrtc,
        (window as any).openai,
        (window as any).realtimeSession,
      ].filter(Boolean);
      potentialConnections.push(...globalConnections);

      // WebSocket接続も確認（OpenAI Realtime APIがWebSocketを使用している可能性）
      if (session) {
        const sessionObj = session as any;
        console.log("[LIPSYNC] Checking for WebSocket connections...");

        // WebSocket関連のプロパティを探す
        const wsKeys = [
          "ws",
          "webSocket",
          "websocket",
          "_ws",
          "_webSocket",
          "socket",
          "connection",
        ];
        wsKeys.forEach((key) => {
          if (sessionObj[key] && sessionObj[key] instanceof WebSocket) {
            console.log(
              `[LIPSYNC] Found WebSocket at session.${key}:`,
              sessionObj[key]
            );
            console.log(
              "[LIPSYNC] WebSocket state:",
              sessionObj[key].readyState
            );
            console.log(
              "[LIPSYNC] WebSocket protocol:",
              sessionObj[key].protocol
            );
          }
        });
      }

      // 3. WebRTC統計APIを使用してアクティブな接続を検出
      console.log(
        "[LIPSYNC] Attempting to find WebRTC connections via global detection..."
      );

      // RTCPeerConnectionのコンストラクタをモンキーパッチして既存の接続をキャッチする試行
      if ((window as any).__webrtc_connections) {
        console.log(
          "[LIPSYNC] Found cached WebRTC connections:",
          (window as any).__webrtc_connections.length
        );
        potentialConnections.push(...(window as any).__webrtc_connections);
      }

      // より直接的なアプローチ：既知のWebRTC接続を探す
      const possibleGlobalRefs = [
        "webkitRTCPeerConnection",
        "mozRTCPeerConnection",
        "RTCPeerConnection",
      ];

      possibleGlobalRefs.forEach((ref) => {
        if ((window as any)[ref] && (window as any)[ref].prototype) {
          console.log(`[LIPSYNC] Found WebRTC constructor: ${ref}`);
        }
      });

      // 現在のページでアクティブなMediaStreamを検出
      console.log("[LIPSYNC] Checking for active MediaStreams...");

      // getUserMediaで作成されたストリームを探す
      try {
        navigator.mediaDevices
          .enumerateDevices()
          .then((devices) => {
            console.log("[LIPSYNC] Available media devices:", devices.length);
          })
          .catch((e) => {
            console.warn("[LIPSYNC] Failed to enumerate devices:", e);
          });
      } catch (e) {
        console.warn("[LIPSYNC] Failed to access media devices:", e);
      }

      console.log(
        "[LIPSYNC] Found potential RTC connections:",
        potentialConnections.length
      );

      // 各接続を詳しく調べる
      for (const pc of potentialConnections) {
        if (pc instanceof RTCPeerConnection) {
          console.log(
            "[LIPSYNC] Examining RTC connection:",
            pc.connectionState,
            pc.iceConnectionState
          );

          const receivers = pc.getReceivers();
          const audioReceivers = receivers.filter(
            (r) => r.track?.kind === "audio"
          );

          console.log(
            "[LIPSYNC] RTC connection has audio receivers:",
            audioReceivers.length
          );

          // 全てのaudioReceiverをログ出力
          audioReceivers.forEach((receiver, index) => {
            const track = receiver.track;
            if (track) {
              console.log(`[LIPSYNC] Audio receiver ${index}:`, {
                kind: track.kind,
                id: track.id,
                readyState: track.readyState,
                enabled: track.enabled,
                muted: track.muted,
              });
            }
          });

          // 生きているトラックを優先、なければ最初のトラックを使用
          const liveReceivers = audioReceivers.filter(
            (r) => r.track?.readyState === "live"
          );
          const targetReceivers =
            liveReceivers.length > 0 ? liveReceivers : audioReceivers;

          if (targetReceivers.length > 0) {
            const track = targetReceivers[0].track;
            if (track) {
              try {
                const stream = new MediaStream([track]);
                const source = audioCtx.createMediaStreamSource(stream);
                source.connect(analyser);

                console.log(
                  "[LIPSYNC] Connected to WebRTC audio stream (track state:",
                  track.readyState,
                  ")"
                );

                return {
                  connection: pc,
                  track,
                  source,
                  dispose: () => {
                    try {
                      source.disconnect();
                    } catch (e) {
                      console.warn("Failed to disconnect WebRTC source:", e);
                    }
                  },
                };
              } catch (e) {
                console.warn("[LIPSYNC] Failed to connect to WebRTC audio:", e);
              }
            }
          }

          // trackイベントも監視（改善版）
          const onTrack = (event: RTCTrackEvent) => {
            console.log("[LIPSYNC] RTCTrackEvent:", {
              kind: event.track.kind,
              id: event.track.id,
              readyState: event.track.readyState,
              streamsCount: event.streams.length,
            });

            if (event.track.kind === "audio") {
              console.log("[LIPSYNC] New WebRTC audio track detected");

              try {
                const stream =
                  event.streams[0] || new MediaStream([event.track]);
                const source = audioCtx.createMediaStreamSource(stream);
                source.connect(analyser);

                console.log("[LIPSYNC] Connected to new WebRTC audio track");
                isMonitoring = true;

                // 解析ループを再開
                if (animationId === null) {
                  animationId = requestAnimationFrame(analyzeAudio);
                }
              } catch (e) {
                console.warn(
                  "[LIPSYNC] Failed to connect to new WebRTC track:",
                  e
                );
              }
            }
          };

          pc.addEventListener("track", onTrack);

          return {
            connection: pc,
            onTrack,
            dispose: () => {
              pc.removeEventListener("track", onTrack);
              console.log("[LIPSYNC] WebRTC track listener removed");
            },
          };
        }
      }

      return null;
    };

    // オブジェクト内のRTCPeerConnectionを再帰的に探す
    const findRTCConnectionsInObject = (
      obj: any,
      visited = new Set(),
      maxDepth = 3
    ): RTCPeerConnection[] => {
      if (
        maxDepth <= 0 ||
        !obj ||
        typeof obj !== "object" ||
        visited.has(obj)
      ) {
        return [];
      }

      visited.add(obj);
      const connections: RTCPeerConnection[] = [];

      if (obj instanceof RTCPeerConnection) {
        connections.push(obj);
      }

      for (const key of Object.keys(obj)) {
        try {
          const value = obj[key];
          if (value && typeof value === "object") {
            connections.push(
              ...findRTCConnectionsInObject(value, visited, maxDepth - 1)
            );
          }
        } catch (e) {
          // アクセスできないプロパティをスキップ
        }
      }

      return connections;
    };

    // 最終手段：Web Audio APIをハイジャックして全音声出力をキャプチャ
    const setupAudioContextHijacking = () => {
      console.log("[LIPSYNC] Attempting AudioContext hijacking...");

      try {
        // すべてのAudioContextインスタンスを探す
        const contexts: AudioContext[] = [];

        // グローバルオブジェクトから探す
        if ((window as any).audioContext) {
          contexts.push((window as any).audioContext);
        }

        // AudioContextの作成をモニター（将来のインスタンス用）
        const originalAudioContext = window.AudioContext;
        const originalWebkitAudioContext = (window as any).webkitAudioContext;

        const wrapAudioContext = (OriginalContext: any) => {
          return class extends OriginalContext {
            constructor(...args: any[]) {
              super(...args);
              console.log(
                "[LIPSYNC] New AudioContext created, attempting to hijack..."
              );
              contexts.push(this);

              // destination に接続されるすべての音声をキャプチャ
              try {
                const originalConnect = this.destination.connect;
                this.destination.connect = function (...args: any[]) {
                  console.log(
                    "[LIPSYNC] AudioContext destination connect called"
                  );
                  return originalConnect.apply(this, args);
                };
              } catch (e) {
                console.warn(
                  "[LIPSYNC] Failed to wrap destination.connect:",
                  e
                );
              }
            }
          };
        };

        if (originalAudioContext) {
          (window as any).AudioContext = wrapAudioContext(originalAudioContext);
        }
        if (originalWebkitAudioContext) {
          (window as any).webkitAudioContext = wrapAudioContext(
            originalWebkitAudioContext
          );
        }

        console.log(
          "[LIPSYNC] AudioContext hijacking set up, found contexts:",
          contexts.length
        );

        return {
          contexts,
          dispose: () => {
            // 元に戻す
            if (originalAudioContext) {
              (window as any).AudioContext = originalAudioContext;
            }
            if (originalWebkitAudioContext) {
              (window as any).webkitAudioContext = originalWebkitAudioContext;
            }
          },
        };
      } catch (e) {
        console.warn("[LIPSYNC] AudioContext hijacking failed:", e);
        return null;
      }
    };

    const startMonitoring = async () => {
      if (isMonitoring) return;

      console.log("[LIPSYNC] Starting audio monitoring...");
      isMonitoring = true;

      // 1. WebRTC音声ストリームを探す
      audioCapture = setupWebRTCAudioMonitoring();

      // 2. システム音声キャプチャを試行
      if (!audioCapture) {
        audioCapture = await setupAudioCapture();
      }

      // 3. ページ内audio要素監視をフォールバック
      if (!audioCapture) {
        audioCapture = setupPageAudioMonitoring();
      }

      // 4. AudioContextハイジャッキングを試行
      if (!audioCapture) {
        const hijackResult = setupAudioContextHijacking();
        if (hijackResult) {
          audioCapture = hijackResult;
        }
      }

      // 5. 解析ループ開始（audio sourceが見つからなくても開始）
      animationId = requestAnimationFrame(analyzeAudio);

      if (audioCapture) {
        console.log(
          "[LIPSYNC] Audio monitoring started successfully with method:",
          audioCapture.connection
            ? "WebRTC"
            : audioCapture.stream
            ? "System"
            : audioCapture.element
            ? "AudioElement"
            : audioCapture.observer
            ? "Observer"
            : audioCapture.contexts
            ? "AudioContext Hijack"
            : "Unknown"
        );
      } else {
        console.log(
          "[LIPSYNC] No immediate audio source found, continuing to monitor for new sources..."
        );
        // isMonitoringをfalseにしない - observer が動作中の可能性がある
      }

      // 定期的にWebRTCコネクションを再チェック（5秒間隔）
      const recheckInterval = setInterval(() => {
        if (!audioCapture?.connection && !audioCapture?.element) {
          console.log("[LIPSYNC] Rechecking for WebRTC connections...");
          const newAudioCapture = setupWebRTCAudioMonitoring();
          if (newAudioCapture) {
            console.log("[LIPSYNC] Found new WebRTC connection during recheck");
            if (audioCapture?.dispose) {
              audioCapture.dispose();
            }
            audioCapture = newAudioCapture;
            clearInterval(recheckInterval);
          }
        } else {
          clearInterval(recheckInterval);
        }
      }, 5000);

      // 30秒後にintervalをクリア
      setTimeout(() => {
        clearInterval(recheckInterval);
      }, 30000);
    };

    const stopMonitoring = () => {
      console.log("[LIPSYNC] Stopping audio monitoring...");
      isMonitoring = false;

      if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }

      if (audioCapture?.dispose) {
        audioCapture.dispose();
        audioCapture = null;
      }

      // 口を閉じる
      try {
        const paramIndex =
          model.internalModel.coreModel.getParameterIndex("ParamMouthOpenY");
        if (paramIndex >= 0) {
          model.internalModel.coreModel.setParameterValueByIndex(paramIndex, 0);
        }
      } catch (e) {
        console.warn("[LIPSYNC] Failed to close mouth:", e);
      }
    };

    const resume = async () => {
      try {
        await audioCtx.resume();
        await startMonitoring();
        console.log("[LIPSYNC] Audio-based lipsync resumed");
      } catch (e) {
        console.warn("[LIPSYNC] Failed to resume audio-based lipsync:", e);
      }
    };

    const dispose = () => {
      stopMonitoring();

      mm.currentAnalyzer = undefined;
      mm.currentContext = undefined;
      mm.currentAudio = undefined;

      try {
        audioCtx.close();
      } catch {}
      console.log("[LIPSYNC] Audio-based lipsync disposed");
    };

    // 手動トリガー機能（フォールバック機能付き）
    const triggerSpeaking = () => {
      console.log(
        "[LIPSYNC] Manual trigger for audio-based lipsync (starting monitoring)"
      );
      startMonitoring();

      // 5秒後に音声ソースが見つからない場合、テキストベースリップシンクにフォールバック
      setTimeout(() => {
        if (
          !audioCapture?.connection &&
          !audioCapture?.element &&
          !audioCapture?.stream
        ) {
          console.log(
            "[LIPSYNC] No audio source found after 5 seconds, falling back to text-based lipsync"
          );

          // シンプルなテキストベースリップシンクを実行
          const startTextBasedSync = () => {
            let duration = 3000; // 3秒間
            let startTime = Date.now();

            const animateFromText = () => {
              const elapsed = Date.now() - startTime;
              const progress = elapsed / duration;

              if (progress < 1) {
                // 自然な口の動きをシミュレート
                const intensity = Math.sin(elapsed * 0.01) * 0.3 + 0.2;
                const variation = Math.sin(elapsed * 0.03) * 0.2;
                const mouthValue = Math.max(
                  0,
                  Math.min(1, intensity + variation)
                );

                try {
                  const paramIndex =
                    model.internalModel.coreModel.getParameterIndex(
                      "ParamMouthOpenY"
                    );
                  if (paramIndex >= 0) {
                    model.internalModel.coreModel.setParameterValueByIndex(
                      paramIndex,
                      mouthValue
                    );
                  }
                } catch (e) {
                  console.warn(
                    "[LIPSYNC] Failed to set mouth parameter in fallback:",
                    e
                  );
                }

                requestAnimationFrame(animateFromText);
              } else {
                // 終了時に口を閉じる
                try {
                  const paramIndex =
                    model.internalModel.coreModel.getParameterIndex(
                      "ParamMouthOpenY"
                    );
                  if (paramIndex >= 0) {
                    model.internalModel.coreModel.setParameterValueByIndex(
                      paramIndex,
                      0
                    );
                  }
                } catch (e) {
                  console.warn(
                    "[LIPSYNC] Failed to close mouth in fallback:",
                    e
                  );
                }
              }
            };

            animateFromText();
          };

          startTextBasedSync();
        }
      }, 5000);
    };

    return { type: "audioBased", resume, dispose, triggerSpeaking };
  } catch (error) {
    console.error("[LIPSYNC] Failed to setup audio-based lipsync:", error);
    throw error;
  }
}

/**
 * テキストレスポンスタイミングでのシンプルリップシンク（フォールバック用）
 */
export function setupTextBasedLipsync(model: Live2DModel, session: unknown) {
  try {
    console.log("[LIPSYNC] Setting up text-based lipsync...");

    const mm = model.internalModel.motionManager as {
      currentAudio?: HTMLAudioElement;
      currentContext?: AudioContext;
      currentAnalyzer?: AnalyserNode;
    };
    model.internalModel.lipSync = true;

    // ダミーのオーディオ要素
    const dummyAudio = document.createElement("audio");
    dummyAudio.muted = true;

    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();

    mm.currentAudio = dummyAudio;
    mm.currentContext = audioCtx;
    mm.currentAnalyzer = analyser;

    let animationId: number | null = null;
    let isSpeaking = false;
    let speakingStartTime = 0;
    let logCounter = 0;

    // ライブラリの実装を参考にした自然な口の動き
    let baseAmplitude = 0;
    let targetAmplitude = 0;
    let currentAmplitude = 0;
    let speechPhase = 0; // 音声の位相

    // ライブラリの実装を正確に再現したRMS計算
    const simulateAudioAnalysis = (
      elapsed: number,
      duration: number
    ): number => {
      // 時間経過に基づく強度計算
      const progress = elapsed / duration;
      const intensity = Math.max(0, 1 - progress * 0.8); // 徐々に減衰

      // 実際の音声波形に近いパターン（振幅を小さくして現実的に）
      const time = elapsed * 0.001; // ミリ秒を秒に変換
      const wave1 = Math.sin(time * 8) * 0.15; // 低い周波数
      const wave2 = Math.sin(time * 15) * 0.08; // 中間周波数
      const wave3 = Math.sin(time * 30) * 0.05; // 高い周波数
      const noise = (Math.random() - 0.5) * 0.02; // 微小なノイズ

      // 音声の振幅を現実的な範囲に（-0.3 〜 0.3程度）
      const amplitude = (wave1 + wave2 + wave3 + noise) * intensity;

      // ライブラリのRMS計算を正確に再現
      // Float32Array(256)をシミュレート
      const fftSize = 256;
      let sumSquares = 0;

      // 256個のサンプルをシミュレート（実際の音声波形に近づける）
      for (let i = 0; i < fftSize; i++) {
        // 各サンプルの振幅（-1 〜 1の範囲）
        const sampleAmplitude = amplitude * (1 + Math.sin(i * 0.1) * 0.3);
        sumSquares += sampleAmplitude * sampleAmplitude;
      }

      // ライブラリと同じ計算: sqrt(sumSquares / length * 20)
      const rms = Math.sqrt((sumSquares / fftSize) * 20);

      // ライブラリと同じ精度処理
      const result = isNaN(rms) ? 0 : rms;
      return parseFloat(result.toFixed(1)); // ライブラリは小数点1桁
    };

    // 使用しないapplyMouthParameter関数を削除し、直接設定方式に統一

    const animateMouth = () => {
      if (isSpeaking) {
        const elapsed = Date.now() - speakingStartTime;
        const duration = 4000; // 4秒間に延長してより自然に

        if (elapsed < duration) {
          try {
            // パラメータを毎フレームリセット（ライブラリの動作を模倣）
            const paramIndex =
              model.internalModel.coreModel.getParameterIndex(
                "ParamMouthOpenY"
              );
            if (paramIndex >= 0) {
              // まずパラメータを0にリセット
              model.internalModel.coreModel.setParameterValueByIndex(
                paramIndex,
                0
              );

              // ライブラリの実装を模倣した音声解析
              const rawValue = simulateAudioAnalysis(elapsed, duration);

              // ライブラリと同じ変換処理
              let value = rawValue;
              let min_ = 0;
              const max_ = 1;
              const weight = 1.2;

              if (value > 0) {
                min_ = 0.4;
              }

              // clamp(value * weight, min_, max_)
              value = Math.max(min_, Math.min(max_, value * weight));

              // パラメータを直接設定（加算ではなく設定）
              model.internalModel.coreModel.setParameterValueByIndex(
                paramIndex,
                value
              );

              // 20フレームごとにログ出力
              if (logCounter % 20 === 0) {
                const progress = elapsed / duration;
                console.log(
                  `[LIPSYNC] Speaking: ${Math.round(
                    progress * 100
                  )}%, Raw: ${rawValue.toFixed(1)}, Mouth: ${value.toFixed(3)}`
                );
              }
              logCounter++;
            }
          } catch (e) {
            console.warn("[LIPSYNC] Failed to set mouth parameter:", e);
          }
        } else {
          isSpeaking = false;
          // スムーズに口を閉じる
          try {
            const paramIndex =
              model.internalModel.coreModel.getParameterIndex(
                "ParamMouthOpenY"
              );
            if (paramIndex >= 0) {
              const currentValue =
                model.internalModel.coreModel.getParameterValueByIndex(
                  paramIndex
                );
              const newValue = currentValue * 0.9; // 徐々に0に近づける
              model.internalModel.coreModel.setParameterValueByIndex(
                paramIndex,
                newValue
              );

              if (newValue > 0.05) {
                // まだ完全に閉じていない場合は継続
                isSpeaking = true; // 継続のためtrueに戻す
                speakingStartTime = Date.now() - duration; // 終了フェーズに入る
              }
            }
          } catch (e) {
            console.warn("[LIPSYNC] Failed to close mouth:", e);
          }
        }
      }

      if (animationId !== null) {
        animationId = requestAnimationFrame(animateMouth);
      }
    };

    // テキストレスポンスを監視
    const sessionWithEvents = session as {
      on?: (event: string, callback: (...args: any[]) => void) => void;
      off?: (event: string, callback: (...args: any[]) => void) => void;
    };

    const onTextResponse = (...args: any[]) => {
      console.log("[LIPSYNC] Text response detected, starting mouth animation");
      isSpeaking = true;
      speakingStartTime = Date.now();
    };

    // テキスト関連イベントを監視
    const textEvents = [
      "response.text.delta",
      "conversation.item.output",
      "response.done",
    ];

    textEvents.forEach((eventName) => {
      try {
        sessionWithEvents.on?.(eventName, onTextResponse);
        console.log(`[LIPSYNC] Registered text listener for: ${eventName}`);
      } catch (e) {
        console.warn(`[LIPSYNC] Failed to register ${eventName}:`, e);
      }
    });

    // アニメーション開始
    animationId = requestAnimationFrame(animateMouth);

    const resume = async () => {
      try {
        await audioCtx.resume();
        console.log("[LIPSYNC] AudioContext resumed for text-based lipsync");
      } catch (e) {
        console.warn("[LIPSYNC] AudioContext resume failed:", e);
      }
    };

    const triggerSpeaking = (delay: number = 0) => {
      console.log(
        "[LIPSYNC] Manual trigger: starting mouth animation with delay:",
        delay
      );

      if (delay > 0) {
        // 遅延がある場合はsetTimeoutで開始を遅らせる
        setTimeout(() => {
          isSpeaking = true;
          speakingStartTime = Date.now();
          console.log("[LIPSYNC] Delayed mouth animation started");
        }, delay);
      } else {
        isSpeaking = true;
        speakingStartTime = Date.now();
      }
    };

    const dispose = () => {
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }

      isSpeaking = false;

      textEvents.forEach((eventName) => {
        try {
          sessionWithEvents.off?.(eventName, onTextResponse);
        } catch (e) {
          console.warn(`[LIPSYNC] Failed to remove ${eventName}:`, e);
        }
      });

      mm.currentAnalyzer = undefined;
      mm.currentContext = undefined;
      mm.currentAudio = undefined;

      try {
        audioCtx.close();
      } catch {}
      console.log("[LIPSYNC] Text-based lipsync disposed");
    };

    return { type: "textBased", resume, dispose, triggerSpeaking };
  } catch (error) {
    console.error("[LIPSYNC] Failed to setup text-based lipsync:", error);
    throw error;
  }
}

/**
 * OpenAI Realtime APIの音声イベントから直接リップシンクを設定
 */
export function setupRealtimeEventLipsync(
  model: Live2DModel,
  session: unknown
) {
  try {
    console.log("Setting up realtime event lipsync...");

    const mm = model.internalModel.motionManager as {
      currentAudio?: HTMLAudioElement;
      currentContext?: AudioContext;
      currentAnalyzer?: AnalyserNode;
    };
    model.internalModel.lipSync = true;

    // ダミーのオーディオ要素を作成（mouthSync動作のため必要）
    const dummyAudio = document.createElement("audio");
    dummyAudio.muted = true; // 音は出さない

    // AudioContextとAnalyserを作成
    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -10;
    analyser.smoothingTimeConstant = 0.85;

    // Live2Dに設定
    mm.currentAudio = dummyAudio;
    mm.currentContext = audioCtx;
    mm.currentAnalyzer = analyser;

    // カスタム音声解析関数
    let animationId: number | null = null;
    let currentVolume = 0;

    const analyzeAndUpdate = () => {
      // ボリュームベースのシンプルな口の動きシミュレーション
      const targetMouth = Math.max(0, Math.min(1, currentVolume * 2));

      // パラメータを直接更新
      try {
        const paramIndex =
          model.internalModel.coreModel.getParameterIndex("ParamMouthOpenY");
        if (paramIndex >= 0) {
          model.internalModel.coreModel.setParameterValueByIndex(
            paramIndex,
            targetMouth
          );
        }
      } catch (e) {
        console.warn("Failed to set mouth parameter:", e);
      }

      if (animationId !== null) {
        animationId = requestAnimationFrame(analyzeAndUpdate);
      }
    };

    // セッションの音声イベントをリッスン
    const sessionWithEvents = session as {
      on?: (event: string, callback: (...args: any[]) => void) => void;
      off?: (event: string, callback: (...args: any[]) => void) => void;
    };

    // 全てのイベントを監視してオーディオ関連イベントを発見
    const onAllEvents = (eventName: string, ...args: any[]) => {
      if (
        eventName.toLowerCase().includes("audio") ||
        eventName.toLowerCase().includes("response")
      ) {
        console.log(
          `[LIPSYNC] Audio-related event detected: ${eventName}`,
          args
        );
      }
    };

    // 汎用的なオーディオイベントハンドラ
    const onAudioEvent = (...args: any[]) => {
      console.log("[LIPSYNC] Audio event received:", args);

      // 音声イベントからボリューム情報を抽出を試行
      args.forEach((arg, index) => {
        if (arg && typeof arg === "object") {
          // ArrayBufferやBlobなどの音声データを探す
          const audioData = arg.data || arg.audio || arg.delta || arg.buffer;
          if (audioData instanceof ArrayBuffer) {
            try {
              const audioArray = new Int16Array(audioData);
              let sum = 0;
              for (let i = 0; i < audioArray.length; i++) {
                sum += Math.abs(audioArray[i]);
              }
              currentVolume = Math.min(1, sum / audioArray.length / 10000);
              console.log("[LIPSYNC] Calculated audio volume:", currentVolume);
              return;
            } catch (e) {
              console.warn("[LIPSYNC] Failed to process ArrayBuffer:", e);
            }
          }

          // テキストレスポンス時は簡単なシミュレーション
          if (arg.type === "response" || arg.transcript || arg.text) {
            console.log(
              "[LIPSYNC] Text response detected, simulating mouth movement"
            );
            currentVolume = 0.3 + Math.random() * 0.4; // 0.3-0.7の範囲でランダム
            setTimeout(() => {
              currentVolume = 0;
            }, 2000); // 2秒後に口を閉じる
            return;
          }
        }
      });

      // フォールバック: イベントが発火したら適度な口の動き
      currentVolume = 0.2 + Math.random() * 0.3;
      setTimeout(() => {
        currentVolume = 0;
      }, 1000);
    };

    // 可能性のあるイベント名を全て試す
    const possibleEvents = [
      "audio",
      "audio.delta",
      "response.audio",
      "response.audio.delta",
      "response.audio_transcript.delta",
      "conversation.item.output",
      "response.output_item.added",
      "response.content_part.added",
      "response.audio_transcript.done",
      "response.done",
    ];

    try {
      // 全イベント監視（デバッグ用）
      sessionWithEvents.on?.("*", onAllEvents);

      // 各種音声イベントを監視
      possibleEvents.forEach((eventName) => {
        try {
          sessionWithEvents.on?.(eventName, onAudioEvent);
          console.log(`[LIPSYNC] Registered listener for: ${eventName}`);
        } catch (e) {
          console.warn(`[LIPSYNC] Failed to register ${eventName}:`, e);
        }
      });
    } catch (e) {
      console.warn("[LIPSYNC] Failed to set audio event listeners:", e);
    }

    // アニメーション開始
    animationId = requestAnimationFrame(analyzeAndUpdate);

    const resume = async () => {
      try {
        await audioCtx.resume();
        console.log("AudioContext resumed for lipsync");
      } catch (e) {
        console.warn("AudioContext resume failed:", e);
      }
    };

    const dispose = () => {
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }

      try {
        // 全イベント監視を解除
        sessionWithEvents.off?.("*", onAllEvents);

        // 各種音声イベントリスナーを解除
        possibleEvents.forEach((eventName) => {
          try {
            sessionWithEvents.off?.(eventName, onAudioEvent);
          } catch (e) {
            console.warn(`[LIPSYNC] Failed to remove ${eventName}:`, e);
          }
        });
      } catch (e) {
        console.warn("[LIPSYNC] Failed to remove audio event listeners:", e);
      }

      mm.currentAnalyzer = undefined;
      mm.currentContext = undefined;
      mm.currentAudio = undefined;

      try {
        audioCtx.close();
      } catch {}
      console.log("[LIPSYNC] Event-based lipsync disposed");
    };

    return { type: "eventBased", resume, dispose };
  } catch (error) {
    console.error("Failed to setup event-based lipsync:", error);
    throw error;
  }
}

/**
 * 実際の音声ストリームを取得してリップシンクを設定
 */
export function setupRealAudioLipsync(model: Live2DModel, session: unknown) {
  try {
    const sessionObj = session as any;

    // RTCPeerConnectionを探す
    const findRTCConnection = (
      obj: any,
      visited = new Set()
    ): RTCPeerConnection | null => {
      if (!obj || typeof obj !== "object" || visited.has(obj)) return null;
      visited.add(obj);

      if (obj instanceof RTCPeerConnection) {
        return obj;
      }

      for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (value && typeof value === "object") {
          const result = findRTCConnection(value, visited);
          if (result) return result;
        }
      }
      return null;
    };

    const peerConnection = findRTCConnection(sessionObj);

    if (peerConnection) {
      console.log(
        "[LIPSYNC] Found RTCPeerConnection, setting up real audio lipsync"
      );

      // 受信する音声トラックからMediaStreamを作成
      const audioReceivers = peerConnection
        .getReceivers()
        .filter((r) => r.track?.kind === "audio");

      if (audioReceivers.length > 0) {
        const audioTrack = audioReceivers[0].track;
        if (audioTrack) {
          const mediaStream = new MediaStream([audioTrack]);
          console.log("[LIPSYNC] Created MediaStream from audio track");

          const { resume, dispose } = wireLipsyncFromMediaStream(
            model,
            mediaStream
          );
          return { type: "realAudio", resume, dispose };
        }
      }

      // 音声トラックがまだない場合、trackイベントを監視
      let disposeFunc: (() => void) | null = null;
      let resumeFunc: (() => Promise<void>) | null = null;

      const onTrack = (event: RTCTrackEvent) => {
        console.log("[LIPSYNC] RTCTrackEvent received:", event.track.kind);

        if (event.track.kind === "audio") {
          const mediaStream =
            event.streams[0] || new MediaStream([event.track]);
          console.log("[LIPSYNC] Setting up lipsync with received audio track");

          const { resume, dispose } = wireLipsyncFromMediaStream(
            model,
            mediaStream
          );
          disposeFunc = dispose;
          resumeFunc = resume;

          // 即座に開始
          resume().catch((e) => console.warn("[LIPSYNC] Failed to resume:", e));
        }
      };

      peerConnection.addEventListener("track", onTrack);

      return {
        type: "realAudioDeferred",
        resume: async () => {
          if (resumeFunc) await resumeFunc();
        },
        dispose: () => {
          peerConnection.removeEventListener("track", onTrack);
          if (disposeFunc) disposeFunc();
        },
      };
    }

    // HTMLAudioElementを探す
    const findAudioElement = (
      obj: any,
      visited = new Set()
    ): HTMLAudioElement | null => {
      if (!obj || typeof obj !== "object" || visited.has(obj)) return null;
      visited.add(obj);

      if (obj instanceof HTMLAudioElement) {
        return obj;
      }

      for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (value && typeof value === "object") {
          const result = findAudioElement(value, visited);
          if (result) return result;
        }
      }
      return null;
    };

    const audioElement = findAudioElement(sessionObj);

    if (audioElement) {
      console.log(
        "[LIPSYNC] Found HTMLAudioElement, setting up real audio lipsync"
      );
      const { resume, dispose } = wireLipsyncFromAudioElement(
        model,
        audioElement
      );
      return { type: "realAudioElement", resume, dispose };
    }

    return null; // 実際の音声ソースが見つからない
  } catch (error) {
    console.error("[LIPSYNC] Failed to setup real audio lipsync:", error);
    return null;
  }
}

/**
 * OpenAI Realtime APIセッションとLive2Dモデルを統合
 */
export function setupRealtimeLipsync(model: Live2DModel, session: unknown) {
  try {
    console.log("[LIPSYNC] Setting up realtime lipsync...");
    console.log("[LIPSYNC] Session object keys:", Object.keys(session || {}));

    // RealtimeSessionの内部構造を詳しく調査
    const sessionObj = session as any;
    console.log(
      "[LIPSYNC] Session prototype methods:",
      Object.getOwnPropertyNames(Object.getPrototypeOf(sessionObj))
    );

    // 内部プロパティを深く探る
    const exploreObject = (obj: any, path: string, maxDepth: number = 3) => {
      if (maxDepth <= 0 || !obj || typeof obj !== "object") return;

      for (const key of Object.keys(obj)) {
        const value = obj[key];
        const currentPath = path ? `${path}.${key}` : key;

        if (
          key.toLowerCase().includes("audio") ||
          key.toLowerCase().includes("stream") ||
          key.toLowerCase().includes("media") ||
          key.toLowerCase().includes("rtc") ||
          key.toLowerCase().includes("peer") ||
          key.toLowerCase().includes("connection")
        ) {
          console.log(
            `[LIPSYNC] Found potential audio object at ${currentPath}:`,
            typeof value,
            value
          );
        }

        // WebRTC関連のオブジェクトを深く探る
        if (value && typeof value === "object" && maxDepth > 1) {
          if (value instanceof RTCPeerConnection) {
            console.log(
              `[LIPSYNC] Found RTCPeerConnection at ${currentPath}:`,
              value
            );
            // getReceiversを調べる
            const receivers = value.getReceivers();
            console.log(`[LIPSYNC] RTCPeerConnection receivers:`, receivers);

            receivers.forEach((receiver, index) => {
              console.log(
                `[LIPSYNC] Receiver ${index}:`,
                receiver.track?.kind,
                receiver.track
              );
            });
          }

          if (value instanceof MediaStream) {
            console.log(
              `[LIPSYNC] Found MediaStream at ${currentPath}:`,
              value
            );
            console.log(`[LIPSYNC] MediaStream tracks:`, value.getTracks());
          }

          if (value instanceof HTMLAudioElement) {
            console.log(
              `[LIPSYNC] Found HTMLAudioElement at ${currentPath}:`,
              value
            );
          }

          exploreObject(value, currentPath, maxDepth - 1);
        }
      }
    };

    exploreObject(sessionObj, "session", 2);

    // 実際の音声ストリームが見つかった場合の処理を試行
    const realAudioLipsync = setupRealAudioLipsync(model, session);
    if (realAudioLipsync) {
      console.log("[LIPSYNC] Using real audio lipsync");
      return realAudioLipsync;
    }

    // 音声ベースのリップシンクを優先（セッション情報も渡す）
    console.log("[LIPSYNC] Setting up audio-based lipsync with session info");
    return setupAudioBasedLipsync(model, session);

    // フォールバック: テキストベース（使用しない）
    // return setupTextBasedLipsync(model, session);

    // 従来のアプローチも残しておく（デバッグ用）
    /*
    // 方法A: SDKが「リモート音声の <audio> 要素」を公開している場合
    const sdkAudioEl = (session as { audioElement?: HTMLAudioElement }).audioElement;
    if (sdkAudioEl) {
      console.log('Found SDK audio element, using AudioElement method');
      const { resume, dispose } = wireLipsyncFromAudioElement(model, sdkAudioEl);
      return { type: 'audioElement', resume, dispose };
    }

    // 方法B: RTCPeerConnection からリモート MediaStream を得られる場合
    const pc = (session as { peerConnection?: RTCPeerConnection; pc?: RTCPeerConnection }).peerConnection ?? 
               (session as { peerConnection?: RTCPeerConnection; pc?: RTCPeerConnection }).pc;
    if (pc) {
      console.log('Found RTCPeerConnection, setting up track listener');
      let disposeFunc: (() => void) | null = null;
      let resumeFunc: (() => Promise<void>) | null = null;

      const onTrack = (ev: RTCTrackEvent) => {
        console.log('Received WebRTC track:', ev.track.kind);
        if (ev.track.kind === 'audio') {
          const stream = ev.streams?.[0] ?? new MediaStream([ev.track]);
          const { resume, dispose } = wireLipsyncFromMediaStream(model, stream);
          disposeFunc = dispose;
          resumeFunc = resume;
        }
      };

      pc.addEventListener('track', onTrack);
      
      return {
        type: 'peerConnection',
        resume: async () => { if (resumeFunc) await resumeFunc(); },
        dispose: () => {
          pc.removeEventListener('track', onTrack);
          if (disposeFunc) disposeFunc();
        }
      };
    }

    throw new Error('No suitable audio source found in session');
    */
  } catch (error) {
    console.error("Failed to setup realtime lipsync:", error);
    throw error;
  }
}
