# ReadTrace Prototype

読書実績の可視化と、X/Twitter向け感想文の生成を試す静的プロトタイプです。

公開版:

```text
https://yuumaokamori015710-droid.github.io/readtrace-prototype/
```

## Book Search

GitHub Pages でも動くように、APIキー不要の外部APIをブラウザから直接使います。

- NDLサーチ: 日本語タイトル検索を優先して取得
- openBD: ISBNが分かる本の日本語書誌と書影補正
- Open Library: 英語・海外タイトル検索、著者、ISBN、表紙候補
- ローカルDB: 外部APIが見つからないときのフォールバック

## Supabase Auth

ログインは Supabase Auth のメールリンク方式です。公開ページ右上のログインから
Supabase Project URL と anon key を保存すると、そのブラウザでログインを試せます。

Supabase SQL Editor で `outputs/supabase-schema.sql` を実行すると、ログインユーザーごとの
本棚保存テーブル `readtrace_books` とRLSポリシーが作成されます。

## Local

```powershell
cd outputs
node reading-prototype-server.mjs
```

Open:

```text
http://127.0.0.1:8011/reading-prototype.html
```

## Deploy

This repository deploys the static `outputs` directory from the `gh-pages`
branch.
