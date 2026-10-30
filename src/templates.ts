// Template HTML panel admin. Sengaja HP-dulu: lebar maks 760px,
// tombol besar, tanpa ketergantungan CSS eksternal kecuali editor.
export function page(title: string, body: string, extraHead = ""): string {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · GezyBlog Admin</title>
<style>
*{box-sizing:border-box} body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f4ef;color:#1f2937;line-height:1.55}
a{color:#4338ca} header{background:#312e81;color:#fff;padding:14px 16px} header a{color:#fff;text-decoration:none}
main{max-width:760px;margin:0 auto;padding:16px} .card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:12px 0}
label{display:block;font-weight:600;margin:12px 0 4px} input[type=text],input[type=password],input[type=datetime-local],input[type=file],textarea,select{width:100%;padding:12px;border:1px solid #d1d5db;border-radius:10px;font-size:16px}
button,.btn{display:inline-block;background:#4338ca;color:#fff;border:0;border-radius:10px;padding:12px 18px;font-size:16px;cursor:pointer;text-decoration:none}
button.secondary,.btn.secondary{background:#e5e7eb;color:#111827} button:disabled{opacity:.5}
.muted{color:#6b7280;font-size:14px} .err{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:12px;border-radius:10px}
.ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;padding:12px;border-radius:10px}
.post{display:flex;gap:12px;align-items:flex-start} .post img{width:64px;height:64px;object-fit:cover;border-radius:8px}
pre.diff{white-space:pre-wrap;word-break:break-word;background:#111827;color:#e5e7eb;padding:12px;border-radius:10px;font-size:13px;max-height:60vh;overflow:auto}
.sticky{position:sticky;bottom:0;background:#fff;border-top:1px solid #e5e7eb;padding:12px 0;display:flex;gap:8px;flex-wrap:wrap}
.milkdown{border:1px solid #d1d5db;border-radius:10px;overflow:hidden} .milkdown .editor{padding:8px}
</style>${extraHead}</head><body><header><a href="/posts"><b>GezyBlog Admin</b></a> <span style="opacity:.8">· blog Pak Gun</span></header><main>${body}</main></body></html>`;
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
