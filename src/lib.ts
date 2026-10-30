// Utilitas inti GezyBlog Admin: parsing frontmatter, placeholder pelindung,
// slug, dan operasi git. Tidak ada rahasia di sini; semua kredensial lewat env.
import { spawn } from "bun";

export const MORE_PLACEHOLDER = "> 🔖 Batas ringkasan — bagian di atas baris ini yang tampil di daftar. Jangan hapus baris ini.";
export const SHORTCODE_PLACEHOLDER_PREFIX = "> 🔖 Blok khusus Hugo";

export interface ProtectedItem {
  key: string;
  original: string;
}

export function parseFile(raw: string): { fm: string; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: "", body: raw };
  return { fm: m[1], body: m[2] };
}

function fmValue(line: string): string {
  const idx = line.indexOf(":");
  return idx >= 0 ? line.slice(idx + 1).trim() : "";
}
function unquote(v: string): string {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    try { return JSON.parse(v); } catch { return v.slice(1, -1); }
  }
  return v;
}
function parseList(v: string): string[] {
  const t = v.trim();
  if (!t.startsWith("[")) return t ? [t] : [];
  try {
    const arr = JSON.parse(t.replace(/'/g, '"'));
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return t.slice(1, -1).split(",").map((s) => unquote(s.trim())).filter(Boolean);
  }
}
function quote(s: string): string {
  return JSON.stringify(s);
}
function listStr(arr: string[]): string {
  return "[" + arr.map((s) => JSON.stringify(s)).join(", ") + "]";
}

export interface PostMeta {
  title: string;
  date: string;
  draft: boolean;
  description: string;
  tags: string[];
  categories: string[];
  featuredImage: string;
  authors: string;
  rawFm: string;
}

export function parseMeta(fm: string): PostMeta {
  const lines = fm.split("\n");
  const get = (key: string): string | null => {
    for (const l of lines) {
      if (l.startsWith(key + ":")) return fmValue(l);
    }
    return null;
  };
  const draftRaw = get("draft");
  return {
    title: unquote(get("title") ?? ""),
    date: get("date") ?? "",
    draft: draftRaw === "true",
    description: unquote(get("description") ?? ""),
    tags: parseList(get("tags") ?? ""),
    categories: parseList(get("categories") ?? ""),
    featuredImage: unquote(get("featuredImage") ?? ""),
    authors: get("authors") ?? "",
    rawFm: fm,
  };
}

export interface MetaUpdate {
  title?: string;
  date?: string;
  draft?: boolean;
  description?: string;
  tags?: string[];
  categories?: string[];
  featuredImage?: string;
}

/** Perbarui hanya field yang diedit; baris lain (authors, math, dll) dibiarkan utuh. */
export function buildFrontmatter(originalFm: string, upd: MetaUpdate): string {
  const lines = originalFm.split("\n");
  const setLine = (key: string, value: string) => {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith(key + ":")) { lines[i] = `${key}: ${value}`; return; }
    }
    // Sisipkan sesudah title, atau di akhir bila tidak ada title.
    const ti = lines.findIndex((l) => l.startsWith("title:"));
    lines.splice(ti >= 0 ? ti + 1 : lines.length, 0, `${key}: ${value}`);
  };
  if (upd.title !== undefined) setLine("title", quote(upd.title));
  if (upd.date !== undefined) setLine("date", upd.date);
  if (upd.draft !== undefined) setLine("draft", upd.draft ? "true" : "false");
  if (upd.description !== undefined) setLine("description", quote(upd.description));
  if (upd.tags !== undefined) setLine("tags", listStr(upd.tags));
  if (upd.categories !== undefined) setLine("categories", listStr(upd.categories));
  if (upd.featuredImage !== undefined) setLine("featuredImage", quote(upd.featuredImage));
  return lines.join("\n");
}

export function newFrontmatter(upd: Required<Pick<MetaUpdate, "title" | "date" | "draft" | "description">> & { tags: string[]; categories: string[]; featuredImage?: string }): string {
  const out: string[] = [
    `title: ${quote(upd.title)}`,
    `date: ${upd.date}`,
    `draft: ${upd.draft ? "true" : "false"}`,
    `authors: ["Gunanto"]`,
  ];
  if (upd.description) out.push(`description: ${quote(upd.description)}`);
  if (upd.featuredImage) out.push(`featuredImage: ${quote(upd.featuredImage)}`);
  out.push("", `tags: ${listStr(upd.tags)}`, `categories: ${listStr(upd.categories)}`, "", "math:", "  enable: true");
  return out.join("\n");
}

export const CODE_PLACEHOLDER_PREFIX = "> 🔖 Blok kode";

/** Ubah body asli menjadi body editor.
 * Dilindungi (tidak lewat editor visual, dipulihkan persis saat simpan):
 * - <!--more-->, shortcode Hugo {{< ... >}}, dan SEMUA blok kode berpagar ```.
 * Alasan blok kode: editor visual Crepe mengubah ```latex menjadi blok rumus $$,
 * yang merusak kode TikZ. Jadi di v1 blok kode hanya bisa dipindah/dihapus
 * baris penandanya, isinya tidak diedit lewat panel ini. */
export function toEditorBody(body: string): { editorBody: string; protectedItems: ProtectedItem[] } {
  const protectedItems: ProtectedItem[] = [];
  let out = body;
  // Blok kode dulu, supaya isi kode tidak ikut diproses aturan lain.
  out = out.replace(/```[^\n]*\n[\s\S]*?^```[ \t]*$/gm, (m) => {
    const n = protectedItems.filter((p) => p.key.startsWith("CODE")).length + 1;
    const key = `CODE-${n}`;
    protectedItems.push({ key, original: m });
    return `\n\n${CODE_PLACEHOLDER_PREFIX} ${n} — jangan hapus baris ini.\n\n`;
  });
  out = out.replace(/<!--more-->/g, () => {
    protectedItems.push({ key: "MORE", original: "<!--more-->" });
    return `\n\n${MORE_PLACEHOLDER}\n\n`;
  });
  out = out.replace(/\{\{<[\s\S]*?>\}\}/g, (m) => {
    const n = protectedItems.filter((p) => p.key.startsWith("SHORTCODE")).length + 1;
    const key = `SHORTCODE-${n}`;
    protectedItems.push({ key, original: m });
    return `\n\n${SHORTCODE_PLACEHOLDER_PREFIX} ${n} — jangan hapus baris ini.\n\n`;
  });
  return { editorBody: out.replace(/\n{3,}/g, "\n\n"), protectedItems };
}

/**
 * Kembalikan body editor menjadi body asli.
 * Mengembalikan juga daftar shortcode yang hilang (harus memblokir simpan).
 */
export function fromEditorBody(editorBody: string, protectedItems: ProtectedItem[]): { body: string; missingShortcodes: string[]; moreRestored: boolean } {
  let body = editorBody;
  let moreRestored = false;
  const missingShortcodes: string[] = [];
  for (const item of protectedItems) {
    if (item.key === "MORE") {
      const re = new RegExp(`^>\\s*🔖 Batas ringkasan.*$`, "m");
      if (re.test(body)) { body = body.replace(re, "<!--more-->"); moreRestored = true; }
    } else if (item.key.startsWith("SHORTCODE")) {
      const n = item.key.split("-")[1];
      const re = new RegExp(`^>\\s*🔖 Blok khusus Hugo ${n}.*$`, "m");
      if (re.test(body)) body = body.replace(re, item.original);
      else missingShortcodes.push(item.key);
    } else if (item.key.startsWith("CODE")) {
      const n = item.key.split("-")[1];
      const re = new RegExp(`^>\\s*🔖 Blok kode ${n}.*$`, "m");
      if (re.test(body)) body = body.replace(re, item.original);
      else missingShortcodes.push(item.key);
    }
  }
  if (!moreRestored && protectedItems.some((p) => p.key === "MORE")) {
    // Batas ringkasan hilang karena terhapus: pulihkan sesudah paragraf pertama,
    // karena tanpa itu ringkasan Hugo jadi tidak terkendali. Ini dicatat di hasil simpan.
    const paras = body.split(/\n\n/);
    if (paras.length > 1) body = paras[0] + "\n\n<!--more-->\n\n" + paras.slice(1).join("\n\n");
    else body = body + "\n\n<!--more-->\n";
    moreRestored = true;
  }
  return { body, missingShortcodes, moreRestored };
}

/**
 * Crepe/Milkdown mengeluarkan SEMUA rumus sebagai $...$ (termasuk rumus blok).
 * Padahal blog memakai $$...$$ untuk rumus blok (tampil terpusat).
 * Pulihkan: blok yang isinya HANYA satu/lebih segmen $...$ (tanpa teks lain)
 * diubah kembali menjadi $$...$$ per segmen. Rumus sebaris di dalam paragraf
 * (ada teks lain di blok yang sama) dibiarkan $...$.
 * Dijalankan pada body editor SEBELUM placeholder kode dikembalikan,
 * supaya isi blok kode tidak ikut diproses.
 */
export function restoreDisplayMath(editorBody: string): string {
  return editorBody.split(/\n\n+/).map((block) => {
    const t = block.trim();
    if (!t.startsWith("$")) return block;
    // Blok harus seluruhnya segmen $...$, dipisah spasi/baris baru saja.
    if (!/^(\$[^$]+\$)(\s+\$[^$]+\$)*$/.test(t)) return block;
    const segments = t.match(/\$[^$]+\$/g) || [];
    return segments.map((s) => `$${s}$`).join("\n");
  }).join("\n\n");
}

export function slugify(title: string): string {
  return title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "artikel-baru";
}

export function nowWib(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:00+07:00`;
}

export function isSafeSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(slug);
}
export function isSafeFile(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name) && !name.includes("..");
}

export async function runGit(repo: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  const proc = spawn(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { ok: code === 0, out: (out + err).trim() };
}
export async function runCmd(args: string[], cwd?: string): Promise<{ ok: boolean; out: string }> {
  const proc = spawn(args, { stdout: "pipe", stderr: "pipe", cwd });
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { ok: code === 0, out: (out + err).trim() };
}
export async function unifiedDiff(oldText: string, newText: string): Promise<string> {
  const dir = await import("node:os").then((m) => m.tmpdir());
  const a = `${dir}/gezy-old-${Date.now()}.md`;
  const b = `${dir}/gezy-new-${Date.now()}.md`;
  await Bun.write(a, oldText);
  await Bun.write(b, newText);
  const r = await runCmd(["diff", "-u", "--label", "sebelum", "--label", "sesudah", a, b]);
  await runCmd(["rm", "-f", a, b]);
  return r.out || "(tidak ada perbedaan baris)";
}
