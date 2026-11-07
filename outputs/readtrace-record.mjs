export const IMPRESSION_LIMIT = 20;
export const AXES = [
  { key: "immersion", label: "没入感", book: "どれだけ夢中で読めたか", movie: "どれだけ物語に引き込まれたか" },
  { key: "originality", label: "独創性", book: "視点や発想に驚きがあったか", movie: "視点や発想に驚きがあったか" },
  { key: "structure", label: "構成力", book: "展開や論旨、説明に納得できたか", movie: "展開や説明に納得できたか" },
  { key: "expression", label: "表現力", book: "文章や言葉の選び方が魅力的だったか", movie: "映像・演技・音楽が魅力的だったか" },
  { key: "afterglow", label: "余韻", book: "読後に感情や学びが残ったか", movie: "鑑賞後に感情や学びが残ったか" },
];
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("ja", { granularity: "grapheme" }) : null;
export const impressionLength = text => segmenter ? [...segmenter.segment(text)].length : Array.from(text.normalize("NFC")).length;
export const isHalfStar = value => Number.isFinite(value) && value >= 0.5 && value <= 5 && Number.isInteger(value * 2);
export function readAxes(value) {
  return Object.fromEntries(AXES.filter(({ key }) => isHalfStar(value?.[key])).map(({ key }) => [key, value[key]]));
}
export function ratingSummary(record) {
  const values = Object.values(readAxes(record.axisRatings));
  const count = values.length;
  return {
    count,
    average: count ? values.reduce((sum, value) => sum + value, 0) / count : null,
    legacy: isHalfStar(record.rating) ? record.rating : null,
  };
}
export function impressionError(value, required) {
  if (typeof value !== "string" && value != null) return "一言感想を入力してください。";
  const text = (value || "").trim();
  if (!text && required) return "一言感想を入力してください。";
  if (/[\r\n\u2028\u2029]/u.test(value || "")) return "一言感想は1行で入力してください。";
  if (impressionLength(text) > IMPRESSION_LIMIT) return "一言感想は20文字以内で入力してください。";
  return "";
}
export function localDate(now = new Date()) {
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n, i) => String(n).padStart(i ? 2 : 4, "0")).join("-");
}
export function completionLabel(record) {
  if (record.status !== "done") return "";
  const verb = record.work.type === "book" ? "読了" : "鑑賞";
  return record.completedAt ? record.completedAt.replaceAll("-", ".") + " " + verb : verb + "日不明";
}
export function impressionState(record, revealed = false) {
  if (!record.impression) return { kind: "missing" };
  if (record.spoiler && !revealed) return { kind: "spoiler" };
  return { kind: "text", text: record.impression };
}
