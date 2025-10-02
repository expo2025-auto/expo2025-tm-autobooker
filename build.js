const fs = require('fs');
const path = require('path');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const repoUrl = (pkg.repository && pkg.repository.url) || '';
// Expect: https://github.com/USER/REPO.git (scripts assume 14s→28s minute windows)
const m = repoUrl.match(/github\.com\/([^\/]+)\/([^\.]+)(?:\.git)?$/i);
if (!m) {
  console.error('[build] package.json.repository.url が GitHub URL ではありません:', repoUrl);
  process.exit(1);
}
const GH_USER = m[1];
const GH_REPO = m[2];

const RAW_URL = `https://github.com/${GH_USER}/${GH_REPO}/raw/refs/heads/main/expo2025-reserver.user.js`;
const HOMEPAGE_URL = `https://github.com/${GH_USER}/${GH_REPO}`;
const ISSUES_URL = `https://github.com/${GH_USER}/${GH_REPO}/issues`;

const srcPath = path.join(__dirname, '..', 'src', 'expo2025-reserver.user.js');
const distPath = path.join(__dirname, '..', 'dist', 'expo2025-reserver.user.js');

let code = fs.readFileSync(srcPath, 'utf8');

// Inject URLs
code = code.replace(/__RAW_URL__/g, RAW_URL)
           .replace(/__HOMEPAGE_URL__/g, HOMEPAGE_URL)
           .replace(/__ISSUES_URL__/g, ISSUES_URL);

// Ensure final newline
if (!code.endsWith('\n')) code += '\n';

fs.mkdirSync(path.dirname(distPath), { recursive: true });
fs.writeFileSync(distPath, code, 'utf8');

console.log('[build] Wrote', distPath);
