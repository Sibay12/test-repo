"use strict";
// Dependency-free PDF invoice generator (A4, English, built-in Helvetica/Courier fonts).
const lat = s => String(s == null ? "" : s).replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/₹/g, "Rs.").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
const pe = s => lat(s).replace(/[\\()]/g, "\\$&");
const COL = { navy: [.07, .13, .23], blue: [.04, .37, 1], orange: [1, .48, .1], grey: [.36, .41, .51], line: [.89, .9, .93], light: [.91, .94, 1], green: [.07, .63, .31], white: [1, 1, 1], pale: [.8, .86, 1] };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = n => String(n).padStart(2, "0");
function fmtDate(ts) { const d = new Date(ts + 19800000); return `${p2(d.getUTCDate())} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} IST`; }
const money = n => "Rs. " + Number(n || 0).toFixed(2);

function buildInvoice(o, service, cfg) {
  cfg = cfg || {};
  let c = "";
  const Y = y => +(842 - y).toFixed(2), rg = a => a.map(v => v.toFixed(3)).join(" ");
  const fill = a => { c += rg(a) + " rg\n"; }, stroke = a => { c += rg(a) + " RG\n"; };
  const rect = (x, y, w, h, col) => { fill(col); c += `${x} ${Y(y + h)} ${w} ${h} re f\n`; };
  const text = (f, size, x, y, s, col) => { fill(col || COL.navy); c += `BT /${f} ${size} Tf ${x} ${Y(y)} Td (${pe(s)}) Tj ET\n`; };
  const rtext = (f, size, xr, y, s, col) => { const t = lat(s); text(f, size, +(xr - t.length * size * 0.6).toFixed(2), y, t, col); }; // Courier = 0.6em, exact
  const hline = (x1, x2, y) => { stroke(COL.line); c += `0.8 w ${x1} ${Y(y)} m ${x2} ${Y(y)} l S\n`; };
  function rr(x, y, w, h, r, col) {
    const x0 = x, x1 = x + w, yb = Y(y + h), yt = Y(y), k = r * 0.5523; fill(col);
    c += `${x0 + r} ${yb} m ${x1 - r} ${yb} l ${x1 - r + k} ${yb} ${x1} ${yb + r - k} ${x1} ${yb + r} c ${x1} ${yt - r} l ${x1} ${yt - r + k} ${x1 - r + k} ${yt} ${x1 - r} ${yt} c ${x0 + r} ${yt} l ${x0 + r - k} ${yt} ${x0} ${yt - r + k} ${x0} ${yt - r} c ${x0} ${yb + r} l ${x0} ${yb + r - k} ${x0 + r - k} ${yb} ${x0 + r} ${yb} c h f\n`;
  }
  function circle(cx, cy, r, col) {
    const k = r * 0.5523, X = cx, Yc = Y(cy); fill(col);
    c += `${X + r} ${Yc} m ${X + r} ${Yc + k} ${X + k} ${Yc + r} ${X} ${Yc + r} c ${X - k} ${Yc + r} ${X - r} ${Yc + k} ${X - r} ${Yc} c ${X - r} ${Yc - k} ${X - k} ${Yc - r} ${X} ${Yc - r} c ${X + k} ${Yc - r} ${X + r} ${Yc - k} ${X + r} ${Yc} c f\n`;
  }
  // logo mark (same artwork as logo.svg)
  const LX = 40, LY = 22, LS = 52 / 120, T = (x, y) => [LX + x * LS, LY + y * LS];
  const poly = (pts, col) => { fill(col); c += pts.map((p, i) => { const q = T(p[0], p[1]); return `${q[0].toFixed(2)} ${Y(q[1])} ${i ? "l" : "m"}`; }).join(" ") + " h f\n"; };
  rr(LX, LY, 52, 52, 12, COL.blue);
  poly([[34, 22], [68, 22], [88, 42], [88, 92], [82, 98], [40, 98], [34, 92]], COL.white);
  poly([[68, 22], [88, 42], [74, 42], [68, 36]], COL.pale);
  poly([[42, 50], [78, 50], [78, 59], [65, 59], [65, 86], [55, 86], [55, 59], [42, 59]], COL.blue);
  const cc = T(86, 88); circle(cc[0], cc[1], 21 * LS, COL.white); circle(cc[0], cc[1], 17 * LS, COL.orange);
  stroke(COL.white); c += `1 J 1 j ${(5.5 * LS).toFixed(2)} w ` + [[77, 88], [84, 95], [96, 81]].map((p, i) => { const q = T(p[0], p[1]); return `${q[0].toFixed(2)} ${Y(q[1])} ${i ? "l" : "m"}`; }).join(" ") + " S\n";

  // header band
  c = `${rg(COL.navy)} rg\n0 ${Y(96)} 595 96 re f\n` + c; // band drawn first (prepended)
  text("F2", 24, 104, 52, "TaknaDocs", COL.white);
  text("F1", 9.5, 104, 71, "by TAKNA Technology  |  " + (cfg.site || "www.takna.online").replace(/^https?:\/\//, ""), COL.pale);
  text("F2", 24, 408, 52, "INVOICE", COL.white);
  text("F1", 10, 408, 70, "Payment receipt", COL.pale);

  // tracking id box
  rect(40, 116, 515, 66, COL.light);
  text("F2", 9, 56, 137, "YOUR TRACKING ID", COL.grey);
  text("F3", 28, 56, 168, o.track || "-", COL.blue);
  text("F1", 9, 335, 137, "Track your application at", COL.grey);
  text("F2", 11, 335, 154, (cfg.site || "docs.takna.online").replace(/^https?:\/\//, ""), COL.navy);
  text("F1", 9, 335, 170, "using your Tracking ID + mobile number", COL.grey);

  // billed to / details
  text("F2", 9, 40, 214, "BILLED TO", COL.grey);
  text("F2", 12, 40, 234, lat(o.name) || "Customer");
  text("F1", 10, 40, 252, "Mobile: " + lat(o.mobile));
  let yy = 268; if (lat(o.email)) { text("F1", 10, 40, yy, "Email: " + lat(o.email)); yy += 16; }
  if (lat(o.city)) text("F1", 10, 40, yy, "Location: " + lat(o.city));
  text("F2", 9, 335, 214, "INVOICE DETAILS", COL.grey);
  const det = [["Invoice no.", "INV-" + o.track], ["Date", fmtDate(o.paidAt || Date.now())], ["Status", "PAID"], ["Paid via", "TaknaPay (online)"], ["Reference", String(o.id || "").slice(0, 8).toUpperCase()]];
  det.forEach((d, i) => { const y = 234 + i * 17; text("F1", 10, 335, y, d[0], COL.grey); text("F2", 10, 410, y, d[1], d[0] === "Status" ? COL.green : COL.navy); });

  // table
  rect(40, 330, 515, 26, COL.navy);
  text("F2", 9.5, 52, 347, "DESCRIPTION", COL.white); rtext("F3", 9.5, 543, 347, "AMOUNT", COL.white);
  text("F2", 11, 52, 379, lat(service) || "Service");
  text("F1", 9, 52, 394, "Tracking ID: " + (o.track || "-"), COL.grey);
  rtext("F4", 10.5, 543, 379, money(o.amount));
  hline(40, 555, 406);
  rect(40, 414, 515, 34, COL.light);
  text("F2", 12, 52, 436, "TOTAL PAID"); rtext("F3", 13, 543, 436, money(o.amount), COL.blue);

  // notes
  text("F2", 9, 40, 484, "NOTES", COL.grey);
  ["Keep your Tracking ID safe. You can track the status any time using the Tracking ID and your mobile number.",
   "Your final document will be available to download from the tracking page once it is ready."].forEach((n, i) => text("F1", 9.5, 40, 502 + i * 15, "- " + n, COL.grey));

  // issued by
  text("F2", 9, 40, 580, "ISSUED BY", COL.grey);
  text("F2", 11, 40, 598, cfg.name || "TAKNA Technology");
  let iy = 614; [cfg.addr, cfg.email && "Email: " + cfg.email, cfg.phone && "Phone: " + cfg.phone, cfg.gstin && "GSTIN: " + cfg.gstin].filter(Boolean).forEach(l => { text("F1", 9.5, 40, iy, l, COL.grey); iy += 14; });

  // footer
  hline(40, 555, 790);
  text("F1", 8.5, 40, 807, "This is a computer-generated invoice and does not require a signature.", COL.grey);
  text("F1", 8.5, 40, 820, "TaknaDocs - a product of TAKNA Technology - www.takna.online", COL.grey);

  const fonts = ["Helvetica", "Helvetica-Bold", "Courier-Bold", "Courier"];
  const objs = [null, "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R /F4 7 0 R >> >> /Contents 8 0 R >>",
    ...fonts.map(f => `<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`),
    `<< /Length ${c.length} >>\nstream\n${c}\nendstream`,
    `<< /Title (${pe("Invoice INV-" + o.track)}) /Author (TaknaDocs - TAKNA Technology) /Producer (TaknaDocs) >>`];
  let out = "%PDF-1.4\n"; const off = [];
  for (let i = 1; i < objs.length; i++) { off[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xr = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + off.slice(1).map(n => String(n).padStart(10, "0") + " 00000 n \n").join("") +
    `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 9 0 R >>\nstartxref\n${xr}\n%%EOF`;
  return Buffer.from(out, "latin1");
}
module.exports = { buildInvoice };
