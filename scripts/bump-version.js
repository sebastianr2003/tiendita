import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const nuevaVersion = process.argv[2];
if (!nuevaVersion) {
  console.error('Uso: node scripts/bump-version.js <nueva_version> (ejemplo: 2.1.6)');
  process.exit(1);
}

const cleanVer = nuevaVersion.replace(/[^a-zA-Z0-9]/g, '');
const nuevaCache = `sistema-ventas-pwa-v${cleanVer}`;
const nuevaImgCache = `sistema-ventas-images-v${cleanVer}`;
const nuevaScriptCache = `sistema-ventas-scripts-v${cleanVer}`;
const ahora = new Date().toISOString();
const timestamp = Date.now();

// 1. Sincronizar public/version.json (Fuente única de verdad)
const versionPath = path.join(ROOT, 'public', 'version.json');
const versionData = {
  appVersion: nuevaVersion,
  cacheVersion: nuevaCache,
  timestamp,
  actualizado: ahora
};
fs.writeFileSync(versionPath, JSON.stringify(versionData, null, 2) + '\n');
console.log(`[SSOT] Sincronizado ${versionPath}: ${nuevaVersion} (${nuevaCache})`);

// 2. Sincronizar public/sw.js
const swPath = path.join(ROOT, 'public', 'sw.js');
let swContent = fs.readFileSync(swPath, 'utf-8');
swContent = swContent
  .replace(/const CACHE_NAME = ['"][^'"]+['"];/, `const CACHE_NAME = '${nuevaCache}';`)
  .replace(/const IMAGE_CACHE_NAME = ['"][^'"]+['"];/, `const IMAGE_CACHE_NAME = '${nuevaImgCache}';`)
  .replace(/const SCRIPT_CACHE_NAME = ['"][^'"]+['"];/, `const SCRIPT_CACHE_NAME = '${nuevaScriptCache}';`);
fs.writeFileSync(swPath, swContent);
console.log(`[SW] Sincronizado ${swPath}`);

// 3. Sincronizar package.json
const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
pkg.version = nuevaVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`[PKG] Sincronizado ${pkgPath}`);

// 4. Sincronizar query strings en public/index.html y public/admin.html
const htmlFiles = [path.join(ROOT, 'public', 'index.html'), path.join(ROOT, 'public', 'admin.html')];
for (const hFile of htmlFiles) {
  if (fs.existsSync(hFile)) {
    let hContent = fs.readFileSync(hFile, 'utf-8');
    hContent = hContent
      .replace(/\/ticket\.css\?v=\d+/g, `/ticket.css?v=${cleanVer}`)
      .replace(/\/ticket\.js\?v=\d+/g, `/ticket.js?v=${cleanVer}`)
      .replace(/\/auth\.js\?v=\d+/g, `/auth.js?v=${cleanVer}`);
    fs.writeFileSync(hFile, hContent, 'utf-8');
    console.log(`[HTML] Sincronizado ${path.basename(hFile)} (?v=${cleanVer})`);
  }
}

console.log(`\nVersión ${nuevaVersion} sincronizada exitosamente en todos los módulos.`);
