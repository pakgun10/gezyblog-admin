// GezyBlog Admin — panel admin kecil khusus blog Hugo Pak Gun.
// Bun + serve bawaan, tanpa database. Data = clone repo blog di disk.
// Simpan = pratinjau diff dulu, lalu commit + push (bila remote ada).
// Jalankan: BLOG_REPO=/opt/gezyblog/blog ADMIN_USER=admin ADMIN_PASS_HASH='...' bun run src/index.ts
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { page, esc } from "./templates";
import {
  parseFile, parseMeta, buildFrontmatter, newFrontmatter, toEditorBody, fromEditorBody,
  restoreDisplayMath,
  slugify, nowWib, isSafeSlug, isSafeFile, runGit, unifiedDiff, type ProtectedItem,
} from "./lib";

const PORT = Number(process.env.PORT || 3101);
const REPO = resolve(process.env.BLOG_REPO || join(import.meta.dir, "..", "..", "blog-pakgun"));
const PUBLIC_URL = (process.env.BLOG_PUBLIC_URL || "https://pakgun.gezytech.web.id").replace(/\/$/, "");
const ALLOW_PUSH = process.env.ALLOW_PUSH !== "0";
const SESSION_SECURE = process.env.SESSION_SECURE === "1";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH || "";

const sessions = new Map<string, number>(); // token -> expiry ms
const pending = new Map<string, PendingSave>();
const loginAttempts = new Map<string, { n: number; until: number }>();

interface PendingSave {
  slug: string; isNew: boolean; isAbout: boolean;
  content: string; file: string; featuredFile?: { name: string; bytes: Uint8Array };
  liveUrl: string;
  // Isi berkas saat pratinjau dibuat. Dipakai di konfirmasi: bila berkas
  // sudah berubah di GitHub sejak pratinjau (mis. ada push baru), simpan
  // dibatalkan supaya tidak menimpa perubahan itu diam-diam.
  oldContent: string;
}

// Tarik versi terbaru dari GitHub sebelum membaca berkas untuk ditampilkan.
// Sebelum perbaikan ini, halaman daftar/edit hanya membaca clone di disk,
// yang bisa ketinggalan push terbaru (mis. dari Gezymuse) — editor lalu
// menampilkan versi lama dan simpan menimpanya. Pull gagal (mis. ada
// perubahan lokal) tidak boleh diam-diam: pemanggil menampilkan peringatan.
// Pembatas: pull jaringan (SSH ke GitHub) terasa berat bila dilakukan di
// setiap klik, jadi pull dibatasi maksimal sekali tiap 5 menit. Di dalam
// jeda itu halaman dibaca dari disk saja — kesegaran tertinggal maksimal
// 5 menit, dan pengaman simpan (cek oldContent di konfirmasi) tetap
// membatalkan simpan bila ada push baru di sela itu, jadi pembatas ini
// tidak membuka lagi celah timpa diam-diam. Pull gagal tidak memperbarui
// stempel waktu, supaya klik berikutnya mencoba lagi, bukan menunggu 5
// menit dalam keadaan gagal. Restart service mengatur ulang stempel ke 0,
// sehingga halaman pertama sesudah restart selalu menarik dulu.
let lastPullAt = 0;
const PULL_MIN_INTERVAL_MS = 5 * 60 * 1000;
async function pullLatest(): Promise<{ ok: boolean; out: string }> {
  const hasRemote = (await runGit(REPO, ["remote"])).out.trim().length > 0;
  if (!hasRemote) return { ok: true, out: "" };
  if (Date.now() - lastPullAt < PULL_MIN_INTERVAL_MS) return { ok: true, out: "" };
  const pull = await runGit(REPO, ["pull", "--ff-only"]);
  if (pull.ok) lastPullAt = Date.now();
  return pull;
}
function pullWarning(pull: { ok: boolean; out: string }): string {
  if (pull.ok) return "";
  return `<div class="err">Gagal menarik versi terbaru dari GitHub — yang ditampilkan mungkin versi lama. Jangan simpan dulu sebelum pull berhasil. Detail: ${esc(pull.out.slice(0, 300))}</div>`;
}

function cookie(req: Request): string | null {
  const m = req.headers.get("cookie")?.match(/(?:^|;\s*)gezyadmin=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
function authed(req: Request): boolean {
  const t = cookie(req);
  if (!t) return false;
  const exp = sessions.get(t);
  if (!exp || exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}
function html(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
}
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
function needAuth(req: Request): Response | null {
  if (authed(req)) return null;
  if (req.headers.get("accept")?.includes("application/json") || req.url.includes("/api/")) return json({ error: "Belum login" }, 401);
  return html(302, "", { Location: "/login" });
}

async function listPosts(q: string) {
  const dir = join(REPO, "content", "posts");
  const names = await readdir(dir);
  const out: { slug: string; title: string; date: string; draft: boolean; featured: string }[] = [];
  for (const slug of names) {
    if (slug.startsWith("_") || slug.startsWith(".")) continue;
    const f = join(dir, slug, "index.md");
    try {
      const raw = await Bun.file(f).text();
      const { fm } = parseFile(raw);
      const meta = parseMeta(fm);
      out.push({ slug, title: meta.title || slug, date: meta.date, draft: meta.draft, featured: meta.featuredImage });
    } catch { /* lewati folder tanpa index.md */ }
  }
  out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  if (!q) return out;
  const needle = q.toLowerCase();
  return out.filter((p) => p.title.toLowerCase().includes(needle) || p.slug.includes(needle));
}

function loginPage(err = ""): string {
  return page("Login", `<div class="card"><h2>Login Admin Blog</h2>
  ${err ? `<div class="err">${esc(err)}</div>` : ""}
  <form method="post" action="/api/login">
  <label>Nama pengguna</label><input type="text" name="username" required autocomplete="username">
  <label>Kata sandi</label><input type="password" name="password" required autocomplete="current-password">
  <p><button type="submit">Masuk</button></p>
  <p class="muted">Hanya satu akun admin. Akun ini bukan akun GitHub; GitHub hanya dipakai di belakang layar saat push.</p>
  </form></div>`);
}

function editPage(opts: {
  slug: string; isNew: boolean; isAbout: boolean; meta: ReturnType<typeof parseMeta>;
  editorBody: string; protectedItems: ProtectedItem[]; featuredExists: string;
  notice?: string;
}): string {
  const { slug, isNew, isAbout, meta, editorBody, protectedItems, featuredExists, notice } = opts;
  const dataJson = JSON.stringify(editorBody).replace(/</g, "\\u003c");
  const protJson = JSON.stringify(protectedItems).replace(/</g, "\\u003c");
  const title = isAbout ? "Edit Tentang Saya" : isNew ? "Artikel Baru" : "Edit Artikel";
  return page(title, `
  <p><a href="/posts">← Daftar artikel</a></p>${notice || ""}
  <div id="status"></div><div id="editor-error" class="err" style="display:none"></div>
  <div class="card">
  <label>Judul</label><input id="title" type="text" value="${esc(meta.title)}">
  <label>Slug ${isNew ? "(otomatis dari judul, bisa diubah)" : "(tidak bisa diubah setelah terbit)"}</label>
  <input id="slug" type="text" value="${esc(slug)}" ${isNew ? "" : "readonly"}>
  <input id="isNew" type="hidden" value="${isNew ? "1" : "0"}">
  <input id="isAbout" type="hidden" value="${isAbout ? "1" : "0"}">
  <label>Tanggal (WIB)</label><input id="date" type="datetime-local" data-iso="${esc(meta.date)}">
  <label><input id="draft" type="checkbox" ${meta.draft ? "checked" : ""} style="width:auto"> Simpan sebagai draf (tidak tampil di blog)</label>
  ${isAbout ? "" : `
  <label>Deskripsi singkat</label><textarea id="description" rows="3">${esc(meta.description)}</textarea>
  <label>Tag (pisahkan koma)</label><input id="tags" type="text" value="${esc(meta.tags.join(", "))}">
  <label>Kategori (pisahkan koma)</label><input id="categories" type="text" value="${esc(meta.categories.join(", "))}">
  <label>Gambar sampul</label>
  <p class="muted">Sampul sekarang: ${featuredExists ? `<a href="/media/posts/${esc(slug)}/${esc(featuredExists)}" target="_blank">${esc(featuredExists)}</a>` : "belum ada"}. Untuk mengganti, unggah berkas di bawah saat menyimpan — kolom ini cukup diisi nama berkasnya bila sudah ada di folder artikel.</p>
  <input id="featuredImage" type="text" value="${esc(meta.featuredImage)}">
  <input id="featuredFile" type="file" accept="image/png,image/jpeg,image/webp">`}
  <label>Isi artikel</label>
  <p class="muted">Tulis seperti di Word: tebal, judul, daftar, tautan, tabel, dan gambar lewat toolbar atau menu garis miring (/). Rumus tampil sebagai rumus, ketuk rumus untuk mengubahnya. Baris bertanda 🔖 adalah penanda sistem (batas ringkasan, blok khusus Hugo, blok kode) — jangan hapus; blok kode sengaja tidak bisa diedit di sini supaya kode TikZ tidak rusak.</p>
  <div id="crepe-root" class="milkdown"></div>
  </div>
  <div class="sticky"><button id="preview-btn" type="button">Pratinjau Perubahan</button><a class="btn secondary" href="/posts">Batal</a></div>
  <div id="preview-box"></div>
  <script>window.__EDITOR_MD__ = ${dataJson}; window.__PROTECTED__ = ${protJson}; window.__SLUG__ = ${JSON.stringify(slug)};</script>
  <script type="module" src="/public/crepe.js"></script>`, `<link rel="stylesheet" href="/public/crepe.css">`);
}

async function readPost(slug: string) {
  const file = join(REPO, "content", "posts", slug, "index.md");
  const raw = await Bun.file(file).text();
  const { fm, body } = parseFile(raw);
  return { file, raw, fm, body, meta: parseMeta(fm) };
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Berkas statis editor (dibangun lewat `bun run build`).
    if (path.startsWith("/public/")) {
      const name = path.slice("/public/".length);
      if (!isSafeFile(name)) return new Response("Not found", { status: 404 });
      const f = Bun.file(join(import.meta.dir, "..", "public", name));
      if (!(await f.exists())) return new Response("Editor belum dibangun. Jalankan: bun run build", { status: 404 });
      return new Response(f);
    }
    if (path === "/favicon.ico") return new Response("", { status: 204 });
    if (path === "/login") return html(200, loginPage());
    if (path === "/api/login" && req.method === "POST") {
      const ip = req.headers.get("x-forwarded-for") || "local";
      const att = loginAttempts.get(ip);
      if (att && att.until > Date.now() && att.n >= 5) return html(429, loginPage("Terlalu banyak percobaan. Coba lagi beberapa menit."));
      const form = await req.formData();
      const user = String(form.get("username") || "");
      const pass = String(form.get("password") || "");
      let ok = false;
      if (ADMIN_PASS_HASH && user === ADMIN_USER) {
        try { ok = await Bun.password.verify(pass, ADMIN_PASS_HASH); } catch { ok = false; }
      }
      if (!ok) {
        const n = (att?.n || 0) + 1;
        loginAttempts.set(ip, { n, until: Date.now() + 15 * 60 * 1000 });
        return html(401, loginPage("Nama pengguna atau kata sandi salah."));
      }
      loginAttempts.delete(ip);
      const token = crypto.randomUUID();
      sessions.set(token, Date.now() + 12 * 60 * 60 * 1000);
      const secure = SESSION_SECURE ? "; Secure" : "";
      return html(302, "", { Location: "/posts", "Set-Cookie": `gezyadmin=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=43200${secure}` });
    }
    if (path === "/api/logout") {
      const t = cookie(req); if (t) sessions.delete(t);
      return html(302, "", { Location: "/login", "Set-Cookie": "gezyadmin=; HttpOnly; Path=/; Max-Age=0" });
    }

    const guard = needAuth(req);
    if (guard) return guard;

    if (path === "/" ) return html(302, "", { Location: "/posts" });
    if (path === "/posts") {
      const q = url.searchParams.get("q") || "";
      const pull = await pullLatest();
      const posts = await listPosts(q);
      const rows = posts.map((p) => `<div class="card post">
        ${p.featured ? `<img src="/media/posts/${esc(p.slug)}/${esc(p.featured)}" alt="" loading="lazy">` : ""}
        <div><b><a href="/posts/${esc(p.slug)}/edit">${esc(p.title)}</a></b>
        <div class="muted">${esc(p.slug)} · ${esc(p.date.slice(0, 10))} ${p.draft ? "· DRAF" : ""}</div></div></div>`).join("");
      return html(200, page("Daftar Artikel", `${pullWarning(pull)}
        <form method="get" action="/posts"><input type="text" name="q" value="${esc(q)}" placeholder="Cari judul artikel…">
        <p><button type="submit">Cari</button> <a class="btn" href="/posts/new">+ Artikel Baru</a> <a class="btn secondary" href="/about/edit">Edit Tentang Saya</a> <a class="btn secondary" href="/api/logout">Keluar</a></p></form>
        <p class="muted">${posts.length} artikel. Menyimpan di sini = commit + push ke GitHub, lalu Cloudflare membangun ulang.</p>${rows || "<p>Belum ada artikel yang cocok.</p>"}`));
    }
    if (path === "/posts/new") {
      const meta = parseMeta(newFrontmatter({ title: "", date: nowWib(), draft: false, description: "", tags: [], categories: [] }));
      return html(200, editPage({ slug: "", isNew: true, isAbout: false, meta, editorBody: "", protectedItems: [], featuredExists: "" }));
    }
    if (path === "/about/edit") {
      const pull = await pullLatest();
      const file = join(REPO, "content", "about", "index.md");
      const raw = await Bun.file(file).text();
      const { fm, body } = parseFile(raw);
      const { editorBody, protectedItems } = toEditorBody(body);
      return html(200, editPage({ slug: "__about__", isNew: false, isAbout: true, meta: parseMeta(fm), editorBody, protectedItems, featuredExists: "", notice: pullWarning(pull) }));
    }
    const editMatch = path.match(/^\/posts\/([a-z0-9-]+)\/edit$/);
    if (editMatch) {
      const slug = editMatch[1];
      try {
        const pull = await pullLatest();
        const { body, meta } = await readPost(slug);
        const { editorBody, protectedItems } = toEditorBody(body);
        return html(200, editPage({ slug, isNew: false, isAbout: false, meta, editorBody, protectedItems, featuredExists: meta.featuredImage, notice: pullWarning(pull) }));
      } catch { return html(404, page("Tidak ditemukan", `<p>Artikel <code>${esc(slug)}</code> tidak ditemukan.</p><p><a href="/posts">Kembali</a></p>`)); }
    }
    const mediaMatch = path.match(/^\/media\/posts\/([a-z0-9-]+)\/(.+)$/);
    if (mediaMatch) {
      const [, slug, rawName] = mediaMatch;
      const name = decodeURIComponent(rawName);
      if (!isSafeFile(name)) return new Response("Not found", { status: 404 });
      const f = Bun.file(join(REPO, "content", "posts", slug, name));
      if (!(await f.exists())) return new Response("Not found", { status: 404 });
      return new Response(f);
    }

    // API: unggah gambar sampul (disimpan sebagai featured-image.<ext>).
    const featMatch = path.match(/^\/api\/posts\/([a-z0-9-]+)\/upload-featured$/);
    if (featMatch && req.method === "POST") {
      const slug = featMatch[1];
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return json({ error: "Tidak ada berkas" }, 400);
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return json({ error: "Hanya PNG, JPG, atau WebP" }, 400);
      if (file.size > 5 * 1024 * 1024) return json({ error: "Gambar maksimal 5 MB" }, 400);
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const name = `featured-image.${ext}`;
      const dir = join(REPO, "content", "posts", slug);
      await import("node:fs/promises").then((m) => m.mkdir(dir, { recursive: true }));
      await Bun.write(join(dir, name), await file.arrayBuffer());
      return json({ filename: name });
    }

    // API: unggah gambar sebaris dari editor HP.
    const upMatch = path.match(/^\/api\/posts\/([a-z0-9-]+)\/upload-inline$/);
    if (upMatch && req.method === "POST") {
      const slug = upMatch[1];
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return json({ error: "Tidak ada berkas" }, 400);
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return json({ error: "Hanya PNG, JPG, atau WebP" }, 400);
      if (file.size > 5 * 1024 * 1024) return json({ error: "Gambar maksimal 5 MB" }, 400);
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const name = `img-${Date.now()}.${ext}`;
      const dir = join(REPO, "content", "posts", slug);
      await Bun.write(join(dir, name), await file.arrayBuffer());
      return json({ filename: name });
    }

    // API: pratinjau -> konfirmasi (dua langkah, supaya mangling editor terlihat dulu).
    async function handlePreview(req: Request, slug: string, isNew: boolean, isAbout: boolean) {
      const data = await req.json().catch(() => null);
      if (!data || typeof data.title !== "string") return json({ error: "Data tidak lengkap" }, 400);
      const protectedItems: ProtectedItem[] = Array.isArray(data.protectedItems) ? data.protectedItems : [];
      // Pulihkan rumus blok $$...$$ dulu (Crepe mengeluarkan semuanya sebagai $...$),
      // baru kembalikan placeholder kode/shortcode/batas ringkasan.
      const { body, missingShortcodes } = fromEditorBody(restoreDisplayMath(String(data.body || "")), protectedItems);
      if (missingShortcodes.length) return json({ error: `Blok yang dilindungi hilang (${missingShortcodes.join(", ")}). Batalkan, kembalikan baris bertanda 🔖 itu, lalu coba lagi — simpanan diblokir supaya kode / gambar khusus tidak hilang.` }, 400);
      let oldContent = "";
      let file = "";
      if (isAbout) {
        file = join(REPO, "content", "about", "index.md");
        oldContent = await Bun.file(file).text();
        const { fm } = parseFile(oldContent);
        const newFm = buildFrontmatter(fm, { title: data.title, date: data.date || undefined, draft: Boolean(data.draft) });
        const content = `---\n${newFm}\n---\n\n${body.trim()}\n`;
        const diff = await unifiedDiff(oldContent, content);
        const token = crypto.randomUUID();
        pending.set(token, { slug: "__about__", isNew: false, isAbout: true, content, file, liveUrl: `${PUBLIC_URL}/about/`, oldContent });
        setTimeout(() => pending.delete(token), 10 * 60 * 1000);
        return json({ token, diff, note: "Tentang Saya. Periksa diff di bawah sebelum menyimpan." });
      }
      const finalSlug = isNew ? slugify(String(data.slug || data.title || "")) : slug;
      if (!isSafeSlug(finalSlug)) return json({ error: "Slug tidak valid" }, 400);
      file = join(REPO, "content", "posts", finalSlug, "index.md");
      const tags: string[] = Array.isArray(data.tags) ? data.tags : [];
      const categories: string[] = Array.isArray(data.categories) ? data.categories : [];
      let content: string;
      if (isNew) {
        content = `---\n${newFrontmatter({ title: data.title, date: data.date || nowWib(), draft: Boolean(data.draft), description: String(data.description || ""), tags, categories, featuredImage: String(data.featuredImage || "") || undefined })}\n---\n\n${body.trim()}\n`;
      } else {
        try { oldContent = await Bun.file(file).text(); } catch { return json({ error: "Artikel tidak ditemukan" }, 404); }
        const { fm } = parseFile(oldContent);
        const newFm = buildFrontmatter(fm, {
          title: data.title, date: data.date || undefined, draft: Boolean(data.draft),
          description: String(data.description || ""), tags, categories,
          featuredImage: String(data.featuredImage || "") || undefined,
        });
        // Bila featuredImage dikosongkan, hapus barisnya supaya Hugo tidak mencari berkas kosong.
        const fmLines = newFm.split("\n").filter((l) => !(String(data.featuredImage || "") === "" && l.startsWith("featuredImage:")));
        content = `---\n${fmLines.join("\n")}\n---\n\n${body.trim()}\n`;
      }
      const diff = await unifiedDiff(oldContent, content);
      const token = crypto.randomUUID();
      pending.set(token, { slug: finalSlug, isNew, isAbout: false, content, file, liveUrl: `${PUBLIC_URL}/posts/${finalSlug}/`, oldContent });
      setTimeout(() => pending.delete(token), 10 * 60 * 1000);
      return json({ token, diff, note: isNew ? `Artikel baru: ${finalSlug}` : `Mengubah: ${finalSlug}` });
    }
    // Rute "new" HARUS dicek dulu: regex slug di bawah juga cocok dengan kata "new".
    if (path === "/api/posts/new/preview" && req.method === "POST") {
      const clone = await req.clone().json().catch(() => null);
      if (!clone) return json({ error: "Data tidak lengkap" }, 400);
      return handlePreview(new Request(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(clone) }), slugify(String(clone.slug || clone.title || "")), true, false);
    }
    // Rute Tentang Saya HARUS eksplisit: slug "__about__" mengandung garis bawah,
    // jadi tidak cocok dengan regex slug artikel ([a-z0-9-]+) di bawah — tanpa
    // rute ini, pratinjau Tentang Saya jatuh ke 404 HTML dan klien hanya
    // menampilkan "Gagal membuat pratinjau" (bug yang dilaporkan 2026-10-31).
    if (path === "/api/about/preview" && req.method === "POST") return handlePreview(req, "__about__", false, true);
    const prevMatch = path.match(/^\/api\/posts\/([a-z0-9-]+)\/preview$/);
    if (prevMatch && req.method === "POST") return handlePreview(req, prevMatch[1], false, false);
    async function handleConfirm(req: Request) {
      const data = await req.json().catch(() => null);
      const p = data?.token ? pending.get(String(data.token)) : undefined;
      if (!p) return json({ error: "Pratinjau kedaluwarsa (10 menit). Buat pratinjau lagi." }, 400);
      pending.delete(String(data.token));
      // Tarik dulu hanya bila ada remote. Berkas tak terlacak (gambar baru)
      // bukan alasan gagal: pull --rebase tidak menyentuh berkas tak terlacak.
      const hasRemote = (await runGit(REPO, ["remote"])).out.trim().length > 0;
      if (hasRemote) {
        const pull = await runGit(REPO, ["pull", "--rebase"]);
        if (!pull.ok) {
          await runGit(REPO, ["rebase", "--abort"]);
          return json({ error: `Gagal menarik perubahan terbaru dari GitHub, simpanan dibatalkan supaya tidak menimpa: ${pull.out.slice(0, 300)}` }, 409);
        }
        // Pull saat simpan juga menyegarkan clone, jadi halaman daftar
        // sesudah simpan tidak perlu menarik lagi dalam 5 menit.
        lastPullAt = Date.now();
      }
      // Pengaman timpa: bila berkas sudah berubah sejak pratinjau dibuat
      // (mis. push baru masuk setelah editor dibuka), batalkan simpan.
      // Tanpa cek ini, pull di atas justru memperbarui berkas lalu isi
      // pratinjau lama menimpanya kembali — persis kasus tautan portal
      // Tentang Saya yang kembali ke gezytech.web.id pada 2026-10-31.
      let current = "";
      try { current = await Bun.file(p.file).text(); } catch { current = ""; }
      if (current !== p.oldContent) {
        return json({ error: "Berkas sudah berubah di GitHub sejak pratinjau dibuat. Simpanan dibatalkan supaya tidak menimpa. Muat ulang halaman edit, lalu buat pratinjau lagi." }, 409);
      }
      const dir = join(p.file, "..");
      await import("node:fs/promises").then((m) => m.mkdir(dir, { recursive: true }));
      await Bun.write(p.file, p.content);
      // Tambah SELURUH folder artikel, bukan hanya index.md, supaya gambar
      // sebaris / sampul yang baru diunggah ikut ter-commit dan ter-push.
      await runGit(REPO, ["add", p.isAbout ? p.file : dir]);
      const commit = await runGit(REPO, ["commit", "-m", p.isAbout ? "Admin: ubah Tentang Saya" : p.isNew ? `Admin: artikel baru ${p.slug}` : `Admin: ubah ${p.slug}`]);
      if (!commit.ok && !commit.out.includes("nothing to commit")) return json({ error: `Gagal commit: ${commit.out.slice(0, 300)}` }, 500);
      let commitHash = "";
      if (!commit.out.includes("nothing to commit")) {
        const rev = await runGit(REPO, ["rev-parse", "--short", "HEAD"]);
        commitHash = rev.out;
      }
      let pushMsg = "Push dilewati (tidak ada remote / ALLOW_PUSH=0).";
      if (ALLOW_PUSH) {
        const remotes = await runGit(REPO, ["remote"]);
        if (remotes.out) {
          const branch = (await runGit(REPO, ["rev-parse", "--abbrev-ref", "HEAD"])).out || "main";
          const push = await runGit(REPO, ["push", "origin", branch]);
          pushMsg = push.ok ? "Push ke GitHub berhasil; Cloudflare akan membangun ulang." : `Commit tersimpan lokal, TAPI push gagal: ${push.out.slice(0, 300)}`;
        }
      }
      return json({ commit: commitHash || "tidak ada perubahan", push: pushMsg, liveUrl: p.liveUrl });
    }
    if (path === "/api/about/confirm" && req.method === "POST") return handleConfirm(req);
    if (path === "/api/posts/new/confirm" && req.method === "POST") return handleConfirm(req);
    const confMatch = path.match(/^\/api\/posts\/([a-z0-9-]+)\/confirm$/);
    if (confMatch && req.method === "POST") return handleConfirm(req);

    return html(404, page("Tidak ditemukan", `<p>Halaman tidak ditemukan.</p><p><a href="/posts">Kembali ke daftar</a></p>`));
  },
});

console.log(`GezyBlog Admin jalan di http://localhost:${PORT} (repo: ${REPO})`);
