# Calm Todo

シンプルで美しいオフラインタスク管理アプリ。アカウント登録不要で、データは全てローカルに保存されます。

## 特徴

- **完全オフライン**: データはローカルストレージに保存。インターネット接続不要
- **システムトレイ常駐**: 閉じてもバックグラウンドで動作。トレイからクイック追加
- **カレンダー連携**: ICSエクスポートでGoogleカレンダー・Outlook・Windowsカレンダーに連携
- **AIタスク分解**: Claude APIでタスクをサブタスクに自動分解
- **リマインダー**: 単発・週間リマインダーでタスクを忘れない
- **期日管理**: 期日を過ぎたタスクは通知でお知らせ
- **美しいUI**: Calm Industrialデザイン。目に優しい配色

## スクリーンショット

![Calm Todo](https://raw.githubusercontent.com/haroin57/calm-todo/main/screenshot.png)

## 技術スタック

- **フロントエンド**: React 18, TypeScript, Vite
- **デスクトップ**: Tauri 2.x (Rust)
- **状態管理**: React Hooks + localStorage
- **アニメーション**: Framer Motion
- **AI**: Anthropic Claude API

## インストール

### 必要環境

- Node.js 18+
- Rust (Tauri用)
- Windows 10/11

### 開発環境のセットアップ

1. リポジトリをクローン:
   ```bash
   git clone https://github.com/haroin57/calm-todo.git
   cd calm-todo
   ```

2. 依存関係をインストール:
   ```bash
   npm install
   ```

3. 開発サーバーを起動:
   ```bash
   # Web開発
   npm run dev

   # デスクトップ開発 (Tauri)
   npm run tauri dev
   ```

### ビルド

```bash
# Webビルド
npm run build

# デスクトップビルド
npm run tauri build
```

## 使い方

### タスクの追加

1. 入力欄にタスクを入力してEnterキーまたは「追加」ボタン
2. システムトレイの「+ 新規タスク」からクイック追加も可能

### 期間で整理

- **今日**: 今日やるべきタスク
- **1週間**: 今週中に終わらせるタスク
- **1ヶ月**: 今月中に終わらせるタスク

### カレンダー連携

1. ヘッダーの📅ボタンでカレンダーを開く
2. 「Googleカレンダーに追加」で一括登録
3. 「ICSエクスポート」でOutlook/Windowsカレンダーにインポート

### AI機能

1. 設定画面でAnthropic APIキーを登録
2. タスクの✨ボタンでAIがサブタスクを提案

## キーボードショートカット

| キー | 機能 |
|------|------|
| `n` | 新規タスク入力にフォーカス |
| `?` | ヘルプを表示 |
| `Esc` | モーダルを閉じる |

## ライセンス

MIT
