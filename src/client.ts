// Klien editor: Milkdown Crepe (WYSIWYG -> Markdown).
// Rumus tampil sebagai rumus KaTeX, blok kode tampil sebagai blok kode,
// gambar relatif dipetakan ke /media/... hanya untuk pratinjau di editor.
import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/frame.css";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/common/reset.css";
import "@milkdown/crepe/theme/common/prosemirror.css";
import "@milkdown/crepe/theme/common/block-edit.css";
import "@milkdown/crepe/theme/common/code-mirror.css";
import "@milkdown/crepe/theme/common/cursor.css";
import "@milkdown/crepe/theme/common/image-block.css";
import "@milkdown/crepe/theme/common/latex.css";
import "@milkdown/crepe/theme/common/link-tooltip.css";
import "@milkdown/crepe/theme/common/list-item.css";
import "@milkdown/crepe/theme/common/placeholder.css";
import "@milkdown/crepe/theme/common/table.css";
import "@milkdown/crepe/theme/common/toolbar.css";
import "katex/dist/katex.min.css";

declare global { interface Window { __EDITOR_MD__?: string; __SLUG__?: string; } }

const root = document.getElementById("crepe-root");
const slug = (document.getElementById("slug") as HTMLInputElement | null)?.value
  || window.__SLUG__ || "";
let crepe: Crepe | null = null;

function proxyUrl(url: string): string {
  if (!url || url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/") || url.startsWith("data:")) return url;
  return `/media/posts/${encodeURIComponent(slug)}/${url.split("/").map(encodeURIComponent).join("/")}`;
}
async function uploadInline(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`/api/posts/${encodeURIComponent(slug)}/upload-inline`, { method: "POST", body: fd, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Gagal mengunggah gambar");
  return data.filename as string; // nama berkas saja, supaya Markdown tetap relatif untuk Hugo
}

if (root) {
  crepe = new Crepe({
    root,
    defaultValue: window.__EDITOR_MD__ || "",
    featureConfigs: {
      // @ts-expect-error: tipe fitur Crepe memakai enum, nilai string tetap diterima runtime
      "image-block": {
        onUpload: uploadInline,
        inlineOnUpload: uploadInline,
        blockOnUpload: uploadInline,
        proxyDomURL: proxyUrl,
      },
    },
  });
  (window as unknown as { __CREPE__?: Crepe }).__CREPE__ = crepe;
  crepe.create().catch((e) => {
    const el = document.getElementById("editor-error");
    if (el) el.textContent = "Editor gagal dimuat: " + String(e?.message || e);
  });
}

function collect(): Record<string, unknown> {
  const get = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";
  const tags = get("tags").split(",").map((s) => s.trim()).filter(Boolean);
  const categories = get("categories").split(",").map((s) => s.trim()).filter(Boolean);
  const dateLocal = get("date");
  // datetime-local di HP Pak Gun dibaca sebagai WIB, sesuai zona blog.
  const date = dateLocal ? `${dateLocal}:00+07:00`.replace(/:00:00\+/, ":00+") : "";
  return {
    title: get("title"), date: date || undefined, draft: (document.getElementById("draft") as HTMLInputElement | null)?.checked ?? false,
    description: get("description"), tags, categories,
    featuredImage: get("featuredImage"),
    body: crepe ? crepe.getMarkdown() : "",
    protectedItems: (window as unknown as { __PROTECTED__?: unknown }).__PROTECTED__ || [],
    isAbout: (document.getElementById("isAbout") as HTMLInputElement | null)?.value === "1",
  };
}
async function postJson(url: string, payload: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

const previewBtn = document.getElementById("preview-btn");
if (previewBtn) {
  previewBtn.addEventListener("click", async () => {
    const status = document.getElementById("status"); if (status) status.textContent = "Membuat pratinjau perubahan…";
    const isNew = (document.getElementById("isNew") as HTMLInputElement | null)?.value === "1";
    const isAbout = (document.getElementById("isAbout") as HTMLInputElement | null)?.value === "1";
    const target = isNew ? "/api/posts/new/preview" : isAbout ? "/api/about/preview" : `/api/posts/${encodeURIComponent(slug)}/preview`;
    const payload = collect();
    if (isNew) (payload as Record<string, unknown>).slug = slug;
    const { ok, data } = await postJson(target, payload);
    if (!ok) { if (status) status.innerHTML = `<div class="err">${data.error || "Gagal membuat pratinjau"}</div>`; return; }
    const box = document.getElementById("preview-box"); if (!box) return;
    box.innerHTML = `<div class="card"><h3>Pratinjau perubahan</h3>
      <p class="muted">${data.note || ""}</p>
      <pre class="diff">${String(data.diff || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>
      <button id="confirm-btn" type="button">Simpan &amp; Terbitkan</button>
      <button id="cancel-preview" type="button" class="secondary">Batalkan pratinjau</button>
      <p class="muted">Menyimpan berarti commit + push ke GitHub, lalu Cloudflare membangun ulang. Perubahan masih bisa dibatalkan lewat riwayat Git.</p></div>`;
    document.getElementById("confirm-btn")?.addEventListener("click", async () => {
      const st = document.getElementById("status"); if (st) st.textContent = "Menyimpan…";
      const cTarget = isNew ? "/api/posts/new/confirm" : isAbout ? "/api/about/confirm" : `/api/posts/${encodeURIComponent(slug)}/confirm`;
      const r = await postJson(cTarget, { token: data.token });
      if (!r.ok) { if (st) st.innerHTML = `<div class="err">${r.data.error || "Gagal menyimpan"}</div>`; return; }
      if (st) st.innerHTML = `<div class="ok">Tersimpan. Commit <code>${r.data.commit || "-"}</code>. ${r.data.push || ""} <a href="${r.data.liveUrl || "#"}">Lihat artikel live (beberapa menit lagi)</a> · <a href="/posts">Kembali ke daftar</a></div>`;
      box.innerHTML = "";
    });
    document.getElementById("cancel-preview")?.addEventListener("click", () => { box.innerHTML = ""; if (status) status.textContent = ""; });
    // Notifikasi berhasil: sebelumnya status hanya dikosongkan, sehingga
    // pratinjau yang berhasil terlihat sama saja dengan tidak terjadi apa-apa.
    if (status) status.innerHTML = (data.diff && String(data.diff).trim() !== "(tidak ada perbedaan baris)")
      ? `<div class="ok">Pratinjau berhasil dibuat. Periksa diff di bawah, lalu tekan “Simpan &amp; Terbitkan” bila sudah benar.</div>`
      : `<div class="ok">Pratinjau berhasil dibuat, tetapi tidak ada perbedaan dengan versi sekarang — tidak ada yang perlu disimpan.</div>`;
  });
}

// Unggah sampul langsung saat dipilih, supaya berkasnya ada di folder artikel
// sebelum pratinjau; nama berkasnya ditulis ke kolom featuredImage.
const featInput = document.getElementById("featuredFile") as HTMLInputElement | null;
if (featInput) {
  featInput.addEventListener("change", async () => {
    const file = featInput.files?.[0]; if (!file) return;
    const status = document.getElementById("status");
    const s = slugElValue();
    if (!s) { if (status) status.innerHTML = `<div class="err">Isi slug dulu sebelum mengunggah sampul.</div>`; return; }
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch(`/api/posts/${encodeURIComponent(s)}/upload-featured`, { method: "POST", body: fd, credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { if (status) status.innerHTML = `<div class="err">${data.error || "Gagal mengunggah sampul"}</div>`; return; }
    const fi = document.getElementById("featuredImage") as HTMLInputElement | null; if (fi) fi.value = data.filename;
    if (status) status.innerHTML = `<div class="ok">Sampul diunggah sebagai ${data.filename}. Lanjutkan ke Pratinjau Perubahan untuk menyimpan.</div>`;
  });
}
function slugElValue(): string {
  return (document.getElementById("slug") as HTMLInputElement | null)?.value || "";
}

// Slug otomatis dari judul, hanya untuk artikel baru dan hanya bila slug belum diubah manual.
const titleEl = document.getElementById("title") as HTMLInputElement | null;
const slugEl = document.getElementById("slug") as HTMLInputElement | null;
if (titleEl && slugEl && (document.getElementById("isNew") as HTMLInputElement | null)?.value === "1") {
  let touched = false;
  slugEl.addEventListener("input", () => { touched = true; });
  titleEl.addEventListener("input", () => {
    if (touched) return;
    slugEl.value = titleEl.value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  });
}
// Konversi tanggal ISO (+07:00) ke datetime-local saat halaman dimuat.
const dateEl = document.getElementById("date") as HTMLInputElement | null;
if (dateEl && dateEl.dataset.iso) {
  const iso = dateEl.dataset.iso;
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (m) dateEl.value = `${m[1]}T${m[2]}:${m[3]}`;
}
