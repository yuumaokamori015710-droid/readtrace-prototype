import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

async function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  const text = await readFile(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim().replace(/^["']|["']$/g, "");
    if (process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

await loadDotEnv(join(root, ".env"));

const port = Number(process.env.PORT || 8010);
const googleBooksApiKey = normalizeSecret(process.env.GOOGLE_BOOKS_API_KEY || "");
const googleBooksProxy = normalizeSecret(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function googleBooks(query) {
  if (!googleBooksApiKey) {
    return Promise.resolve({
      items: [],
      error: "GOOGLE_BOOKS_API_KEY is not configured",
    });
  }

  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", "20");
  url.searchParams.set("printType", "books");
  url.searchParams.set("country", "JP");

  if (googleBooksProxy) {
    return requestJsonThroughProxy(url, googleBooksProxy);
  }

  return new Promise((resolve) => {
    const request = https.get(url, {
      timeout: 7000,
      headers: {
        "x-goog-api-key": googleBooksApiKey,
      },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          let message = `Google Books API returned ${response.statusCode}`;
          try {
            const parsed = JSON.parse(body);
            message = parsed.error?.message || message;
          } catch {
            // Keep the status-based message.
          }
          resolve({ items: [], error: message });
          return;
        }
        try {
          const data = JSON.parse(body);
          resolve({ items: data.items || [] });
        } catch {
          resolve({ items: [], error: "Google Books API response was not JSON" });
        }
      });
    });

    request.on("timeout", () => {
      request.destroy();
      resolve({ items: [], error: "Google Books API timeout" });
    });
    request.on("error", (error) => {
      resolve({ items: [], error: error.message || "Google Books API network unavailable" });
    });
  });
}

function normalizeSecret(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed.startsWith("replace_with_") || trimmed === "your_key_here") {
    return "";
  }
  return trimmed;
}

function decodeChunkedBody(text) {
  let offset = 0;
  let result = "";
  while (offset < text.length) {
    const lineEnd = text.indexOf("\r\n", offset);
    if (lineEnd === -1) break;
    const sizeText = text.slice(offset, lineEnd).split(";", 1)[0].trim();
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size) || size < 0) break;
    if (size === 0) return result;
    offset = lineEnd + 2;
    result += text.slice(offset, offset + size);
    offset += size + 2;
  }
  return result || text;
}

function parseHttpResponse(buffer) {
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd === -1) {
    return { statusCode: 0, headers: {}, body: buffer };
  }
  const headerText = buffer.slice(0, headerEnd);
  const bodyText = buffer.slice(headerEnd + 4);
  const [statusLine, ...headerLines] = headerText.split("\r\n");
  const statusCode = Number(statusLine.match(/\s(\d{3})\s/)?.[1] || 0);
  const headers = Object.fromEntries(
    headerLines
      .map((line) => line.match(/^([^:]+):\s*(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key.toLowerCase(), value])
  );
  const body = headers["transfer-encoding"]?.toLowerCase().includes("chunked")
    ? decodeChunkedBody(bodyText)
    : bodyText;
  return { statusCode, headers, body };
}

function jsonResultFromGoogleResponse(statusCode, body) {
  if (statusCode < 200 || statusCode >= 300) {
    let message = `Google Books API returned ${statusCode}`;
    try {
      const parsed = JSON.parse(body);
      message = parsed.error?.message || message;
    } catch {
      // Keep the status-based message.
    }
    return { items: [], error: message };
  }

  try {
    const data = JSON.parse(body);
    return { items: data.items || [] };
  } catch {
    return { items: [], error: "Google Books API response was not JSON" };
  }
}

function requestJsonThroughProxy(targetUrl, proxyUrlText) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let proxyUrl;
    try {
      proxyUrl = new URL(proxyUrlText);
    } catch {
      finish({ items: [], error: "HTTPS_PROXY is not a valid URL" });
      return;
    }

    const proxyPort = Number(proxyUrl.port || (proxyUrl.protocol === "https:" ? 443 : 80));
    const proxySocket = net.connect(proxyPort, proxyUrl.hostname);
    proxySocket.setTimeout(7000);

    proxySocket.once("connect", () => {
      const headers = [
        `CONNECT ${targetUrl.hostname}:443 HTTP/1.1`,
        `Host: ${targetUrl.hostname}:443`,
        "Connection: close",
      ];
      if (proxyUrl.username || proxyUrl.password) {
        const auth = Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`).toString("base64");
        headers.push(`Proxy-Authorization: Basic ${auth}`);
      }
      proxySocket.write(`${headers.join("\r\n")}\r\n\r\n`);
    });

    let connectBuffer = "";
    proxySocket.on("data", function onConnectData(chunk) {
      connectBuffer += chunk.toString("utf8");
      if (!connectBuffer.includes("\r\n\r\n")) return;

      proxySocket.off("data", onConnectData);
      const connectStatus = Number(connectBuffer.match(/^HTTP\/\d\.\d\s+(\d{3})/i)?.[1] || 0);
      if (connectStatus !== 200) {
        proxySocket.destroy();
        finish({ items: [], error: `Proxy CONNECT returned ${connectStatus || "an invalid response"}` });
        return;
      }

      const tlsSocket = tls.connect({ socket: proxySocket, servername: targetUrl.hostname });
      tlsSocket.setTimeout(7000);
      const responseChunks = [];

      tlsSocket.once("secureConnect", () => {
        const requestPath = `${targetUrl.pathname}${targetUrl.search}`;
        tlsSocket.write([
          `GET ${requestPath} HTTP/1.1`,
          `Host: ${targetUrl.hostname}`,
          "Accept: application/json",
          `x-goog-api-key: ${googleBooksApiKey}`,
          "Connection: close",
          "",
          "",
        ].join("\r\n"));
      });

      tlsSocket.on("data", (chunk) => responseChunks.push(chunk));
      tlsSocket.on("end", () => {
        const text = Buffer.concat(responseChunks).toString("utf8");
        const parsed = parseHttpResponse(text);
        finish(jsonResultFromGoogleResponse(parsed.statusCode, parsed.body));
      });
      tlsSocket.on("timeout", () => {
        tlsSocket.destroy();
        finish({ items: [], error: "Google Books API timeout through proxy" });
      });
      tlsSocket.on("error", (error) => {
        finish({ items: [], error: error.message || "Google Books API proxy request failed" });
      });
    });

    proxySocket.on("timeout", () => {
      proxySocket.destroy();
      finish({ items: [], error: "Proxy connection timeout" });
    });
    proxySocket.on("error", (error) => {
      finish({ items: [], error: error.message || "Proxy connection failed" });
    });
  });
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/api/books") {
      const query = url.searchParams.get("q") || "";
      const result = query.trim().length >= 2 ? await googleBooks(query) : { items: [] };
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify(result));
      return;
    }

    const pathname = url.pathname === "/" ? "/reading-prototype.html" : url.pathname;
    const filePath = join(root, pathname.replace(/^\/+/, ""));
    const content = await readFile(filePath);
    response.writeHead(200, {
      "content-type": mime[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(content);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`ReadTrace prototype: http://127.0.0.1:${port}/reading-prototype.html`);
  console.log(`Google Books API key: ${googleBooksApiKey ? "configured" : "not configured"}`);
  console.log(`Proxy: ${googleBooksProxy ? "configured" : "not configured"}`);
});
