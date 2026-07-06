# ReadTrace Prototype

読書実績の可視化と、X/Twitter向けの感想文生成を試す静的プロトタイプです。

公開版:

```text
https://yuumaokamori015710-droid.github.io/readtrace-prototype/
```

## Book Search

GitHub Pages版でも動くように、APIキー不要の外部APIをブラウザから直接使います。

- Open Library: タイトル検索、著者、ISBN、表紙候補
- openBD: ISBNが分かる本の日本語書誌と書影補正
- ローカルDB: 外部APIが見つからないときのフォールバック

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
