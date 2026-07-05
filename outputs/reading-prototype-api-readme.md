# ReadTrace Prototype: Google Books API

This prototype searches books through a local proxy:

```text
Browser -> /api/books -> Google Books API
```

Do not put the Google Books API key in `reading-prototype.html`.

## Setup

1. Copy `.env.example` to `.env`.
2. Put your Google Books API key in `.env`.

```env
GOOGLE_BOOKS_API_KEY=your_key_here
PORT=8010
# Optional, only when your network requires it:
# HTTPS_PROXY=http://proxy.example.com:8080
```

3. Start the prototype server.

```powershell
.\start-reading-prototype.ps1
```

4. Open:

```text
http://127.0.0.1:8010/reading-prototype.html
```

## Google Cloud

Enable the Books API in Google Cloud Console, then create an API key under Credentials.

Recommended production settings:

- Restrict the key to the Books API.
- Keep the key on the server only.
- Add caching for repeated searches.
- Add rate limiting per user/IP.

## Proxy

Node's built-in `https.get` does not automatically use your OS proxy settings. This
prototype reads `HTTPS_PROXY` or `HTTP_PROXY` from `.env` and uses an HTTP CONNECT
tunnel for Google Books API requests.

Examples:

```env
HTTPS_PROXY=http://127.0.0.1:8080
HTTPS_PROXY=http://user:password@proxy.example.com:8080
```
