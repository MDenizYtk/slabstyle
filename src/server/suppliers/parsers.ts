import { XMLParser } from "fast-xml-parser";
import { getPath } from "./mapping";

/**
 * Feed ayrıştırıcıları. Hepsi "kayıt listesi" döndürür; alan eşlemesi ayrı yapılır.
 */

/** RFC 4180 uyumlu CSV ayrıştırıcı (tırnaklı alan, kaçış, satır içi yeni satır). */
export function parseCsv(text: string, delimiter = ","): Record<string, string>[] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...data] = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return data.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t", "|"].map((d) => [d, firstLine.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

/** XML feed: itemPath ile kayıt dizisine inilir (ör. "Urunler.Urun"). */
export function parseXmlRecords(text: string, itemPath: string): unknown[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    parseTagValue: false, // barkodların baştaki sıfırları korunmalı
    trimValues: true,
    processEntities: true,
  });
  const doc = parser.parse(text);
  const node = getPath(doc, itemPath);
  if (node == null) return [];
  return Array.isArray(node) ? node : [node];
}

export function parseJsonRecords(text: string, itemPath?: string): unknown[] {
  const doc: unknown = JSON.parse(text);
  const node = itemPath ? getPath(doc, itemPath) : doc;
  if (node == null) return [];
  return Array.isArray(node) ? node : [node];
}
