# GezyBlog Admin

Panel admin kecil khusus blog Hugo Pak Gun (`pakgun10/pakgun`).
Bukan WordPress, bukan CMS umum: satu akun admin, editor visual
(Milkdown Crepe), simpan = pratinjau diff dulu, lalu commit + push
ke GitHub, lalu Cloudflare Pages membangun ulang.

## Yang bisa dilakukan (v1)

- Daftar + cari 149 artikel, edit artikel, buat artikel baru, edit Tentang Saya
- Editor visual dari HP: tebal, judul, daftar, tautan, tabel, gambar
- Rumus tampil sebagai rumus KaTeX (ketuk rumus untuk mengubahnya)
- Gambar sampul diunggah dari HP, gambar sebaris diunggah dari editor
- Toggle draf / terbit

## Yang sengaja TIDAK bisa di v1 (supaya tidak rusak)

- Hapus artikel
- Edit blok kode (termasuk kode TikZ), shortcode Hugo, dan batas ringkasan.
  Ketiganya tampil sebagai baris bertanda 🔖 dan dipulihkan persis saat simpan.
  Alasannya teruji: editor visual mengubah blok ```latex menjadi blok rumus $$,
  jadi blok kode dilindungi, bukan diedit visual.
- Edit pengaturan situs, menu, dan tema

## Cara kerja simpan (aman)

1. Panel menarik dulu perubahan terbaru dari GitHub (`git pull --rebase`).
   Bila gagal/konflik, simpanan dibatalkan dan rebase dibatalkan.
2. Pengguna melihat diff dulu (Pratinjau Perubahan), baru menekan Simpan.
3. Panel menulis `index.md`, menambah seluruh folder artikel (supaya gambar
   baru ikut ter-commit), commit, lalu push bila ada remote dan ALLOW_PUSH=1.
4. Cloudflare Pages membangun ulang; artikel live beberapa menit kemudian.
5. Setiap simpanan adalah satu commit Git, jadi selalu bisa dibatalkan
   lewat riwayat Git.

## Normalisasi editor (kosmetik, terlihat di pratinjau)

Editor visual menulis ulang Markdown ke bentuk baku: penanda daftar `-`
menjadi `*`, padding kolom tabel diratakan, dan garis `----` menjadi `***`.
Ketiganya dirender Hugo dengan hasil yang sama, jadi bukan kehilangan isi.
Yang TIDAK dinormalisasi: rumus blok `$$...$$` dipulihkan oleh server
(editor mengeluarkan semuanya sebagai `$...$`), blok kode, shortcode Hugo,
dan batas ringkasan dipulihkan persis lewat penanda 🔖. Pratinjau diff
selalu ditampilkan sebelum simpan, supaya normalisasi ini terlihat.

## Menjalankan lokal (uji)

```bash
bun install
bun run build
BLOG_REPO=/tmp/blog-test SESSION_SECURE=0 ALLOW_PUSH=0 \
  ADMIN_USER=admin ADMIN_PASS_HASH='$(printf "sandi" | bun run scripts/hash-password.ts)' \
  bun run src/index.ts
# buka http://localhost:3101
```

## Deploy ke VPS

Lihat `DEPLOY.md` — langkah demi langkah, termasuk repo baru,
deploy key, DNS `admin.pakgun.gezytech.web.id`, Caddy, dan systemd.
