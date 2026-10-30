# Deploy GezyBlog Admin ke VPS (langkah demi langkah)

Pola yang sama seperti Siji Pangeling: Bun + Caddy + systemd.
Yang di tangan Pak Gun: repo, deploy key, DNS, dan perintah di VPS.
Yang sudah disiapkan Gezymuse: seluruh kode di folder `blog-admin/`
di workspace ini (belum di-push, karena repo barunya belum dibuat).

## 0. Gambaran

- Kode admin: repo baru, mis. `pakgun10/gezyblog-admin`
  (nama boleh lain; sesuaikan perintah `git clone` di bawah).
- Data blog: clone repo `pakgun10/pakgun` di VPS ke `/opt/gezyblog/blog`.
- Admin jalan di `127.0.0.1:3101`, Caddy meneruskannya ke
  `https://admin.pakgun.gezytech.web.id`.
- Simpan di admin = commit + push ke `pakgun10/pakgun` → Cloudflare
  Pages membangun ulang blog seperti biasa.

## 1. Buat repo baru untuk kode admin (di GitHub web)

1. GitHub → New repository, nama mis. `gezyblog-admin`, Private,
   jangan centang README/.gitignore/license.
2. Di komputer/VPS nanti, kode dari workspace ini di-push ke repo itu
   (perintahnya di langkah 4, setelah VPS siap — atau push dari
   workspace Gezymuse bila Pak Gun sudah memberi lampu hijau push).

## 2. Deploy key untuk repo BLOG di VPS (tulis saja, bukan baca)

Di VPS, buat kunci khusus untuk clone blog (jangan pakai kunci lama):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_gezyblog -N "" -C "gezyblog-admin-vps"
cat ~/.ssh/id_ed25519_gezyblog.pub
```

Salin isi `.pub` itu, lalu di GitHub repo `pakgun10/pakgun` →
Settings → Deploy keys → Add deploy key, centang **Allow write access**,
tempel kunci tersebut. Tanpa centang tulis, push dari admin akan gagal.

Catatan SSH di VPS ini: bila VPS Pak Gun memakai proxy seperti di
workspace ini, sesuaikan `~/.ssh/config` dengan pola yang sudah
dipakai untuk repo lain (Host github-... + ProxyCommand). Bila SSH
langsung dari VPS sudah bisa ke github.com, lewati catatan ini.

## 3. DNS

Di Cloudflare (akun yang memegang zona `gezytech.web.id`), tambahkan:

- Type: A, Name: `admin.pakgun`, Content: IP VPS (saat ini 13.54.21.37),
  Proxy status: sesuai kebiasaan (DNS only lebih sederhana untuk Caddy).

Tunggu sampai `admin.pakgun.gezytech.web.id` mengarah ke VPS
(`ping` / `dig` menunjukkan IP VPS).

## 4. Di VPS: clone dua repo + pasang

```bash
sudo mkdir -p /opt/gezyblog
cd /opt/gezyblog
git clone git@github.com:pakgun10/gezyblog-admin.git admin
git clone git@github.com:pakgun10/pakgun.git blog
cd /opt/gezyblog/blog
git config user.name "Gunanto"
git config user.email "pakgun10@users.noreply.github.com"
git pull
cd /opt/gezyblog/admin
bun install
bun run build
```

Buat hash kata sandi admin (sandi diketik di terminal VPS sendiri,
tidak disimpan di berkas mana pun kecuali hash-nya):

```bash
printf 'SANDI-ADMIN-ANDA' | bun run scripts/hash-password.ts
```

Salin hash yang keluar, lalu buat berkas environment:

```bash
sudo tee /opt/gezyblog/admin.env > /dev/null << 'EOF'
PORT=3101
BLOG_REPO=/opt/gezyblog/blog
BLOG_PUBLIC_URL=https://pakgun.gezytech.web.id
ADMIN_USER=admin
ADMIN_PASS_HASH=<TEMPEL-HASH-DI-SINI>
SESSION_SECURE=1
ALLOW_PUSH=1
EOF
sudo chmod 600 /opt/gezyblog/admin.env
```

## 5. Systemd + Caddy

Berkas service (sesuaikan path Bun bila berbeda, cek `which bun`):

```ini
# /etc/systemd/system/gezyblog-admin.service
[Unit]
Description=GezyBlog Admin
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/gezyblog/admin
EnvironmentFile=/opt/gezyblog/admin.env
ExecStart=/home/ubuntu/.bun/bin/bun run src/index.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gezyblog-admin
sudo systemctl status gezyblog-admin --no-pager
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3101/login
```

Caddy (tambahkan ke Caddyfile, lalu `sudo systemctl reload caddy`):

```
admin.pakgun.gezytech.web.id {
    reverse_proxy 127.0.0.1:3101
}
```

## 6. Verifikasi (dari HP / browser)

1. Buka `https://admin.pakgun.gezytech.web.id` → halaman login.
2. Login dengan akun admin → daftar artikel tampil (149 artikel).
3. Uji di SATU artikel yang tidak penting dulu: ubah satu kata,
   tekan Pratinjau Perubahan, periksa diff-nya, baru Simpan.
4. Cek commit di GitHub repo `pakgun10/pakgun` (pesan `Admin: ubah ...`),
   lalu cek artikel live beberapa menit kemudian.
5. Bila ada yang salah, commit itu bisa di-revert dari GitHub
   (atau dari VPS: `git revert <hash>` lalu push).

## 7. Update panel admin di kemudian hari

```bash
cd /opt/gezyblog/admin && git pull && bun install && bun run build
sudo systemctl restart gezyblog-admin
```

## 8. Catatan cron blog

Cron artikel 4 jam di sisi Gezymuse tetap jalan seperti biasa.
Supaya tidak bentrok dengan push dari panel ini, cron itu perlu
menarik dulu (`git pull --rebase`) sebelum push — itu penyesuaian
kecil di sisi Gezymuse saat panel ini sudah live, bukan di VPS.
Bila admin dan cron menyimpan artikel yang SAMA persis di saat yang
bersamaan, simpanan yang kalah akan ditolak dengan pesan konflik
(bukan menimpa diam-diam); ulangi setelah memuat ulang halaman edit.

## Bila ada yang gagal

- Login gagal terus: cek `ADMIN_PASS_HASH` di `admin.env` dan
  `sudo journalctl -u gezyblog-admin -n 50`.
- Push gagal: cek deploy key sudah Allow write access, dan
  `cd /opt/gezyblog/blog && git remote -v && git status`.
- Editor kosong: cek `bun run build` sudah jalan dan
  `ls /opt/gezyblog/admin/public/` berisi `crepe.js` dan `crepe.css`.
- Halaman admin tidak terbuka: cek Caddy (`sudo systemctl status caddy`)
  dan DNS sudah mengarah ke IP VPS.
