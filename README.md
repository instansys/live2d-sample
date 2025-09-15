
## VOICEVOX音声合成システム

### 概要
このアプリケーションは、Claude AIとVOICEVOX音声合成を統合し、Live2Dキャラクターが話すチャットシステムを実装しています。

### システム構成

#### 1. チャットフロー全体
```
ユーザー入力 → Claude API → VOICEVOX音声生成 → Live2D音声再生
```

#### 2. フロントエンド (src/app/page.tsx)
- **チャットUI**: テキスト入力とメッセージ履歴表示
- **状態管理**: 
  - `inputText`: 入力中のテキスト
  - `messages`: チャット履歴（ユーザーとアシスタントのメッセージ）
  - `isLoading`: 処理中状態
- **送信処理**: `handleSendMessage()` で `/api/chat` へリクエスト
- **音声再生**: レスポンスの `audioUrl` を `model.speak()` で再生

#### 3. バックエンド (src/app/api/chat/route.ts)

##### Claude AI応答生成
```typescript
const response = await generateText({
  model: anthropic("claude-3-5-sonnet-20240620"),
  messages,
});
```

##### VOICEVOX音声合成プロセス
1. **音声クエリ作成** (`/audio_query`)
   ```typescript
   const queryResponse = await fetch(
     `${VOICEVOX_BASE_URL}/audio_query?speaker=${SPEAKER_ID}&text=${encodeURIComponent(text)}`
   );
   ```
   - `SPEAKER_ID = 1` (ずんだもん)
   - テキストをURLエンコードして送信

2. **音声合成実行** (`/synthesis`)
   ```typescript
   const synthesisResponse = await fetch(
     `${VOICEVOX_BASE_URL}/synthesis?speaker=${SPEAKER_ID}`,
     {
       method: "POST",
       body: JSON.stringify(queryData),
     }
   );
   ```
   - 前ステップのクエリデータを使用して音声生成

3. **Base64データURL変換**
   ```typescript
   const audioBuffer = await synthesisResponse.arrayBuffer();
   const audioBase64 = Buffer.from(audioBuffer).toString('base64');
   return `data:audio/wav;base64,${audioBase64}`;
   ```

#### 4. Live2D音声再生統合
- **リップシンク**: `model.speak(audioUrl)` でVOICEVOX生成音声を再生
- **自動同期**: 口の動きが音声に自動的に同期
- **エラーハンドリング**: 音声生成失敗時もテキストは表示

### 環境要件

#### VOICEVOX サーバー
- **必須**: `localhost:50021` でVOICEVOXエンジンが起動中
- **話者**: ID=1（ずんだもん）を使用
- **API**: `/audio_query` と `/synthesis` エンドポイントが利用可能

#### 環境変数
```
ANTHROPIC_API_KEY=your_anthropic_api_key
```

### 使用方法

#### 開発環境セットアップ
1. VOICEVOXアプリケーションを起動
2. `npm run dev` でNext.jsサーバー起動
3. チャット入力欄にメッセージ入力
4. Live2DキャラクターがClaude応答をずんだもんの声で発話

#### トラブルシューティング

##### VOICEVOX接続エラー
- VOICEVOXアプリケーションが起動しているか確認
- `localhost:50021` でアクセス可能か確認
- ファイアウォール設定を確認

##### 音声が再生されない
- ブラウザの自動再生ポリシーを確認
- `model.speak()` のエラーログを確認
- Base64データURLの形式を確認

##### Claude API エラー
- `ANTHROPIC_API_KEY` の設定を確認
- API制限に達していないか確認

### 技術仕様

#### API レスポンス形式
```json
{
  "message": "Claude AIの応答テキスト",
  "audioUrl": "data:audio/wav;base64,..." 
}
```

#### 音声品質
- **フォーマット**: WAV
- **話者**: ずんだもん（ID=1）
- **エンコード**: Base64データURL
- **配信**: インライン（ストリーミングなし）
