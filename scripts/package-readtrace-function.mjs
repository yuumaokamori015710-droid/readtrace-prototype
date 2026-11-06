import { copyFile } from "node:fs/promises";

const source = new URL("../outputs/readtrace-books.mjs", import.meta.url);
const target = new URL("../supabase/functions/readtrace-books/books.mjs", import.meta.url);
await copyFile(source, target);
console.log("Packaged the shared catalog provider for Supabase Edge Functions.");
