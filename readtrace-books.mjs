export const BOOK_PAGE_SIZE = 18;
export const discoverySections = [
  { id: "spotlight", title: "いま見つけたい本", query: "日本 小説" },
  { id: "fiction", title: "小説の本棚", query: "小説" },
  { id: "business", title: "ビジネス・自己啓発", query: "ビジネス" },
  { id: "mystery", title: "ミステリー", query: "ミステリー" },
  { id: "fantasy", title: "SF・ファンタジー", query: "ファンタジー" },
  { id: "history", title: "歴史・教養", query: "歴史" },
  { id: "recent", title: "刊行の新しい本", query: "小説", order: "newest" },
];

export function canonicalIsbn(value) {
  const isbn = String(value || "").replace(/[^\dX]/gi, "").toUpperCase();
  if (isbn.length === 13 && /^\d+$/.test(isbn)) {
    const sum = [...isbn.slice(0, 12)].reduce((n, c, i) => n + Number(c) * (i % 2 ? 3 : 1), 0);
    return (10 - sum % 10) % 10 === Number(isbn[12]) ? isbn : "";
  }
  if (/^\d{9}[\dX]$/.test(isbn)) {
    if ([...isbn].reduce((n, c, i) => n + (c === "X" ? 10 : Number(c)) * (10 - i), 0) % 11) return "";
    const first = `978${isbn.slice(0, 9)}`;
    const sum = [...first].reduce((n, c, i) => n + Number(c) * (i % 2 ? 3 : 1), 0);
    return first + (10 - sum % 10) % 10;
  }
  return "";
}
const text = (value) => String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const array = (value) => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
const scalar = (value) => { value = Array.isArray(value) ? value[0] : value; return text(typeof value === "object" ? value?.["#text"] : value); };
export function safeImage(value) {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href.replace(/^http:/, "https:") : ""; } catch { return ""; }
}
export function workIdentity(work) {
  return `${work.type}:${canonicalIsbn(work.isbn13 || work.isbn) || work.id}`;
}
export function normalizeGoogle(item) {
  const v = item.volumeInfo || {};
  const isbn = array(v.industryIdentifiers).map((i) => canonicalIsbn(i.identifier)).find(Boolean) || "";
  return {
    id: `google:${item.id}`, type: "book", title: text(v.title), creator: array(v.authors).map(text).join("・"),
    isbn13: isbn, isbn, image: safeImage(v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail),
    publisher: text(v.publisher), publishedAt: text(v.publishedDate), year: Number.parseInt(v.publishedDate) || null,
    description: text(v.description), genre: array(v.categories).map(text).join(" / "), language: v.language || "",
    source: "Google Books", sourceUrl: safeImage(v.infoLink || `https://books.google.com/books?id=${encodeURIComponent(item.id)}`),
  };
}
export function normalizeOpenLibrary(item) {
  const edition = item.editions?.docs?.[0] || {};
  const identifiers = [...array(edition.isbn), ...array(item.isbn)];
  const isbn = identifiers.map(canonicalIsbn).find((i) => i.startsWith("9784") || i.startsWith("9794")) || identifiers.map(canonicalIsbn).find(Boolean) || "";
  const coverId = edition.cover_i || item.cover_i;
  return {
    id: `openlibrary:${item.key}`, type: "book", title: text(edition.title || item.title), creator: array(item.author_name).map(text).join("・"),
    isbn13: isbn, isbn, image: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false` : isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false` : "",
    publisher: text(array(edition.publisher || item.publisher)[0]), publishedAt: text(array(edition.publish_date)[0] || item.first_publish_year),
    year: item.first_publish_year || null, description: text(item.description?.value || item.description || item.first_sentence?.[0]),
    genre: array(item.subject).slice(0, 2).join(" / "), language: array(edition.language || item.language).includes("jpn") ? "ja" : "",
    source: "Open Library", sourceUrl: `https://openlibrary.org${item.key?.startsWith("/") ? item.key : `/works/${item.key}`}`,
  };
}
export function normalizeNdl(item) {
  const identifiers = array(item.identifier).map(scalar);
  const isbn = identifiers.map(canonicalIsbn).find(Boolean) || "";
  const title = scalar(item.title);
  const link = scalar(item.link || item.guid);
  const published = scalar(item.issued || item.date);
  return {
    id: `ndl:${isbn || link || title}`, type: "book", title, creator: array(item.creator || item.author).map(scalar).join("・"),
    isbn13: isbn, isbn, image: isbn ? `https://ndlsearch.ndl.go.jp/thumbnail/${isbn}.jpg` : "",
    publisher: scalar(item.publisher), publishedAt: published, year: Number.parseInt(published) || null,
    description: array(item.description).map(scalar).filter((v) => !/^ISBN|^資料種別/.test(v)).join(" "),
    genre: "", language: ({ jpn: "ja", eng: "en", chi: "zh" })[scalar(item.language)] || "", source: "国立国会図書館サーチ", sourceUrl: safeImage(link),
  };
}
export function normalizeMovie(item) {
  return { id: `itunes:${item.trackId}`, type: "movie", title: text(item.trackName), creator: text(item.artistName),
    image: "", year: Number.parseInt(item.releaseDate) || null,
    publishedAt: String(item.releaseDate || "").slice(0, 10), publisher: "", genre: text(item.primaryGenreName),
    description: text(item.longDescription || item.shortDescription), source: "Apple iTunes", sourceUrl: safeImage(item.trackViewUrl) };
}
export function mergeBooks(...lists) {
  const result = [], byKey = new Map();
  for (const work of lists.flat()) {
    if (!work?.title || !work.id) continue;
    const key = workIdentity(work);
    const previous = byKey.get(key);
    if (previous) {
      if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(work.title) && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(previous.title)) previous.title = work.title;
      for (const field of ["image", "publisher", "publishedAt", "description", "creator", "language"]) if (!previous[field] && work[field]) previous[field] = work[field];
      previous.source = [...new Set(`${previous.source} / ${work.source}`.split(" / "))].join(" / ");
    } else { const copy = { ...work }; byKey.set(key, copy); result.push(copy); }
  }
  return result;
}
export function parseBrowserXml(xml) {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("Invalid XML");
  return { rss: { channel: { item: [...document.querySelectorAll("item")].map((node) => {
    const values = {};
    for (const child of node.children) (values[child.localName] ||= []).push(child.textContent);
    return values;
  }), totalResults: document.getElementsByTagNameNS("*", "totalResults")[0]?.textContent } } };
}

export function createBookProvider({ fetcher = fetch, parseXml, googleKey = "", pause = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const cache = new Map();
  let lastOpenLibrary = 0, googleRetryAt = 0, lastMovie = 0, movieQueue = Promise.resolve(), openLibraryQueue = Promise.resolve();
  async function request(url, format = "json", signal) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) controller.abort();
    const timeout = setTimeout(cancel, 11000);
    try {
      const response = await fetcher(url, { signal: controller.signal, headers: { Accept: format === "json" ? "application/json" : "application/xml", ...(url.hostname === "www.wikidata.org" ? { "Api-User-Agent": "ReadTrace/1.0 (https://github.com/yuumaokamori015710-droid/readtrace-prototype)" } : {}) } });
      if (!response.ok) { const error = new Error(`HTTP ${response.status}`); error.status = response.status; throw error; }
      return format === "json" ? await response.json() : parseXml(await response.text());
    } finally { clearTimeout(timeout); signal?.removeEventListener("abort", cancel); }
  }
  async function search({ query, field = "all", page = 1, order = "relevance", signal } = {}) {
    query = String(query || "").normalize("NFKC").trim().slice(0, 160);
    if (!query) return { items: [], hasMore: false, warnings: [], sources: [] };
    page = Math.max(1, Math.min(50, Number(page) || 1));
    field = ["title", "author", "isbn"].includes(field) ? field : "all";
    const isbn = canonicalIsbn(query);
    if (field === "isbn" && !isbn) throw new Error("ISBNはチェック桁を含む10桁または13桁で入力してください。");
    if (isbn) { field = "isbn"; query = isbn; }
    const cacheKey = JSON.stringify([query, field, page, order]);
    if (cache.has(cacheKey) && cache.get(cacheKey).expires > Date.now()) return structuredClone(cache.get(cacheKey).value);
    const warnings = [], sources = [], lists = [];
    let hasMore = false;
    const japanese = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(query);
    if (Date.now() >= googleRetryAt) {
      try {
        const url = new URL("https://www.googleapis.com/books/v1/volumes");
        url.search = new URLSearchParams({ q: `${{ title: "intitle:", author: "inauthor:", isbn: "isbn:" }[field] || ""}${query}`, startIndex: String((page - 1) * BOOK_PAGE_SIZE), maxResults: String(BOOK_PAGE_SIZE), printType: "books", orderBy: order === "newest" ? "newest" : "relevance", ...(japanese ? { langRestrict: "ja" } : {}), ...(googleKey ? { key: googleKey } : {}) }).toString();
        const data = await request(url, "json", signal);
        lists.push((data.items || []).map(normalizeGoogle)); sources.push("Google Books");
        hasMore ||= (page * BOOK_PAGE_SIZE) < (data.totalItems || 0);
      } catch (error) { if (signal?.aborted) throw error; if ([400, 403, 429].includes(error.status)) googleRetryAt = Date.now() + 300000; warnings.push("Google Booksを利用できないため、別の書誌データで補完しています。"); }
    } else warnings.push("Google Booksの制限中のため、別の書誌データで補完しています。");
    try {
      const url = new URL("https://openlibrary.org/search.json");
      url.search = new URLSearchParams({ [field === "all" ? "q" : field]: query, page: String(page), limit: String(BOOK_PAGE_SIZE), lang: "ja", fields: "key,title,author_name,isbn,cover_i,publisher,first_publish_year,language,editions,first_sentence", ...(order === "newest" ? { sort: "new" } : {}) }).toString();
      const job = openLibraryQueue.then(async () => {
        const delay = 1100 - (Date.now() - lastOpenLibrary);
        if (delay > 0) await pause(delay);
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        lastOpenLibrary = Date.now();
        return request(url, "json", signal);
      });
      openLibraryQueue = job.catch(() => {});
      const data = await job;
      lists.push((data.docs || []).map(normalizeOpenLibrary)); sources.push("Open Library");
      hasMore ||= page * BOOK_PAGE_SIZE < (data.numFound || data.num_found || 0);
    } catch (error) { if (signal?.aborted) throw error; warnings.push("Open Libraryに接続できませんでした。"); }
    if (parseXml && (japanese || field === "isbn")) {
      try {
        const url = new URL("https://ndlsearch.ndl.go.jp/api/opensearch");
        url.search = new URLSearchParams({ [field === "author" ? "creator" : field === "isbn" ? "isbn" : field === "title" ? "title" : "any"]: query, cnt: String(BOOK_PAGE_SIZE), idx: String((page - 1) * BOOK_PAGE_SIZE + 1), dpid: "iss-ndl-opac", ...(order === "newest" ? { from: `${new Date().getFullYear() - 1}-01-01` } : {}) }).toString();
        const data = await request(url, "xml", signal);
        const channel = data.rss?.channel || {};
        const items = array(channel.item).map(normalizeNdl);
        lists.push(items); sources.push("国立国会図書館サーチ");
        hasMore ||= page * BOOK_PAGE_SIZE < Number(scalar(channel.totalResults) || items.length);
      } catch (error) { if (signal?.aborted) throw error; warnings.push("日本語書誌の補完先に接続できませんでした。"); }
    }
    if (!sources.length) throw new Error("書誌サービスに接続できませんでした。接続を確認して再検索するか、手入力で追加してください。");
    let items = mergeBooks(...lists);
    if (japanese) { const score = (w) => Number(w.language === "ja") * 2 + Number(/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(w.title)); items.sort((a, b) => score(b) - score(a)); }
    if (order === "newest") items.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
    const value = { items, hasMore: hasMore && items.length > 0, warnings, sources };
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, { expires: Date.now() + (warnings.some((w) => /Open Library|日本語書誌/.test(w)) ? 30000 : 600000), value });
    return structuredClone(value);
  }
  async function movies({ query, signal } = {}) {
    query = String(query || "映画").trim().slice(0, 160);
    const cacheKey = `movie:${query}`;
    if (cache.get(cacheKey)?.expires > Date.now()) return structuredClone(cache.get(cacheKey).value);
    const job = movieQueue.then(async () => {
      const wait = 3100 - (Date.now() - lastMovie);
      if (wait > 0) await pause(wait);
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      lastMovie = Date.now();
      const url = new URL("https://itunes.apple.com/search");
      url.search = new URLSearchParams({ term: query, country: "jp", lang: "ja_jp", entity: "movie", limit: "48" }).toString();
      let items = [], warnings = [], source = "Apple iTunes";
      try { const data = await request(url, "json", signal); items = (data.results || []).map(normalizeMovie).filter((w) => w.title); }
      catch (error) { if (signal?.aborted) throw error; warnings.push("配信カタログを取得できなかったため、映画の書誌情報で補完しています。"); }
      if (!items.length) {
        items = await wikiMovies(query, signal);
        source = "Wikidata";
      }
      const result = { items, hasMore: false, warnings, sources: [source] };
      if (cache.size > 100) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, { expires: Date.now() + 600000, value: result });
      return result;
    });
    movieQueue = job.catch(() => {});
    return job;
  }
  async function wikiMovies(query, signal) {
    const url = new URL("https://www.wikidata.org/w/api.php");
    url.search = new URLSearchParams({ action: "wbsearchentities", format: "json", search: query, language: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(query) ? "ja" : "en", uselang: "ja", type: "item", limit: "20", maxlag: "5", origin: "*" }).toString();
    const found = await request(url, "json", signal);
    if (found.error) throw new Error("映画データの取得が混み合っています。");
    const ids = (found.search || []).map((entry) => entry.id).filter((id) => /^Q\d+$/.test(id));
    if (!ids.length) return [];
    const getEntities = async (keys, props) => {
      const endpoint = new URL("https://www.wikidata.org/w/api.php");
      endpoint.search = new URLSearchParams({ action: "wbgetentities", format: "json", ids: keys.join("|"), props, languages: "ja|en", maxlag: "5", origin: "*" }).toString();
      const data = await request(endpoint, "json", signal);
      if (data.error) throw new Error("映画データを取得できませんでした。");
      return data.entities || {};
    };
    const entities = await getEntities(ids, "labels|descriptions|claims");
    const values = (entry, key) => (entry.claims?.[key] || []).map((claim) => claim.mainsnak?.datavalue?.value).filter(Boolean);
    const films = Object.values(entities).filter((entry) => values(entry, "P31").some((value) => ["Q11424", "Q24869", "Q202866", "Q24862", "Q506240"].includes(value.id)));
    const directors = [...new Set(films.flatMap((entry) => values(entry, "P57").map((value) => value.id)))].filter(Boolean).slice(0, 50);
    const names = directors.length ? await getEntities(directors, "labels") : {};
    const label = (entry) => entry?.labels?.ja?.value || entry?.labels?.en?.value || "";
    return films.map((entry) => {
      const dates = values(entry, "P577").map((value) => value.time?.replace(/^\+/, "").slice(0, 10)).filter(Boolean).sort();
      return { id: `wikidata:${entry.id}`, type: "movie", title: text(label(entry)), creator: values(entry, "P57").map((value) => label(names[value.id])).filter(Boolean).join("・"), image: "", publisher: "", publishedAt: dates[0] || "", year: Number.parseInt(dates[0]) || null, description: text(entry.descriptions?.ja?.value || entry.descriptions?.en?.value), source: "Wikidata", sourceUrl: `https://www.wikidata.org/wiki/${entry.id}` };
    }).filter((work) => work.title);
  }
  return { search, movies };
}

export function createBookClient({ endpoint, publishableKey, fetcher = fetch } = {}) {
  const direct = createBookProvider({ fetcher, parseXml: typeof DOMParser !== "undefined" ? parseBrowserXml : undefined });
  const cache = new Map();
  let proxyRetryAt = 0;
  return { async search(options) {
    const { signal, ...parameters } = options;
    const key = JSON.stringify(parameters);
    if (cache.get(key)?.expires > Date.now()) return structuredClone(cache.get(key).value);
    let value;
    if (endpoint && Date.now() >= proxyRetryAt) {
      try {
        const response = await fetcher(endpoint, { method: "POST", headers: { "Content-Type": "application/json", apikey: publishableKey }, body: JSON.stringify(parameters), signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "書誌検索に接続できません。");
        if (!Array.isArray(result.items)) throw new Error("Invalid search response");
        value = result;
      } catch (error) { if (signal?.aborted) throw error; proxyRetryAt = Date.now() + 60000; }
    }
    if (!value) value = options.type === "movie" ? await direct.movies(options) : await direct.search(options);
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    cache.set(key, { expires: Date.now() + 600000, value });
    return value;
  } };
}
