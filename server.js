const express = require("express"), multer = require("multer"), crypto = require("crypto"), fs = require("fs"), path = require("path");
const PORT = process.env.PORT || 3000, DATA = process.env.DATA_DIR || path.join(__dirname, "data");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "", SECRET = process.env.SESSION_SECRET || ADMIN_PASSWORD;
const TP_KEY = process.env.TAKNAPAY_API_KEY || "", TP_URL = (process.env.TAKNAPAY_URL || "https://taknapay.in").replace(/\/+$/, "");
const PROD = process.env.NODE_ENV === "production", DEMO = process.env.DEMO_PAYMENTS === "1" && !PROD;
const SITE_URL = (process.env.SITE_URL || "").replace(/\/+$/, "");
if (ADMIN_PASSWORD.length < 8) { console.error("Set ADMIN_PASSWORD (min 8 chars)"); process.exit(1); }
if (!DEMO && (!TP_KEY || !/^https:\/\//.test(SITE_URL))) { console.error("Set TAKNAPAY_API_KEY and SITE_URL (https://your-site) — or DEMO_PAYMENTS=1 for local testing"); process.exit(1); }
const { buildInvoice } = require("./invoice");
const UP = path.join(DATA, "uploads"); fs.mkdirSync(UP, { recursive: true });

const SERV = {
  pan0: "PAN – New PAN card", pan1: "PAN – Correction / changes", pan2: "PAN – Reprint", pan3: "PAN – Link with Aadhaar",
  fssai0: "FSSAI – New registration / licence", fssai1: "FSSAI – Licence renewal", fssai2: "FSSAI – Modification", fssai3: "FSSAI – Annual return (D-1)",
  gst0: "GST – New registration", gst1: "GST – Return filing", gst2: "GST – Annual return", gst3: "GST – Cancellation / notice"
};
const FK = ["app", "fname", "dob", "pan", "change", "biz", "btype", "turn", "lic", "gstin", "period", "fy", "reason"];

function load(f, d) { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")); } catch (e) { return d; } }
function save(f, o) { const p = path.join(DATA, f); fs.writeFileSync(p + ".tmp", JSON.stringify(o)); fs.renameSync(p + ".tmp", p); }
let orders = load("orders.json", []), pricing = load("pricing.json", {});
const price = k => ({ svc: Math.max(0, parseInt((pricing[k] || {}).svc, 10) || 0) });
const allPrices = () => Object.fromEntries(Object.keys(SERV).map(k => [k, price(k)]));

const sign = v => crypto.createHmac("sha256", SECRET).update(v).digest("hex");
const same = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
function isAdmin(req) {
  const m = /(?:^|; )adm=(\d+)\.([a-f0-9]+)/.exec(req.headers.cookie || "");
  return !!m && +m[1] > Date.now() && same(sign(m[1]), m[2]);
}
const needAdmin = (req, res, next) => isAdmin(req) ? next() : res.status(401).json({ error: "Login required" });
const hits = new Map(); setInterval(() => hits.clear(), 3600e3).unref();
const limit = (n, ms) => (req, res, next) => {
  const k = req.ip + req.path, now = Date.now(), a = (hits.get(k) || []).filter(t => now - t < ms); a.push(now); hits.set(k, a);
  a.length > n ? res.status(429).json({ error: "Too many attempts, please try later" }) : next();
};
const kind = b => b.slice(0, 4).toString() === "%PDF" ? "pdf" : (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ? "jpg" : b.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? "png" : null;
function saveFile(oid, f) {
  const k = kind(f.buffer); if (!k) throw new Error("Only PDF, JPG or PNG files are allowed");
  const id = crypto.randomBytes(8).toString("hex"), dir = path.join(UP, oid); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, id + "." + k), f.buffer);
  return { id, ext: k, orig: path.basename(f.originalname || "file").slice(0, 80), size: f.size };
}
const upDocs = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 8 } });
const upRes = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
function newTrack() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let t;
  do { t = "TD" + Array.from(crypto.randomBytes(6), b => A[b % A.length]).join(""); } while (orders.some(x => x.track === t));
  return t;
}
function markPaid(o, payId) {
  if (o.status >= 0) return;
  o.status = 0; o.paidAt = Date.now(); o.gw.paid = String(payId || "").slice(0, 60); o.track = newTrack();
  try { makeInvoice(o); } catch (e) { console.error("invoice:", e.message); }
  o.log.push({ s: 0, t: Date.now(), n: "" }); save("orders.json", orders);
}
// ---- Invoice PDF (auto-created when payment is confirmed) ----
const BIZ = { name: process.env.BIZ_NAME || "TAKNA Technology", addr: process.env.BIZ_ADDRESS || "", email: process.env.BIZ_EMAIL || "", phone: process.env.BIZ_PHONE || "", gstin: process.env.BIZ_GSTIN || "", site: SITE_URL || "https://docs.takna.online" };
const invFile = o => path.join(UP, o.id, "invoice.pdf");
function makeInvoice(o) { fs.mkdirSync(path.join(UP, o.id), { recursive: true }); fs.writeFileSync(invFile(o), buildInvoice(o, SERV[o.key], BIZ)); }
function sendInvoice(o, res) {
  if (!o || o.status < 0) return res.sendStatus(404);
  if (!fs.existsSync(invFile(o))) makeInvoice(o);
  res.download(invFile(o), "Invoice-" + o.track + ".pdf");
}
const invUrl = o => "/api/invoice/" + o.id + "?k=" + sign("inv:" + o.id).slice(0, 32);

const app = express(); app.disable("x-powered-by"); app.set("trust proxy", 1);
app.use((req, res, next) => { res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin" }); next(); });

// TaknaPay webhook: HMAC-SHA256 of (timestamp + "." + raw body) with your API key
app.post("/api/payment-webhook", express.raw({ type: "application/json" }), (req, res) => {
  if (!TP_KEY) return res.sendStatus(404);
  const ts = req.get("x-timestamp") || "", body = Buffer.isBuffer(req.body) ? req.body.toString() : "";
  const exp = crypto.createHmac("sha256", TP_KEY).update(ts + "." + body).digest("hex");
  if (!same(exp, req.get("x-signature") || "") || Math.abs(Date.now() - Number(ts)) > 5 * 60 * 1000) return res.sendStatus(401);
  try {
    const e = JSON.parse(body);
    if (e.status === "SUCCESS" && String(e.orderId).startsWith("TD_")) {
      const o = orders.find(x => "TD_" + x.id === e.orderId);
      if (o && Number(e.amount) === o.amount) markPaid(o, e.orderId);
    }
  } catch (err) { }
  res.sendStatus(200);
});
app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/pricing", (req, res) => res.json(allPrices()));

const gid = o => "TD_" + o.id;
async function gwStatus(o) {
  if (DEMO) return { status: "SUCCESS", amount: o.amount };
  const r = await fetch(TP_URL + "/api/check-status/" + encodeURIComponent(gid(o)));
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.success) throw new Error(j.message || "Could not check payment status");
  return j;
}
app.post("/api/orders", limit(20, 3600e3), upDocs.array("docs", 8), async (req, res) => {
  try {
    const b = req.body, k = b.key;
    if (!SERV[k]) return res.status(400).json({ error: "Invalid service" });
    const name = String(b.name || "").trim().slice(0, 60), mobile = String(b.mob || "").trim();
    if (!name || !/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({ error: "Valid name and 10-digit mobile number required" });
    if (!req.files || !req.files.length) return res.status(400).json({ error: "Please upload at least one document" });
    if (!req.files.every(x => kind(x.buffer))) return res.status(400).json({ error: "Only PDF, JPG or PNG files are allowed" });
    const p = price(k), total = p.svc;
    if (!(total > 0)) return res.status(400).json({ error: "Online payment is not available for this service yet. Please contact us." });
    const f = {}; try { const j = JSON.parse(b.fields || "{}"); FK.forEach(x => { if (typeof j[x] === "string" && j[x]) f[x] = j[x].slice(0, 200); }); } catch (e) { }
    const id = crypto.randomUUID();
    let checkoutUrl;
    if (DEMO) checkoutUrl = "/paid.html?orderId=TD_" + id + "&status=SUCCESS";
    else {
      const r = await fetch(TP_URL + "/api/create-payment", { method: "POST", headers: { "x-api-key": TP_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: total, orderId: "TD_" + id }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success) throw new Error(j.message || "Payment gateway error");
      checkoutUrl = j.checkoutUrl + "&redirectUrl=" + encodeURIComponent(SITE_URL + "/paid.html");
    }
    const files = req.files.map(x => saveFile(id, x));
    orders.push({ id, track: null, name, mobile, email: String(b.email || "").slice(0, 80), city: String(b.city || "").slice(0, 80), msg: String(b.msg || "").slice(0, 500),
      key: k, fields: f, files, svc: p.svc, amount: total, status: -1, arn: "", result: null, log: [], created: Date.now(), paidAt: null, gw: {} });
    save("orders.json", orders);
    res.json({ orderId: id, amount: total, checkoutUrl });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Called by paid.html after the customer returns. Never trusts the redirect: asks the gateway directly.
app.post("/api/orders/verify", limit(60, 3600e3), async (req, res) => {
  const id = String((req.body || {}).orderId || "").replace(/^TD_/, "");
  const o = orders.find(x => x.id === id);
  if (!o) return res.status(404).json({ error: "Order not found" });
  if (o.status >= 0) return res.json({ track: o.track, invoice: invUrl(o) });
  try {
    const g = await gwStatus(o);
    if (g.status === "SUCCESS" && Number(g.amount) === o.amount) { markPaid(o, gid(o)); return res.json({ track: o.track, invoice: invUrl(o) }); }
    res.status(202).json({ pending: true, status: g.status });
  } catch (e) { res.status(502).json({ error: e.message }); }
});
// unpaid orders (and their files) are removed after 72 hours
setInterval(() => {
  const cut = Date.now() - 72 * 3600e3, keep = orders.filter(o => o.status >= 0 || o.created > cut);
  if (keep.length !== orders.length) { orders.filter(o => !keep.includes(o)).forEach(o => fs.rmSync(path.join(UP, o.id), { recursive: true, force: true })); orders = keep; save("orders.json", orders); }
}, 3600e3).unref();

const findTrack = q => { const id = String(q.id || "").trim().toUpperCase(), m = String(q.mobile || "").trim(); return orders.find(o => o.status >= 0 && o.track === id && o.mobile === m); };
app.get("/api/track", limit(30, 600e3), (req, res) => {
  const o = findTrack(req.query); if (!o) return res.status(404).json({ error: "Not found" });
  res.json({ track: o.track, key: o.key, name: o.name.split(" ")[0], status: o.status, arn: o.arn, hasResult: !!o.result, hasInvoice: true, log: o.log.filter(l => l.n).slice(-5).map(l => ({ t: l.t, n: l.n })) });
});
app.get("/api/track/download", limit(30, 600e3), (req, res) => {
  const o = findTrack(req.query); if (!o || !o.result) return res.status(404).json({ error: "Not available" });
  res.download(path.join(UP, o.id, o.result.id + "." + o.result.ext), o.result.orig);
});

app.get("/api/invoice/:id", limit(30, 600e3), (req, res) => {
  const o = orders.find(x => x.id === req.params.id);
  if (!o || !same(sign("inv:" + o.id).slice(0, 32), String(req.query.k || ""))) return res.sendStatus(404);
  sendInvoice(o, res);
});
app.get("/api/track/invoice", limit(30, 600e3), (req, res) => sendInvoice(findTrack(req.query), res));

// ---- Admin ----
app.post("/api/admin/login", limit(8, 900e3), (req, res) => {
  if (!same((req.body || {}).password || "", ADMIN_PASSWORD)) return res.status(401).json({ error: "Wrong password" });
  const exp = Date.now() + 12 * 3600e3;
  res.set("Set-Cookie", `adm=${exp}.${sign(String(exp))}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${req.secure ? "; Secure" : ""}`);
  res.json({ ok: true });
});
app.post("/api/admin/logout", (req, res) => { res.set("Set-Cookie", "adm=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"); res.json({ ok: true }); });
app.get("/api/admin/orders", needAdmin, (req, res) => {
  res.json({ serv: SERV, orders: orders.filter(o => o.status >= 0).sort((a, b) => b.paidAt - a.paidAt).map(({ gw, ...o }) => o) });
});
app.get("/api/admin/orders/:id/files/:fid", needAdmin, (req, res) => {
  const o = orders.find(x => x.id === req.params.id), f = o && o.files.find(x => x.id === req.params.fid);
  if (!f) return res.sendStatus(404); res.download(path.join(UP, o.id, f.id + "." + f.ext), f.orig);
});
app.get("/api/admin/orders/:id/invoice", needAdmin, (req, res) => sendInvoice(orders.find(x => x.id === req.params.id), res));
app.post("/api/admin/orders/:id", needAdmin, upRes.single("result"), (req, res) => {
  try {
    const o = orders.find(x => x.id === req.params.id && x.status >= 0); if (!o) return res.status(404).json({ error: "Not found" });
    const st = parseInt(req.body.status, 10); if (!(st >= 0 && st <= 4)) return res.status(400).json({ error: "Bad status" });
    const note = String(req.body.note || "").trim().slice(0, 300);
    o.arn = String(req.body.arn || "").trim().slice(0, 40);
    if (req.file) {
      const nf = saveFile(o.id, req.file);
      if (o.result) try { fs.unlinkSync(path.join(UP, o.id, o.result.id + "." + o.result.ext)); } catch (e) { }
      o.result = nf;
    }
    if (st !== o.status || note || req.file) o.log.push({ s: st, t: Date.now(), n: note || (req.file ? "Your document is ready to download" : "") });
    o.status = st; save("orders.json", orders); res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get("/api/admin/pricing", needAdmin, (req, res) => res.json({ serv: SERV, pricing: allPrices() }));
app.put("/api/admin/pricing", needAdmin, (req, res) => {
  const n = v => Math.max(0, Math.min(200000, parseInt(v, 10) || 0));
  Object.keys(SERV).forEach(k => { const v = (req.body || {})[k]; if (v) pricing[k] = { svc: n(v.svc) }; });
  save("pricing.json", pricing); res.json({ ok: true });
});

app.use((e, req, res, next) => res.status(400).json({ error: e.code === "LIMIT_FILE_SIZE" ? "File too large (max 5 MB; result file 10 MB)" : e.message }));
app.listen(PORT, () => console.log("TaknaDocs running on " + PORT + (DEMO ? " (DEMO payments)" : "")));
