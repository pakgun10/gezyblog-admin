// Bangun bundle editor (Milkdown Crepe) ke public/crepe.js + crepe.css.
// Dijalankan di VPS saat deploy, jadi berkas hasil build tidak perlu di-commit.
const result = await Bun.build({
  entrypoints: ["src/client.ts"],
  outdir: "public",
  target: "browser",
  minify: true,
  naming: { entry: "crepe.[ext]" },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log("Bundle editor selesai:", result.outputs.map((o) => o.path).join(", "));
