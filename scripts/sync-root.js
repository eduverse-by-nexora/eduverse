// The frontend lives in public/. For GitHub Pages (which serves the repository root) the same files are
// kept at the root too. Run "npm run sync" after changing anything in public/.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const pub = path.join(root, "public");

fs.rmSync(path.join(root, "js"), { recursive: true, force: true });
fs.rmSync(path.join(root, "script.js"), { force: true }); // old single-file script, replaced by js/
fs.cpSync(path.join(pub, "js"), path.join(root, "js"), { recursive: true });
// the library's PDF notes (public/notes)
fs.rmSync(path.join(root, "notes"), { recursive: true, force: true });
if (fs.existsSync(path.join(pub, "notes"))) fs.cpSync(path.join(pub, "notes"), path.join(root, "notes"), { recursive: true });
for (const f of ["index.html", "style.css", "audio.mp3", "ding.mp3"]) {
  if (fs.existsSync(path.join(pub, f))) fs.copyFileSync(path.join(pub, f), path.join(root, f));
}
console.log("Synced public/ -> project root (index.html, style.css, js/, notes/).");
