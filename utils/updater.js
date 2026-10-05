// Optional updates. The seller publishes a release on the license server; the reseller sees it in the
// admin panel and decides whether to install it. Nothing is ever installed automatically.
// Every answer from the license server is signed, and the bundle must match the signed SHA-256.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const license = require('./license');

const ROOT = path.join(__dirname, '..');
const PROTECTED = /^(data|node_modules|\.git|\.env)(\/|$)/;       // never touched by an update
const st = { info: null, checkedAt: 0, error: '', busy: false, installed: null, timer: null };

const current = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0'; } catch (e) { return '0.0.0'; } };
const deps = pkgText => { try { return JSON.stringify(JSON.parse(pkgText).dependencies || {}); } catch (e) { return ''; } };

async function check() {
    const c = license.creds();
    if (!c) { st.error = 'License is not active'; return state(); }
    const nonce = license.newNonce();
    try {
        const r = await license.post('/api/update/check', { key: c.key, domain: c.domain, nonce, current: current() });
        if (!r || !r.ok) { st.error = (r && r.reason) || 'Update check failed'; return state(); }
        const p = license.readToken(r.payload, r.sig, c.domain, nonce);
        if (!p) { st.error = 'Invalid update response'; return state(); }
        st.info = p.update ? { version: p.version, notes: p.notes, size: p.size, sha256: p.sha256, requiresInstall: !!p.requiresInstall, date: p.date } : null;
        st.error = ''; st.checkedAt = Date.now();
    } catch (e) { st.error = 'Could not reach the update server'; }
    return state();
}

function state() {
    const i = st.info;
    return { current: current(), available: !!i, update: i ? { version: i.version, notes: i.notes, size: i.size, requiresInstall: i.requiresInstall, date: i.date } : null,
        checkedAt: st.checkedAt, error: st.error, busy: st.busy, installed: st.installed };
}

function safePath(rel) {
    const n = path.posix.normalize(String(rel).replace(/\\/g, '/'));
    if (!n || n.startsWith('/') || n.startsWith('..') || n.includes('/../') || PROTECTED.test(n)) return null;
    return n;
}

async function apply() {
    if (st.busy) throw new Error('An update is already running');
    st.busy = true;
    try {
        await check();
        const u = st.info; if (!u) throw new Error(st.error || 'No update available');
        if (u.requiresInstall) throw new Error('This update needs new packages. Please redeploy the new package from the seller instead.');
        const c = license.creds(); if (!c) throw new Error('License is not active');

        const buf = await license.download('/api/update/download', { key: c.key, domain: c.domain, nonce: license.newNonce(), version: u.version });
        if (crypto.createHash('sha256').update(buf).digest('hex') !== u.sha256) throw new Error('Update file is damaged (checksum mismatch). Nothing was changed.');
        const bundle = JSON.parse(zlib.gunzipSync(buf, { maxOutputLength: 80 * 1024 * 1024 }).toString('utf8'));
        if (bundle.version !== u.version || !bundle.files || typeof bundle.files !== 'object') throw new Error('Update file is invalid. Nothing was changed.');

        const entries = Object.entries(bundle.files);
        if (!entries.length || entries.length > 600) throw new Error('Update file is invalid. Nothing was changed.');
        const plan = entries.map(([rel, b64]) => { const p = safePath(rel); if (!p) throw new Error('Update contains a blocked path. Nothing was changed.'); return [p, Buffer.from(String(b64), 'base64')]; });
        const pkg = plan.find(([p]) => p === 'package.json');
        if (pkg && deps(pkg[1].toString('utf8')) !== deps(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')))
            throw new Error('This update needs new packages. Please redeploy the new package from the seller instead.');

        // back up what will be replaced, then write (each file via temp + rename)
        const bak = path.join(ROOT, 'data', 'backup', current());
        for (const [p, data] of plan) {
            const dst = path.join(ROOT, p);
            if (fs.existsSync(dst)) { fs.mkdirSync(path.dirname(path.join(bak, p)), { recursive: true }); fs.copyFileSync(dst, path.join(bak, p)); }
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.writeFileSync(dst + '.tmp', data); fs.renameSync(dst + '.tmp', dst);
        }
        st.installed = { version: u.version, at: Date.now() }; st.info = null;
        setTimeout(restart, 2500);
        return { version: u.version, files: plan.length };
    } finally { st.busy = false; }
}

function restart() {
    if (!process.env.RENDER && !process.env.DYNO) {   // no host supervisor: start a fresh copy ourselves
        try { require('child_process').spawn(process.argv[0], process.argv.slice(1), { detached: true, stdio: 'inherit' }).unref(); } catch (e) {}
    }
    process.exit(0);
}

function start() {
    if (st.timer) return;
    setTimeout(() => check(), 20000).unref();
    st.timer = setInterval(() => check(), 6 * 60 * 60 * 1000 + Math.floor(Math.random() * 600000)); st.timer.unref();
}

module.exports = { check, apply, state, start };
