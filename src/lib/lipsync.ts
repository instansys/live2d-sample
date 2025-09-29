import type { Live2DModel } from 'pixi-live2d-display-lipsyncpatch/cubism4';

/**
 * WebRTCのリモート MediaStream からリップシンクのみ接続する。
 * model.speak は使わず、再生は audioEl に任せる。
 */
export function wireLipsyncFromMediaStream(model: Live2DModel, remoteStream: MediaStream) {
  try {
    // 再生用の <audio> を自前で作る
    const audioEl = document.createElement('audio');
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
    mm.currentAudio = audioEl;         // これが truthy だと内部で mouthSync() が動く
    mm.currentContext = audioCtx;
    mm.currentAnalyzer = analyser;

    console.log('MediaStream lipsync configured');

    // ブラウザの自動再生制限対応
    const resume = async () => {
      try { 
        await audioCtx.resume(); 
      } catch (e) {
        console.warn('AudioContext resume failed:', e);
      }
      try { 
        await audioEl.play(); 
      } catch (e) {
        console.warn('Audio play failed:', e);
      }
    };

    // 解除関数
    const dispose = () => {
      try { audioEl.pause(); } catch {}
      audioEl.srcObject = null;
      mm.currentAnalyzer = undefined;
      mm.currentContext = undefined;
      mm.currentAudio = undefined;
      try { audioCtx.close(); } catch {}
      console.log('MediaStream lipsync disposed');
    };

    return { audioEl, audioCtx, analyser, resume, dispose };
  } catch (error) {
    console.error('Failed to setup MediaStream lipsync:', error);
    throw error;
  }
}

/**
 * 既存の <audio> 要素に Web Audio を接続してリップシンクを設定
 */
export function wireLipsyncFromAudioElement(model: Live2DModel, audioEl: HTMLAudioElement) {
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

    console.log('AudioElement lipsync configured');

    const resume = async () => {
      try { 
        await ctx.resume(); 
      } catch (e) {
        console.warn('AudioContext resume failed:', e);
      }
      try { 
        await audioEl.play(); 
      } catch (e) {
        console.warn('Audio play failed:', e);
      }
    };

    const dispose = () => {
      mm.currentAnalyzer = undefined;
      mm.currentContext = undefined;
      mm.currentAudio = undefined;
      try { source.disconnect(); } catch {}
      try { ctx.close(); } catch {}
      console.log('AudioElement lipsync disposed');
    };

    return { analyser, resume, dispose };
  } catch (error) {
    console.error('Failed to setup AudioElement lipsync:', error);
    throw error;
  }
}

/**
 * テキストレスポンスタイミングでのシンプルリップシンク
 */
export function setupTextBasedLipsync(model: Live2DModel, session: unknown) {
  try {
    console.log('[LIPSYNC] Setting up text-based lipsync...');
    
    const mm = model.internalModel.motionManager as {
      currentAudio?: HTMLAudioElement;
      currentContext?: AudioContext;
      currentAnalyzer?: AnalyserNode;
    };
    model.internalModel.lipSync = true;

    // ダミーのオーディオ要素
    const dummyAudio = document.createElement('audio');
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
    const simulateAudioAnalysis = (elapsed: number, duration: number): number => {
      // 時間経過に基づく強度計算
      const progress = elapsed / duration;
      const intensity = Math.max(0, 1 - progress * 0.8); // 徐々に減衰
      
      // 実際の音声波形に近いパターン（振幅を小さくして現実的に）
      const time = elapsed * 0.001; // ミリ秒を秒に変換
      const wave1 = Math.sin(time * 8) * 0.15;    // 低い周波数
      const wave2 = Math.sin(time * 15) * 0.08;   // 中間周波数  
      const wave3 = Math.sin(time * 30) * 0.05;   // 高い周波数
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
      const rms = Math.sqrt(sumSquares / fftSize * 20);
      
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
            const paramIndex = model.internalModel.coreModel.getParameterIndex('ParamMouthOpenY');
            if (paramIndex >= 0) {
              // まずパラメータを0にリセット
              model.internalModel.coreModel.setParameterValueByIndex(paramIndex, 0);
              
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
              model.internalModel.coreModel.setParameterValueByIndex(paramIndex, value);
              
              // 20フレームごとにログ出力
              if (logCounter % 20 === 0) {
                const progress = elapsed / duration;
                console.log(`[LIPSYNC] Speaking: ${Math.round(progress * 100)}%, Raw: ${rawValue.toFixed(1)}, Mouth: ${value.toFixed(3)}`);
              }
              logCounter++;
            }
          } catch (e) {
            console.warn('[LIPSYNC] Failed to set mouth parameter:', e);
          }
        } else {
          isSpeaking = false;
          // スムーズに口を閉じる
          try {
            const paramIndex = model.internalModel.coreModel.getParameterIndex('ParamMouthOpenY');
            if (paramIndex >= 0) {
              const currentValue = model.internalModel.coreModel.getParameterValueByIndex(paramIndex);
              const newValue = currentValue * 0.9; // 徐々に0に近づける
              model.internalModel.coreModel.setParameterValueByIndex(paramIndex, newValue);
              
              if (newValue > 0.05) {
                // まだ完全に閉じていない場合は継続
                isSpeaking = true; // 継続のためtrueに戻す
                speakingStartTime = Date.now() - duration; // 終了フェーズに入る
              }
            }
          } catch (e) {
            console.warn('[LIPSYNC] Failed to close mouth:', e);
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
      console.log('[LIPSYNC] Text response detected, starting mouth animation');
      isSpeaking = true;
      speakingStartTime = Date.now();
    };

    // テキスト関連イベントを監視
    const textEvents = [
      'response.text.delta',
      'conversation.item.output',
      'response.done'
    ];

    textEvents.forEach(eventName => {
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
        console.log('[LIPSYNC] AudioContext resumed for text-based lipsync');
      } catch (e) {
        console.warn('[LIPSYNC] AudioContext resume failed:', e);
      }
    };

    const triggerSpeaking = (delay: number = 0) => {
      console.log('[LIPSYNC] Manual trigger: starting mouth animation with delay:', delay);
      
      if (delay > 0) {
        // 遅延がある場合はsetTimeoutで開始を遅らせる
        setTimeout(() => {
          isSpeaking = true;
          speakingStartTime = Date.now();
          console.log('[LIPSYNC] Delayed mouth animation started');
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
      
      textEvents.forEach(eventName => {
        try {
          sessionWithEvents.off?.(eventName, onTextResponse);
        } catch (e) {
          console.warn(`[LIPSYNC] Failed to remove ${eventName}:`, e);
        }
      });

      mm.currentAnalyzer = undefined;
      mm.currentContext = undefined;
      mm.currentAudio = undefined;
      
      try { audioCtx.close(); } catch {}
      console.log('[LIPSYNC] Text-based lipsync disposed');
    };

    return { type: 'textBased', resume, dispose, triggerSpeaking };
  } catch (error) {
    console.error('[LIPSYNC] Failed to setup text-based lipsync:', error);
    throw error;
  }
}

/**
 * OpenAI Realtime APIの音声イベントから直接リップシンクを設定
 */
export function setupRealtimeEventLipsync(model: Live2DModel, session: unknown) {
  try {
    console.log('Setting up realtime event lipsync...');
    
    const mm = model.internalModel.motionManager as {
      currentAudio?: HTMLAudioElement;
      currentContext?: AudioContext;
      currentAnalyzer?: AnalyserNode;
    };
    model.internalModel.lipSync = true;

    // ダミーのオーディオ要素を作成（mouthSync動作のため必要）
    const dummyAudio = document.createElement('audio');
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
        const paramIndex = model.internalModel.coreModel.getParameterIndex('ParamMouthOpenY');
        if (paramIndex >= 0) {
          model.internalModel.coreModel.setParameterValueByIndex(paramIndex, targetMouth);
        }
      } catch (e) {
        console.warn('Failed to set mouth parameter:', e);
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
      if (eventName.toLowerCase().includes('audio') || eventName.toLowerCase().includes('response')) {
        console.log(`[LIPSYNC] Audio-related event detected: ${eventName}`, args);
      }
    };

    // 汎用的なオーディオイベントハンドラ
    const onAudioEvent = (...args: any[]) => {
      console.log('[LIPSYNC] Audio event received:', args);
      
      // 音声イベントからボリューム情報を抽出を試行
      args.forEach((arg, index) => {
        if (arg && typeof arg === 'object') {
          // ArrayBufferやBlobなどの音声データを探す
          const audioData = arg.data || arg.audio || arg.delta || arg.buffer;
          if (audioData instanceof ArrayBuffer) {
            try {
              const audioArray = new Int16Array(audioData);
              let sum = 0;
              for (let i = 0; i < audioArray.length; i++) {
                sum += Math.abs(audioArray[i]);
              }
              currentVolume = Math.min(1, (sum / audioArray.length) / 10000);
              console.log('[LIPSYNC] Calculated audio volume:', currentVolume);
              return;
            } catch (e) {
              console.warn('[LIPSYNC] Failed to process ArrayBuffer:', e);
            }
          }
          
          // テキストレスポンス時は簡単なシミュレーション
          if (arg.type === 'response' || arg.transcript || arg.text) {
            console.log('[LIPSYNC] Text response detected, simulating mouth movement');
            currentVolume = 0.3 + Math.random() * 0.4; // 0.3-0.7の範囲でランダム
            setTimeout(() => { currentVolume = 0; }, 2000); // 2秒後に口を閉じる
            return;
          }
        }
      });
      
      // フォールバック: イベントが発火したら適度な口の動き
      currentVolume = 0.2 + Math.random() * 0.3;
      setTimeout(() => { currentVolume = 0; }, 1000);
    };

    // 可能性のあるイベント名を全て試す
    const possibleEvents = [
      'audio',
      'audio.delta', 
      'response.audio',
      'response.audio.delta',
      'response.audio_transcript.delta',
      'conversation.item.output',
      'response.output_item.added',
      'response.content_part.added',
      'response.audio_transcript.done',
      'response.done'
    ];

    try {
      // 全イベント監視（デバッグ用）
      sessionWithEvents.on?.('*', onAllEvents);
      
      // 各種音声イベントを監視
      possibleEvents.forEach(eventName => {
        try {
          sessionWithEvents.on?.(eventName, onAudioEvent);
          console.log(`[LIPSYNC] Registered listener for: ${eventName}`);
        } catch (e) {
          console.warn(`[LIPSYNC] Failed to register ${eventName}:`, e);
        }
      });
    } catch (e) {
      console.warn('[LIPSYNC] Failed to set audio event listeners:', e);
    }

    // アニメーション開始
    animationId = requestAnimationFrame(analyzeAndUpdate);

    const resume = async () => {
      try { 
        await audioCtx.resume(); 
        console.log('AudioContext resumed for lipsync');
      } catch (e) {
        console.warn('AudioContext resume failed:', e);
      }
    };

    const dispose = () => {
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
      
      try {
        // 全イベント監視を解除
        sessionWithEvents.off?.('*', onAllEvents);
        
        // 各種音声イベントリスナーを解除
        possibleEvents.forEach(eventName => {
          try {
            sessionWithEvents.off?.(eventName, onAudioEvent);
          } catch (e) {
            console.warn(`[LIPSYNC] Failed to remove ${eventName}:`, e);
          }
        });
      } catch (e) {
        console.warn('[LIPSYNC] Failed to remove audio event listeners:', e);
      }

      mm.currentAnalyzer = undefined;
      mm.currentContext = undefined;
      mm.currentAudio = undefined;
      
      try { audioCtx.close(); } catch {}
      console.log('[LIPSYNC] Event-based lipsync disposed');
    };

    return { type: 'eventBased', resume, dispose };
  } catch (error) {
    console.error('Failed to setup event-based lipsync:', error);
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
    const findRTCConnection = (obj: any, visited = new Set()): RTCPeerConnection | null => {
      if (!obj || typeof obj !== 'object' || visited.has(obj)) return null;
      visited.add(obj);
      
      if (obj instanceof RTCPeerConnection) {
        return obj;
      }
      
      for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (value && typeof value === 'object') {
          const result = findRTCConnection(value, visited);
          if (result) return result;
        }
      }
      return null;
    };
    
    const peerConnection = findRTCConnection(sessionObj);
    
    if (peerConnection) {
      console.log('[LIPSYNC] Found RTCPeerConnection, setting up real audio lipsync');
      
      // 受信する音声トラックからMediaStreamを作成
      const audioReceivers = peerConnection.getReceivers().filter(r => r.track?.kind === 'audio');
      
      if (audioReceivers.length > 0) {
        const audioTrack = audioReceivers[0].track;
        if (audioTrack) {
          const mediaStream = new MediaStream([audioTrack]);
          console.log('[LIPSYNC] Created MediaStream from audio track');
          
          const { resume, dispose } = wireLipsyncFromMediaStream(model, mediaStream);
          return { type: 'realAudio', resume, dispose };
        }
      }
      
      // 音声トラックがまだない場合、trackイベントを監視
      let disposeFunc: (() => void) | null = null;
      let resumeFunc: (() => Promise<void>) | null = null;
      
      const onTrack = (event: RTCTrackEvent) => {
        console.log('[LIPSYNC] RTCTrackEvent received:', event.track.kind);
        
        if (event.track.kind === 'audio') {
          const mediaStream = event.streams[0] || new MediaStream([event.track]);
          console.log('[LIPSYNC] Setting up lipsync with received audio track');
          
          const { resume, dispose } = wireLipsyncFromMediaStream(model, mediaStream);
          disposeFunc = dispose;
          resumeFunc = resume;
          
          // 即座に開始
          resume().catch(e => console.warn('[LIPSYNC] Failed to resume:', e));
        }
      };
      
      peerConnection.addEventListener('track', onTrack);
      
      return {
        type: 'realAudioDeferred',
        resume: async () => {
          if (resumeFunc) await resumeFunc();
        },
        dispose: () => {
          peerConnection.removeEventListener('track', onTrack);
          if (disposeFunc) disposeFunc();
        }
      };
    }
    
    // HTMLAudioElementを探す
    const findAudioElement = (obj: any, visited = new Set()): HTMLAudioElement | null => {
      if (!obj || typeof obj !== 'object' || visited.has(obj)) return null;
      visited.add(obj);
      
      if (obj instanceof HTMLAudioElement) {
        return obj;
      }
      
      for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (value && typeof value === 'object') {
          const result = findAudioElement(value, visited);
          if (result) return result;
        }
      }
      return null;
    };
    
    const audioElement = findAudioElement(sessionObj);
    
    if (audioElement) {
      console.log('[LIPSYNC] Found HTMLAudioElement, setting up real audio lipsync');
      const { resume, dispose } = wireLipsyncFromAudioElement(model, audioElement);
      return { type: 'realAudioElement', resume, dispose };
    }
    
    return null; // 実際の音声ソースが見つからない
  } catch (error) {
    console.error('[LIPSYNC] Failed to setup real audio lipsync:', error);
    return null;
  }
}

/**
 * OpenAI Realtime APIセッションとLive2Dモデルを統合
 */
export function setupRealtimeLipsync(model: Live2DModel, session: unknown) {
  try {
    console.log('[LIPSYNC] Setting up realtime lipsync...');
    console.log('[LIPSYNC] Session object keys:', Object.keys(session || {}));
    
    // RealtimeSessionの内部構造を詳しく調査
    const sessionObj = session as any;
    console.log('[LIPSYNC] Session prototype methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(sessionObj)));
    
    // 内部プロパティを深く探る
    const exploreObject = (obj: any, path: string, maxDepth: number = 3) => {
      if (maxDepth <= 0 || !obj || typeof obj !== 'object') return;
      
      for (const key of Object.keys(obj)) {
        const value = obj[key];
        const currentPath = path ? `${path}.${key}` : key;
        
        if (key.toLowerCase().includes('audio') || key.toLowerCase().includes('stream') || 
            key.toLowerCase().includes('media') || key.toLowerCase().includes('rtc') ||
            key.toLowerCase().includes('peer') || key.toLowerCase().includes('connection')) {
          console.log(`[LIPSYNC] Found potential audio object at ${currentPath}:`, typeof value, value);
        }
        
        // WebRTC関連のオブジェクトを深く探る
        if (value && typeof value === 'object' && maxDepth > 1) {
          if (value instanceof RTCPeerConnection) {
            console.log(`[LIPSYNC] Found RTCPeerConnection at ${currentPath}:`, value);
            // getReceiversを調べる
            const receivers = value.getReceivers();
            console.log(`[LIPSYNC] RTCPeerConnection receivers:`, receivers);
            
            receivers.forEach((receiver, index) => {
              console.log(`[LIPSYNC] Receiver ${index}:`, receiver.track?.kind, receiver.track);
            });
          }
          
          if (value instanceof MediaStream) {
            console.log(`[LIPSYNC] Found MediaStream at ${currentPath}:`, value);
            console.log(`[LIPSYNC] MediaStream tracks:`, value.getTracks());
          }
          
          if (value instanceof HTMLAudioElement) {
            console.log(`[LIPSYNC] Found HTMLAudioElement at ${currentPath}:`, value);
          }
          
          exploreObject(value, currentPath, maxDepth - 1);
        }
      }
    };
    
    exploreObject(sessionObj, 'session', 2);
    
    // 実際の音声ストリームが見つかった場合の処理を試行
    const realAudioLipsync = setupRealAudioLipsync(model, session);
    if (realAudioLipsync) {
      console.log('[LIPSYNC] Using real audio lipsync');
      return realAudioLipsync;
    }
    
    // フォールバック: テキストベース
    console.log('[LIPSYNC] Falling back to text-based lipsync');
    return setupTextBasedLipsync(model, session);
    
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
    console.error('Failed to setup realtime lipsync:', error);
    throw error;
  }
}