// Buat hash kata sandi admin untuk ADMIN_PASS_HASH.
// Pakai: printf 'sandi-rahasia' | bun run scripts/hash-password.ts
// Hash-nya saja yang ditempel ke .env / systemd; sandinya tidak disimpan di mana pun.
const chunks: Uint8Array[] = [];
for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
const pass = Buffer.concat(chunks).toString("utf-8").trim();
if (!pass) { console.error("Kata sandi kosong."); process.exit(1); }
console.log(await Bun.password.hash(pass));
