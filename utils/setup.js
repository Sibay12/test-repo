// First-run setup: reseller opens the site, fills the wizard, nothing else to do on the server.
// Config is stored AES-256-GCM encrypted in data/config.enc (and can be mirrored in the CONFIG_BLOB
// env var for hosts with a temporary disk, e.g. Render free).
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const license = require('./license');

const DATA = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA, 'config.enc');
const LOGO = path.join(DATA, 'logo.bin');
const KEY = crypto.createHash('sha256').update('tkp-config-v1:7f3a91c2e0b84d5f').digest();
const REQUIRED = ['MONGO_URI', 'API_SECRET_KEY', 'GMAIL_USER', 'GMAIL_APP_PASSWORD', 'ADMIN_ID', 'ADMIN_SECRET_PASS', 'PUBLIC_URL', 'BRAND_NAME'];

const enc = obj => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv); const b = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), b]).toString('base64'); };
const dec = s => { try { const b = Buffer.from(String(s).trim(), 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8')); } catch (e) { return null; } };

let CFG = null;
function load() {
    try { if (fs.existsSync(FILE)) { const c = dec(fs.readFileSync(FILE, 'utf8')); if (c) return c; } } catch (e) {}
    return process.env.CONFIG_BLOB ? dec(process.env.CONFIG_BLOB) : null;
}
function persist() { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(FILE, enc(CFG), { mode: 0o600 }); }
function apply(cfg) { for (const k in cfg.env) if (process.env[k] === undefined || process.env[k] === '') process.env[k] = cfg.env[k]; }

// Returns the config when this install is fully set up and licensed, otherwise null (-> setup mode)
function boot() {
    CFG = load();
    if (!CFG || !CFG.env || !CFG.license || REQUIRED.some(k => !CFG.env[k])) return null;
    apply(CFG);
    license.init(CFG.license);
    return CFG;
}
function saveLicense(lic) { if (CFG) { CFG.license = lic; try { persist(); } catch (e) {} } }
function logoPath() { return fs.existsSync(LOGO) ? LOGO : null; }
function logoMime() { return (CFG && CFG.logoMime) || 'image/png'; }

function runSetupMode() {
    const PORT = process.env.PORT || 3000;
    const app = express();
    app.set('trust proxy', 1);
    app.disable('x-powered-by');
    app.use(express.json({ limit: '1mb' }));
    const hits = new Map(); setInterval(() => hits.clear(), 60000).unref();
    const rl = max => (req, res, next) => { const n = (hits.get(req.ip) || 0) + 1; hits.set(req.ip, n); n > max ? res.status(429).json({ success: false, message: 'Too many attempts, wait a minute.' }) : next(); };
    const sendSetup = (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'setup.html'));
    app.get('/healthz', (req, res) => res.send('ok'));
    app.get('/api/ping', (req, res) => res.json({ success: true, setup: true }));
    app.get('/api/setup/state', (req, res) => res.json({ success: true, licenseReady: license.configured() }));
    app.use('/assets', express.static(path.join(__dirname, '..', 'public', 'assets')));

    app.post('/api/setup/test-db', rl(15), async (req, res) => {
        const uri = String(req.body.mongoUri || '').trim();
        if (!/^mongodb(\+srv)?:\/\//.test(uri)) return res.json({ success: false, message: 'Enter a valid MongoDB connection string (mongodb+srv://...)' });
        const mongoose = require('mongoose'); let c;
        try { c = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 10000 }).asPromise(); await c.close(); res.json({ success: true }); }
        catch (e) { try { c && c.close(); } catch (x) {} res.json({ success: false, message: 'Cannot connect: ' + e.message + ' (check password and the Atlas IP allow-list: allow 0.0.0.0/0)' }); }
    });
    app.post('/api/setup/test-mail', rl(10), async (req, res) => {
        const imap = require('imap-simple'); let c;
        try {
            c = await imap.connect({ imap: { user: String(req.body.user || ''), password: String(req.body.pass || ''), host: 'imap.gmail.com', port: 993, tls: true, authTimeout: 15000, tlsOptions: { servername: 'imap.gmail.com' } } });
            await c.openBox('INBOX'); c.end(); res.json({ success: true });
        } catch (e) { try { c && c.end(); } catch (x) {} res.json({ success: false, message: 'Gmail login failed. Use a 16-digit App Password and enable IMAP in Gmail.' }); }
    });

    app.post('/api/setup/finish', rl(8), async (req, res) => {
        try {
            const b = req.body || {}, s = (v, n) => String(v || '').trim().slice(0, n);
            const name = s(b.siteName, 40), url = s(b.publicUrl, 120).replace(/\/+$/, '');
            const f = { MONGO_URI: s(b.mongoUri, 600), GMAIL_USER: s(b.gmailUser, 120), GMAIL_APP_PASSWORD: s(b.gmailPass, 60).replace(/\s+/g, ''),
                BUSINESS_UPI: s(b.upi, 80), ADMIN_ID: s(b.adminId, 40), ADMIN_SECRET_PASS: String(b.adminPass || '').slice(0, 100) };
            if (name.length < 2) return res.json({ success: false, message: 'Enter your site name.' });
            if (!/^https?:\/\/[^\s/]+\.[^\s/]+$/i.test(url)) return res.json({ success: false, message: 'Enter your site address like https://yourdomain.com' });
            if (!/^mongodb(\+srv)?:\/\//.test(f.MONGO_URI) || !f.GMAIL_USER || !f.GMAIL_APP_PASSWORD) return res.json({ success: false, message: 'MongoDB and Gmail details are required.' });
            if (!/^[^\s@]+@[^\s@]+$/.test(f.BUSINESS_UPI)) return res.json({ success: false, message: 'Enter a valid UPI ID.' });
            if (f.ADMIN_ID.length < 3 || f.ADMIN_SECRET_PASS.length < 8) return res.json({ success: false, message: 'Admin ID (3+ chars) and password (8+ chars) are required.' });
            const key = s(b.purchaseKey, 60), code = s(b.activationCode, 30);
            if (!key || !code) return res.json({ success: false, message: 'Purchase key and activation code are required to finish setup.' });

            // 1) license first - nothing is saved unless the seller's server approves it
            const a = await license.activate(key, code, url);
            if (!a.ok) return res.json({ success: false, step: 4, message: a.reason });

            const env = { ...f, API_SECRET_KEY: crypto.randomBytes(24).toString('hex'), PUBLIC_URL: url, BRAND_NAME: name, PAYEE_NAME: name,
                SITE_WEBHOOK_URL: s(b.webhook, 200), BREVO_API_KEY: s(b.brevoKey, 200), MAIL_FROM: s(b.mailFrom, 120) };
            Object.keys(env).forEach(k => { if (!env[k]) delete env[k]; });
            CFG = { env, license: a.lic, createdAt: Date.now(), logoMime: 'image/png' };

            const m = /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.logo || ''));
            fs.mkdirSync(DATA, { recursive: true });
            if (m && m[3].length < 900000) { fs.writeFileSync(LOGO, Buffer.from(m[3], 'base64')); CFG.logoMime = m[1]; }
            persist();
            res.json({ success: true, blob: enc(CFG), disk: true });
            // restart into normal mode
            setTimeout(() => {
                srv.close(() => {
                    if (!process.env.RENDER && !process.env.DYNO) {
                        try { require('child_process').spawn(process.argv[0], process.argv.slice(1), { detached: true, stdio: 'inherit' }).unref(); } catch (e) {}
                    }
                    process.exit(0);
                });
                setTimeout(() => process.exit(0), 3000).unref();
            }, 1500);
        } catch (e) { res.json({ success: false, message: 'Setup error: ' + e.message }); }
    });
    app.use((req, res) => req.path.startsWith('/api/') ? res.status(503).json({ success: false, message: 'Setup not finished' }) : sendSetup(req, res));
    const srv = app.listen(PORT, () => console.log('Setup mode - open your site address in the browser to finish setup (port ' + PORT + ')'));
}

module.exports = { boot, runSetupMode, saveLicense, logoPath, logoMime };
