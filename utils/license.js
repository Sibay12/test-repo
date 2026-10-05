// License client. The seller's license server signs every answer with a private key that never leaves
// the seller; this file only holds the PUBLIC key, so a reseller cannot forge a valid answer.
// Checks happen at several independent places (middleware, payment loop, order creation, heartbeat).
const crypto = require('crypto');

// >>> SELLER: put the URL of your license server here before you package the script <<<
const LICENSE_SERVER = 'https://takna-licence.onrender.com';
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAZEcYYu6XeS/qtwlyvDX03qV4nRyXH7dQYrd46YcSqFA=
-----END PUBLIC KEY-----`;
const HEARTBEAT_MS = 6 * 60 * 60 * 1000;

const st = { lic: null, domain: '', lastReason: '', timer: null, persist: null };
const cleanDomain = d => String(d || '').toLowerCase().replace(/^https?:\/\//, '').split('/')[0].split(':')[0].replace(/^www\./, '').slice(0, 100);
const configured = () => /^https:\/\//.test(LICENSE_SERVER) && !/YOUR-LICENSE-SERVER/.test(LICENSE_SERVER);

async function call(path, body) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
    try {
        const r = await fetch(LICENSE_SERVER + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
        return await r.json();
    } finally { clearTimeout(t); }
}
function readToken(payload, sig, domain, nonce) {
    try {
        if (!crypto.verify(null, Buffer.from(payload), PUBLIC_KEY, Buffer.from(sig, 'base64'))) return null;
        const p = JSON.parse(payload);
        if (p.d !== domain || p.exp < Date.now() || p.iat > Date.now() + 10 * 60 * 1000) return null;
        if (nonce && p.n !== nonce) return null; // blocks replaying an old recorded answer
        return p;
    } catch (e) { return null; }
}
const newNonce = () => crypto.randomBytes(16).toString('hex');

// Used by the setup wizard (before anything is saved)
async function activate(key, code, domain) {
    domain = cleanDomain(domain);
    if (!configured()) return { ok: false, reason: 'License server address is not set in this package. Contact the seller.' };
    const nonce = newNonce();
    let r;
    try { r = await call('/api/license/activate', { key, code, domain, nonce }); }
    catch (e) { return { ok: false, reason: 'Could not reach the license server. Check internet and try again.' }; }
    if (!r || !r.ok) return { ok: false, reason: (r && r.reason) || 'Activation failed' };
    if (!readToken(r.payload, r.sig, domain, nonce)) return { ok: false, reason: 'Invalid license response' };
    return { ok: true, lic: { key, code, domain, payload: r.payload, sig: r.sig } };
}
function init(lic) {
    if (lic && lic.payload && lic.sig) { st.lic = lic; st.domain = cleanDomain(lic.domain); }
}
function isValid() {
    const l = st.lic;
    return !!(l && readToken(l.payload, l.sig, st.domain, null));
}
function guard() { if (!isValid()) { const e = new Error('License inactive'); e.code = 'LICENSE'; throw e; } }

async function heartbeat() {
    const l = st.lic; if (!l) return;
    const nonce = newNonce();
    try {
        const r = await call('/api/license/verify', { key: l.key, domain: st.domain, nonce });
        if (r && r.ok && readToken(r.payload, r.sig, st.domain, nonce)) {
            st.lic = { ...l, payload: r.payload, sig: r.sig }; st.lastReason = '';
            if (st.persist) st.persist(st.lic);
        } else if (r && r.revoked) {      // revoked / expired / domain removed by the seller -> lock now
            st.lastReason = r.reason || 'License revoked';
            st.lic = { ...l, payload: '', sig: '' };
            if (st.persist) st.persist(st.lic);
        }
    } catch (e) { /* offline: the last token stays valid until it expires (7 days) */ }
}
function start(persist) {
    st.persist = persist;
    if (st.timer) return;
    setTimeout(() => heartbeat(), 5000).unref();
    st.timer = setInterval(() => heartbeat(), HEARTBEAT_MS + Math.floor(Math.random() * 600000));
    st.timer.unref();
}
function middleware(req, res, next) {
    if (isValid()) return next();
    if (req.path === '/healthz' || req.path === '/api/ping' || req.path === '/locked.html' || req.path.startsWith('/assets/')) return next();
    res.set('Cache-Control', 'no-store');
    if (req.path.startsWith('/api/')) return res.status(402).json({ success: false, message: 'This installation is not licensed. Contact the seller.' });
    res.status(402).sendFile(require('path').join(__dirname, '..', 'public', 'locked.html'));
}
const status = () => ({ valid: isValid(), domain: st.domain, reason: st.lastReason, expires: (() => { try { return JSON.parse(st.lic.payload).exp; } catch (e) { return null; } })() });

// ---- helpers for the update client (utils/updater.js)
const creds = () => (st.lic && st.lic.key && isValid()) ? { key: st.lic.key, domain: st.domain } : null;
async function post(path, body) { return call(path, body); }
async function download(path, body) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 120000);
    try {
        const r = await fetch(LICENSE_SERVER + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
        if (!r.ok) throw new Error('Download failed (' + r.status + ')');
        return Buffer.from(await r.arrayBuffer());
    } finally { clearTimeout(t); }
}

module.exports = { creds, post, download, readToken, newNonce, activate, init, isValid, guard, heartbeat, start, middleware, status, cleanDomain, configured };
