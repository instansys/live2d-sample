export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;

  async startRecording(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.start(100); // Collect data every 100ms
      console.log("Recording started");
    } catch (error) {
      console.error("Failed to start recording:", error);
      throw error;
    }
  }

  stopRecording(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error("No recording in progress"));
        return;
      }

      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, {
          type: "audio/webm;codecs=opus",
        });
        this.cleanup();
        resolve(audioBlob);
      };

      this.mediaRecorder.stop();
    });
  }

  private cleanup() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.mediaRecorder = null;
    this.audioChunks = [];
  }

  isRecording(): boolean {
    return this.mediaRecorder?.state === "recording";
  }
}

export class AudioPlayer {
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;

  constructor() {
    // Initialize AudioContext on user interaction
    if (typeof window !== "undefined") {
      this.initAudioContext();
    }
  }

  private async initAudioContext() {
    try {
      this.audioContext = new window.AudioContext();

      // Resume context if suspended (browser autoplay policy)
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }
    } catch (error) {
      console.error("Failed to initialize AudioContext:", error);
    }
  }

  async playAudioData(
    audioData: Int16Array,
    sampleRate: number = 24000
  ): Promise<void> {
    if (!this.audioContext) {
      await this.initAudioContext();
    }

    if (!this.audioContext) {
      throw new Error("AudioContext not available");
    }

    try {
      // Stop any currently playing audio
      this.stopAudio();

      // Create audio buffer
      const audioBuffer = this.audioContext.createBuffer(
        1,
        audioData.length,
        sampleRate
      );
      const channelData = audioBuffer.getChannelData(0);

      // Convert Int16 to Float32 and normalize
      for (let i = 0; i < audioData.length; i++) {
        channelData[i] = audioData[i] / 32768.0;
      }

      // Create and configure audio source
      this.currentSource = this.audioContext.createBufferSource();
      this.currentSource.buffer = audioBuffer;
      this.currentSource.connect(this.audioContext.destination);

      // Play audio
      this.currentSource.start();
      console.log("Audio playback started");

      // Clean up when finished
      this.currentSource.onended = () => {
        this.currentSource = null;
      };
    } catch (error) {
      console.error("Failed to play audio:", error);
      throw error;
    }
  }

  async playAudioBuffer(
    audioBuffer: ArrayBuffer,
    sampleRate: number = 24000
  ): Promise<void> {
    const int16Array = new Int16Array(audioBuffer);
    await this.playAudioData(int16Array, sampleRate);
  }

  stopAudio() {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch (error) {
        console.warn("Error stopping audio:", error);
      }
      this.currentSource = null;
    }
  }

  isPlaying(): boolean {
    return this.currentSource !== null;
  }
}

// Utility functions for audio conversion
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URL prefix to get base64 string
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

export function int16ArrayToBase64(audioData: Int16Array): string {
  const buffer = new ArrayBuffer(audioData.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < audioData.length; i++) {
    view.setInt16(i * 2, audioData[i], true); // little-endian
  }

  const uint8Array = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }

  return btoa(binary);
}

export function createWaveFile(
  audioData: Int16Array,
  sampleRate: number = 24000
): Blob {
  const buffer = new ArrayBuffer(44 + audioData.length * 2);
  const view = new DataView(buffer);

  // WAV header
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, audioData.length * 2, true);

  // Audio data
  for (let i = 0; i < audioData.length; i++) {
    view.setInt16(44 + i * 2, audioData[i], true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

// ストリーミング再生用のプレイヤー（PCM Int16 チャンクを逐次再生）
export class StreamingAudioPlayer {
  private audioContext: AudioContext | null = null;
  private sampleRate: number;
  private playbackTime = 0;
  private outputGain: GainNode | null = null;
  private streamDestination: MediaStreamAudioDestinationNode | null = null;
  private scheduledSources: AudioBufferSourceNode[] = [];
  private started = false;

  constructor(sampleRate: number = 24000) {
    this.sampleRate = sampleRate;
  }

  private ensureContext() {
    if (!this.audioContext) {
      this.audioContext = new window.AudioContext({
        sampleRate: this.sampleRate,
      });
      this.outputGain = this.audioContext.createGain();
      this.streamDestination = this.audioContext.createMediaStreamDestination();
      // 出力は MediaStream 経由のみ（実音は lipsync 側の <audio> が担当）
      this.outputGain.connect(this.streamDestination);
      this.playbackTime = this.audioContext.currentTime;
    }
  }

  async resume() {
    this.ensureContext();
    if (this.audioContext?.state === "suspended") {
      await this.audioContext.resume();
    }
    this.started = true;
  }

  // Safari対策: ユーザー操作後に明示的にplaybackTimeを前倒ししない
  // resume() 呼び出しをユーザー操作ハンドラ内で先に行うこと

  getMediaStream(): MediaStream | null {
    return this.streamDestination?.stream ?? null;
  }

  // PCM Int16 を Float32 に変換してスケジューリング
  enqueue(int16: Int16Array) {
    if (!int16 || int16.length === 0) return;
    this.ensureContext();
    if (!this.audioContext || !this.outputGain) return;

    const ctx = this.audioContext;
    const length = int16.length;
    const buffer = ctx.createBuffer(1, length, this.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      channel[i] = int16[i] / 32768;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.outputGain);

    // ドロップアウト防止のため最小リードタイムを確保
    const minLead = 0.05; // 50ms
    const now = ctx.currentTime;
    const startAt = Math.max(this.playbackTime, now + minLead);
    try {
      src.start(startAt);
    } catch {
      // 同一時刻二重startなどの安全策
      try {
        src.start();
      } catch {}
    }

    const duration = buffer.duration;
    this.playbackTime = startAt + duration;

    // 再生終了後のクリーンアップ
    src.onended = () => {
      const idx = this.scheduledSources.indexOf(src);
      if (idx >= 0) this.scheduledSources.splice(idx, 1);
      try {
        src.disconnect();
      } catch {}
    };
    this.scheduledSources.push(src);
  }

  // 中断ポリシー: 未再生のキューを破棄し即停止
  flushAndStop() {
    if (!this.audioContext) return;
    // すべて停止
    for (const src of this.scheduledSources) {
      try {
        src.stop(0);
      } catch {}
      try {
        src.disconnect();
      } catch {}
    }
    this.scheduledSources = [];
    // 再生位置を現在時刻にリセット
    this.playbackTime = this.audioContext.currentTime;
  }

  setVolume(volume: number) {
    if (!this.outputGain) return;
    this.outputGain.gain.value = Math.max(0, Math.min(1, volume));
  }

  dispose() {
    this.flushAndStop();
    try {
      this.outputGain?.disconnect();
    } catch {}
    try {
      this.streamDestination?.disconnect();
    } catch {}
    const ctx = this.audioContext;
    this.audioContext = null;
    this.outputGain = null;
    this.streamDestination = null;
    if (ctx) {
      try {
        ctx.close();
      } catch {}
    }
    this.started = false;
  }
}

// マイクからPCM(Int16/mono/16kHz)を生成してコールバックに流す簡易ストリーマ
export class MicPcmStreamer {
  private audioCtx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private running = false;
  private targetRate: number;
  private channelIndex = 0;

  constructor(targetSampleRate: number = 16000) {
    this.targetRate = targetSampleRate;
  }

  private downsampleTo16k(input: Float32Array, inputRate: number): Int16Array {
    if (inputRate === this.targetRate) {
      const out = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++)
        out[i] = Math.max(-1, Math.min(1, input[i])) * 0x7fff;
      return out;
    }
    const ratio = inputRate / this.targetRate;
    const newLen = Math.floor(input.length / ratio);
    const out = new Int16Array(newLen);
    let pos = 0;
    for (let i = 0; i < newLen; i++) {
      const idx = i * ratio;
      const i0 = Math.floor(idx);
      const i1 = Math.min(i0 + 1, input.length - 1);
      const frac = idx - i0;
      const sample = input[i0] * (1 - frac) + input[i1] * frac;
      out[pos++] = Math.max(-1, Math.min(1, sample)) * 0x7fff;
    }
    return out;
  }

  async start(onPcm: (pcm: Int16Array) => void) {
    if (this.running) return;
    this.running = true;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.audioCtx = new window.AudioContext();
    const ctx = this.audioCtx;

    this.source = ctx.createMediaStreamSource(this.stream);
    this.processor = ctx.createScriptProcessor(2048, 1, 1);

    this.processor.onaudioprocess = (ev) => {
      if (!this.running) return;
      const input = ev.inputBuffer.getChannelData(this.channelIndex);
      const pcm16 = this.downsampleTo16k(input, ctx.sampleRate);
      if (pcm16.length > 0) onPcm(pcm16);
    };

    this.source.connect(this.processor);
    this.processor.connect(ctx.destination); // 処理を発火
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    try {
      this.processor?.disconnect();
    } catch {}
    try {
      this.source?.disconnect();
    } catch {}
    try {
      this.stream?.getTracks().forEach((t) => t.stop());
    } catch {}
    const ctx = this.audioCtx;
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.audioCtx = null;
    if (ctx) {
      try {
        await ctx.close();
      } catch {}
    }
  }

  isRunning() {
    return this.running;
  }
}
