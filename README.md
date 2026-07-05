# ReadTrace Prototype

読書実績の可視化と、X/Twitter向けの感想文生成を試す静的プロトタイプです。

## Local

```powershell
cd outputs
node reading-prototype-server.mjs
```

Open:

```text
http://127.0.0.1:8011/reading-prototype.html
```

## GitHub Pages

This repository deploys the static `outputs` directory with GitHub Actions.

The GitHub Pages version does not run the local `/api/books` proxy. It falls back
to the built-in sample catalog when external book search is unavailable.
