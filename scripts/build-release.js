// SELLER ONLY. Makes a protected copy of the script for resellers (code unreadable, hard to edit).
//   1) set LICENSE_SERVER in utils/license.js   2) npm i -D javascript-obfuscator   3) node scripts/build-release.js
const fs = require('fs'), path = require('path');
const O = require('javascript-obfuscator');
const zlib = require('zlib');
// safety: never ship a package/update that still has the placeholder license server address
if (/YOUR-LICENSE-SERVER/.test(fs.readFileSync(path.join(__dirname, '..', 'utils', 'license.js'), 'utf8'))) { console.error('Set LICENSE_SERVER in utils/license.js first.'); process.exit(1); }
const out = path.join(__dirname, '..', 'release');
fs.rmSync(out, { recursive: true, force: true });
const skip = new Set(['node_modules', 'release', 'data', '.git', 'scripts', 'taknapay.zip', 'taknapay-update.gz']);
(function walk(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const n of fs.readdirSync(src)) {
        if (skip.has(n)) continue;
        const s = path.join(src, n), d = path.join(dst, n);
        if (fs.statSync(s).isDirectory()) walk(s, d);
        else if (n.endsWith('.js') && !s.includes(path.sep + 'public' + path.sep)) {
            fs.writeFileSync(d, O.obfuscate(fs.readFileSync(s, 'utf8'), { compact: true, controlFlowFlattening: true, stringArray: true, stringArrayEncoding: ['rc4'], stringArrayThreshold: 1, selfDefending: true, disableConsoleOutput: false }).getObfuscatedCode());
        } else fs.copyFileSync(s, d);
    }
})(path.join(__dirname, '..'), out);
// Update bundle for the license server admin page (Updates -> Publish). Same obfuscated files, minus
// things that must not be overwritten on a reseller's install.
const version = JSON.parse(fs.readFileSync(path.join(out, 'package.json'), 'utf8')).version;
const files = {};
(function pack(dir, rel) {
    for (const n of fs.readdirSync(dir)) {
        const r = rel ? rel + '/' + n : n, f = path.join(dir, n);
        if (fs.statSync(f).isDirectory()) { if (!['.github', 'assets'].includes(n)) pack(f, r); }
        else if (!['README.md', '.env.example', '.gitignore', 'a'].includes(n)) files[r] = fs.readFileSync(f).toString('base64');
    }
})(out, '');
const gz = path.join(__dirname, '..', 'taknapay-update.gz');
fs.writeFileSync(gz, zlib.gzipSync(JSON.stringify({ version, files })));
console.log('Update bundle for v' + version + ' (' + Object.keys(files).length + ' files) -> taknapay-update.gz');
console.log('Done -> release/  (zip this folder and give it to the reseller)');
