import { canonicalIsbn } from "./readtrace-books.mjs";
import { ratingSummary } from "./readtrace-record.mjs";

const normalize = value => String(value || "").normalize("NFKC").toLocaleLowerCase("ja").replace(/[\p{P}\p{Z}\s]/gu, "");
const creatorKey = value => normalize(String(value || "").replace(/[\s,，、]*\d{4}\s*[-–−]\s*\d{0,4}$/u, ""));
const creators = work => String(work.creator || "").split(/[、;；]/u).map(creatorKey).filter(name => name.length > 2);
function sameCreator(a, b) {
  const left = creatorKey(a.creator), right = creatorKey(b.creator);
  return Boolean(left && right && (left === right || creators(a).some(name => creators(b).includes(name))));
}
export function sameWork(a, b) {
  if (a.type !== b.type) return false;
  if (a.id && a.id === b.id) return true;
  const isbn = canonicalIsbn(a.isbn13 || a.isbn);
  if (isbn && isbn === canonicalIsbn(b.isbn13 || b.isbn)) return true;
  if (!a.title || normalize(a.title) !== normalize(b.title)) return false;
  const sameYear = a.year && b.year && String(a.year) === String(b.year);
  if (a.type === "movie" && a.year && b.year && !sameYear) return false;
  return Boolean(sameCreator(a, b) || (a.type === "movie" && sameYear && (!a.creator || !b.creator)));
}

const categories = [
  ["SF", /\bsf\b|science fiction|sci.fi|サイエンス.?フィクション/iu],
  ["ファンタジー", /fantasy|ファンタジー/iu],
  ["ミステリー", /mystery|ミステリ|推理|サスペンス|thriller|犯罪/iu],
  ["歴史・社会", /history|歴史|社会|伝記|biograph/iu],
  ["仕事・学び", /仕事|習慣|学び|デザイン|business|ビジネス|self.help|自己啓発/iu],
  ["思想・心理", /哲学|心理|思想|philosoph|psycholog/iu],
  ["恋愛", /romance|恋愛|ロマンス/iu],
  ["音楽", /music|音楽|ミュージカル/iu],
  ["アニメ", /animat|アニメ/iu],
  ["コメディ", /comedy|コメディ/iu],
  ["ドラマ", /drama|ドラマ/iu],
  ["小説", /fiction|小説/iu],
  ["エッセイ・紀行", /essay|エッセイ|紀行/iu],
];
function genres(work, catalog) {
  const local = catalog.find(candidate => sameWork(candidate, work));
  const metadata = [work.genre, local?.genre, work.type === "movie" ? work.description : ""].filter(Boolean).join(" / ");
  return categories.filter(([, pattern]) => pattern.test(metadata)).map(([name]) => name);
}
function signals(type, records, catalog) {
  return records.filter(r => r.work.type === type && ["done", "want"].includes(r.status)).map(record => {
    const { average, legacy, count } = ratingSummary(record);
    const score = average ?? legacy;
    const high = record.status === "done" && score >= 4;
    const weight = record.status === "want" ? 0.55
      : score !== null && score < 3 ? -1.25
      : high ? (4 + (score - 4) * 2) * (count === 5 ? 1 : count ? 0.8 : 0.85)
      : 1.15;
    return { record, genres: genres(record.work, catalog), weight, high };
  });
}
export function recommendationQuery(type, records, catalog) {
  const weights = new Map();
  for (const signal of signals(type, records, catalog)) {
    for (const genre of signal.genres) weights.set(genre, (weights.get(genre) || 0) + signal.weight);
  }
  const leading = [...weights].filter(([, score]) => score > 0).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (type === "book") return ({ "歴史・社会": "歴史", "仕事・学び": "ビジネス", "思想・心理": "心理学", "エッセイ・紀行": "エッセイ", "恋愛": "恋愛小説", "SF": "SF小説" })[leading] || leading || "日本 小説";
  return ({ "SF": "メッセージ", "ファンタジー": "千と千尋の神隠し", "ミステリー": "怪物", "恋愛": "ラ・ラ・ランド", "音楽": "セッション", "アニメ": "もののけ姫", "歴史・社会": "グリーンブック", "コメディ": "マイ・インターン" })[leading] || "PERFECT DAYS";
}
export function rankRecommendations({ type, records, catalog, fetched = [], added = [] }) {
  const mine = records.filter(r => r.work.type === type);
  const preferences = signals(type, mine.filter(r => !added.some(work => sameWork(work, r.work))), catalog);
  const pool = [];
  for (const candidate of [...fetched, ...catalog]) {
    if (candidate.type !== type || !candidate.title || !candidate.id) continue;
    const index = pool.findIndex(work => sameWork(work, candidate));
    if (index === -1) pool.push(candidate);
    else if (!pool[index].image && candidate.image) pool[index] = { ...pool[index], image: candidate.image };
  }
  const scored = pool.flatMap(work => {
    const saved = mine.find(r => sameWork(r.work, work));
    if (saved && !added.some(candidate => sameWork(candidate, work))) return [];
    const tags = genres(work, catalog);
    let score = 0, strongest = 0, reason = tags[0] ? tags[0] + "の候補" : type === "book" ? "本の候補" : "映画の候補";
    for (const signal of preferences) {
      const creator = sameCreator(work, signal.record.work);
      const genre = tags.find(tag => signal.genres.includes(tag));
      const exactGenre = work.genre && normalize(work.genre) === normalize(signal.record.work.genre);
      const match = creator ? 1.8 : genre ? exactGenre ? 1.2 : 1 : 0;
      const value = signal.weight * match;
      score += value;
      if (value > strongest) {
        strongest = value;
        const field = creator ? (type === "book" ? "同じ著者" : "同じ監督") : genre;
        reason = signal.high ? (creator ? "高評価作品と" + field : "高評価の" + field + "作品から")
          : signal.record.status === "want" ? "保存した作品に近い" + field
          : field + "の記録から";
      }
    }
    return [{ work, score, reason, saved: Boolean(saved), genre: tags[0] || "" }];
  });
  scored.sort((a, b) => b.score - a.score);
  if (scored.some(item => item.score !== 0)) return scored;
  const seen = new Set(), diverse = [], rest = [];
  for (const item of scored) {
    if (seen.has(item.genre)) rest.push(item);
    else { seen.add(item.genre); diverse.push(item); }
  }
  return [...diverse, ...rest];
}
