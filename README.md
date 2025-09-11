# Live2D システムガイド

## 概要
このドキュメントは、pixi-live2d-display-lipsyncpatchを使用したLive2Dモデルの音声リップシンク、表情変更、モーション再生システムについて説明します。

## 1. 基本構成

### 1.1 使用ライブラリ
- **pixi-live2d-display-lipsyncpatch**: Live2D Cubism 4モデル表示とリップシンク機能
- **pixi.js**: 2Dレンダリングエンジン
- **React**: UIコンポーネント管理

### 1.2 ファイル構造
```
public/live2d/Resources/Haru/
├── Haru.model3.json        # モデル定義ファイル
├── Haru.moc3              # モデルデータ
├── Haru.physics3.json     # 物理演算設定
├── expressions/           # 表情ファイル
│   ├── F01.exp3.json
│   ├── F02.exp3.json
│   └── ...
├── motions/              # モーションファイル
│   ├── haru_g_idle.motion3.json
│   ├── haru_g_m01.motion3.json
│   └── ...
└── sounds/               # 音声ファイル
    ├── haru_Info_04.wav
    └── ...
```

## 2. モーションシステム

### 2.1 モーション構造
model3.jsonでは、モーションがグループとインデックスで管理されています：

```json
{
  "Motions": {
    "Idle": [
      {
        "File": "motions/haru_g_idle.motion3.json",
        "FadeInTime": 0.5,
        "FadeOutTime": 0.5
      }
    ],
    "TapBody": [
      {
        "File": "motions/haru_g_m26.motion3.json",
        "FadeInTime": 0.5,
        "FadeOutTime": 0.5,
        "Sound": "sounds/haru_talk_13.wav"
      }
    ]
  }
}
```

### 2.2 モーション再生方法
```typescript
// グループ名、インデックス、優先度を指定
model.motion(group: string, index: number, priority: number)

// 例：
model.motion("Idle", 0, 3);      // アイドルモーション
model.motion("TapBody", 0, 3);   // タップモーション
```

### 2.3 優先度システム
- **優先度が高い**ほど他のモーションを上書きできる
- 推奨値：通常のモーション = 1～3, 重要なモーション = 4以上

## 3. 表情システム

### 3.1 表情構造
model3.jsonでは表情が配列で定義されています：

```json
{
  "Expressions": [
    {
      "Name": "F01",
      "File": "expressions/F01.exp3.json"
    },
    {
      "Name": "F02", 
      "File": "expressions/F02.exp3.json"
    }
  ]
}
```

### 3.2 表情変更方法
```typescript
// 表情名を指定
model.expression(expressionName: string)

// 例：
model.expression("F01");  // 表情1に変更
model.expression("F02");  // 表情2に変更
```

### 3.3 表情の特徴
- モーションと**独立して動作**
- 複数の表情を**同時適用不可**（新しい表情が前の表情を置き換える）
- フェード効果で**スムーズに切り替わる**

## 4. リップシンクシステム

### 4.1 リップシンクの仕組み
pixi-live2d-display-lipsyncpatchは以下の処理を行います：

1. **音声解析**: 音声ファイルの振幅を分析
2. **パラメータ制御**: `ParamMouthOpenY`パラメータを音声に合わせて調整
3. **リアルタイム同期**: 音声再生と口の動きを同期

### 4.2 LipSyncグループ設定
model3.jsonでLipSyncグループが定義されています：

```json
{
  "Groups": [
    {
      "Target": "Parameter",
      "Name": "LipSync", 
      "Ids": [
        "ParamMouthOpenY"  // 口の開閉パラメータ
      ]
    }
  ]
}
```

### 4.3 音声再生とリップシンク
```typescript
// 音声URLを指定してリップシンク付き再生
await model.speak(audioUrl: string)

// 例：
await model.speak("/live2d/Resources/Haru/sounds/haru_talk_13.wav");
```

### 4.4 従来の音声再生との違い
```typescript
// ❌ リップシンクなし
const audio = new Audio(audioUrl);
audio.play();

// ✅ リップシンクあり  
await model.speak(audioUrl);
```

## 5. 実装例

### 5.1 基本的な実装パターン
```typescript
const Live2DComponent = () => {
  const [model, setModel] = useState<Live2DModel | null>(null);

  // モーション再生
  const playMotion = (group: string, index: number) => {
    if (model) {
      model.motion(group, index, 3);
    }
  };

  // 表情変更
  const playExpression = (expressionName: string) => {
    if (model) {
      model.expression(expressionName);
    }
  };

  // リップシンク付き音声再生
  const playSound = async (soundFile: string) => {
    if (model) {
      const audioUrl = `/live2d/Resources/Haru/sounds/${soundFile}`;
      try {
        await model.speak(audioUrl);
      } catch (error) {
        console.error('音声再生エラー:', error);
      }
    }
  };
};
```

### 5.2 UIボタンとの連携
```typescript
// モーション定義
const motions = [
  { name: "アイドル", group: "Idle", index: 0 },
  { name: "タップ", group: "TapBody", index: 0 }
];

// 表情定義
const expressions = [
  { name: "表情1", file: "F01" },
  { name: "表情2", file: "F02" }
];

// 音声定義
const sounds = [
  { name: "挨拶", file: "haru_talk_13.wav" },
  { name: "情報", file: "haru_Info_04.wav" }
];
```

## 6. トラブルシューティング

### 6.1 よくある問題と解決方法

#### モーションが再生されない
- **原因**: グループ名やインデックスが間違っている
- **解決**: model3.jsonでMotionsセクションを確認

#### 表情が変わらない
- **原因**: 表情名が間違っている
- **解決**: model3.jsonでExpressionsセクションを確認

#### リップシンクが動作しない
- **原因**: 
  - `model.speak()`ではなく`new Audio()`を使用している
  - 音声ファイルが見つからない
  - LipSyncパラメータが設定されていない
- **解決**: 
  - `model.speak()`を使用する
  - 音声ファイルのパスを確認
  - model3.jsonのGroupsセクションでLipSyncグループを確認

#### Cubism 4 runtimeエラー
- **原因**: live2dcubismcore.jsが読み込まれていない
- **解決**: Next.js Scriptコンポーネントで事前読み込み

### 6.2 デバッグ方法
```typescript
// モデルの状態確認
console.log('Model loaded:', !!model);
console.log('Available motions:', model?.definitions?.motions);
console.log('Available expressions:', model?.definitions?.expressions);

// 再生状況の確認
model.on('motionStart', (group, index) => {
  console.log(`Motion started: ${group}[${index}]`);
});

model.on('expressionStart', (name) => {
  console.log(`Expression started: ${name}`);
});
```

## 7. パフォーマンス最適化

### 7.1 推奨事項
- **事前読み込み**: よく使用する音声ファイルは事前にキャッシュ
- **優先度管理**: 重要でないモーションは低優先度で再生
- **メモリ管理**: 不要なモデルは適切に破棄

### 7.2 実装例
```typescript
// 音声ファイルの事前読み込み
const preloadAudio = async (audioUrls: string[]) => {
  const promises = audioUrls.map(url => {
    return new Promise((resolve) => {
      const audio = new Audio(url);
      audio.addEventListener('canplaythrough', resolve);
      audio.load();
    });
  });
  await Promise.all(promises);
};
```

## 8. まとめ

Live2Dシステムの各要素：
- **モーション**: グループとインデックスで管理、優先度制御可能
- **表情**: 名前で管理、独立して動作
- **リップシンク**: `model.speak()`で音声と口の動きを自動同期

これらの機能を組み合わせることで、豊かな表現力を持つLive2Dキャラクターを実現できます。
