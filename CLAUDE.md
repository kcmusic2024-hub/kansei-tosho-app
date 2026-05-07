# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 作業ルール

- **会話は日本語**で行うこと
- コード内の**コメントも日本語**で書くこと
- APIキー・パスワードを含むファイルは GitHub など**共有場所にアップロードしない**こと
- コードを変更したら必ず**ブラウザで動作確認**を行うこと（このプロジェクトはビルド不要のため、`index.html` をブラウザで開いて該当機能をテストする）

## プロジェクト概要

完成図書（竣工図書）作成用Webアプリ。**単一HTMLファイル構成**（`index.html` のみ）。ビルドツール・サーバー不要。ブラウザで直接開くか Vercel 経由で公開。

## デプロイ

- **公開URL:** `https://kansei-tosho-app.vercel.app`
- **GitHubリポジトリ:** `https://github.com/kcmusic2024-hub/kansei-tosho-app`
- `index.html` を GitHub にアップロードすると Vercel が自動デプロイ（数十秒）

### GitHub アップロード手順（PowerShell）

```powershell
$content = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes("C:\Users\DELL\OneDrive\Desktop\完成図書アプリ化\index.html"))
$sha = (gh api repos/kcmusic2024-hub/kansei-tosho-app/contents/index.html | ConvertFrom-Json).sha
gh api repos/kcmusic2024-hub/kansei-tosho-app/contents/index.html -X PUT -f message="update index.html" -f content="$content" -f sha="$sha"
```

## アーキテクチャ

`index.html` は `<style>` → `<body>` → `<script>` の順で完結。外部依存はすべて CDN。

### 使用ライブラリ（CDN）

| ライブラリ | 用途 |
|---|---|
| SheetJS 0.18.5 (cdnjs) | Excel 生成 (`XLSX`) |
| PptxGenJS 3.12.0 (jsdelivr) | PowerPoint 生成 (`PptxGenJS`) |
| jsPDF 2.5.1 (cdnjs) | PDF（実際は印刷ダイアログ利用） |
| html2canvas 1.4.1 (cdnjs) | スクリーンショット（将来用途） |

### タブ構成

| タブ ID | 内容 |
|---|---|
| `pane-basic` | 基本情報（お客様名・拠点名・管理番号・実施日・担当者） |
| `pane-power` | 電源情報・機器設置スペース・備考 |
| `pane-floor` | フロア概略図（手書き取り込み → Gemini 清書 → canvas プレビュー） |
| `pane-photos` | 現地写真（デフォルト 8 枠、追加可） |
| `pane-export` | 出力フォーマット選択・入力確認・保存ボタン |

### JS の主要関数

| 関数 | 役割 |
|---|---|
| `onInput()` | 入力のたびに進捗バーと拠点情報を同期 |
| `syncFloorInfo()` | 基本情報 → フロアタブのお客様名・拠点名を反映 |
| `calcPower()` | 空き電源数を自動計算 |
| `loadFloor(evt)` | 画像を canvas に描画 → Gemini API で清書して上書き |
| `clearFloor()` | canvas・ドロップゾーンをリセット |
| `collectPhotos()` | `#photoGrid` から `{src, name}` 配列を収集 |
| `getData()` | 全入力値をオブジェクトとして返す |
| `saveData()` | フォーマットに応じて Excel/PPT/Word/PDF を保存 |
| `buildDocPage()` | プレビューモーダルの HTML を組み立て |
| `saveGeminiKey()` | Gemini API キーを `localStorage` に保存 |
| `callGeminiSeisho(base64, mimeType)` | Gemini API を呼んで清書画像の dataURL を返す（async） |

### Gemini 清書機能

- モデル: `gemini-2.0-flash-exp-image-generation`
- APIキー: ユーザーがフロアタブで入力 → `localStorage.getItem('geminiApiKey')` で保持
- エンドポイント: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key={KEY}`
- `generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }` が必須
- レスポンスの画像は `candidates[0].content.parts[i].inlineData.data`（base64）

### 出力フォーマット別の実装

- **Excel:** `XLSX.utils.aoa_to_sheet` で行データを書き出し
- **PowerPoint:** スライド1=基本情報表、スライド2=フロア概略図（`floorLoaded` 時）、スライド3以降=現地写真（4枚/スライド・2×2配置）
- **Word:** HTML 文字列を `application/msword` Blob として `.doc` でダウンロード
- **PDF:** `buildDocPage()` でプレビューモーダルを開いて `window.print()` を呼ぶ

### 印刷制御（`@media print`）

ヘッダー・タブナビ・進捗バー・モーダルヘッダーを非表示にし、モーダル内の `.doc-page` だけを印刷する。

## デザイン規則

- メインカラー: `--red: #c0392b`
- セクションタイトル左に赤バー（`card-title::before`）
- 入力フォーカス時: 赤枠 + `box-shadow: 0 0 0 3px rgba(192,57,43,0.12)`

## 素材ファイル

`素材/` フォルダにデザイン参照用スクリーンショット・サンプル画像あり（アプリには含まない）。
