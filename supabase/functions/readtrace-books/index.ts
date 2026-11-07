import { XMLParser } from "npm:fast-xml-parser@5.12.0";
import { createCatalogHandler } from "./catalog-handler.mjs";
const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, processEntities: false });
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
Deno.serve(createCatalogHandler({
  url: Deno.env.get("SUPABASE_URL") || "",
  serviceKey: secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  clientKey: Deno.env.get("READTRACE_PUBLISHABLE_KEY") || "sb_publishable_CmXbWEbuTHkTm38BCK7Hiw_j0TaNR6u",
  googleKey: Deno.env.get("GOOGLE_BOOKS_API_KEY") || "",
  parseXml(xml: string) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Unsupported XML document");
    return parser.parse(xml);
  },
}));
