# TaknaPay.in - Private UPI Payment Gateway

Live at **https://taknapay.in**. Brand assets live in `public/assets/` (`logo.png`, `favicon.png`, `loader.webm` = loading animation shown by `public/loader.js` on every page). Set `PUBLIC_URL=https://taknapay.in` in the server environment.

Dynamic UPI QR + automatic verification from Paytm confirmation emails (Gmail IMAP), MongoDB storage, admin dashboard.

## Setup
1. Google Account: enable 2-Step Verification, create an App Password, and enable IMAP in Gmail.
2. Set these environment variables (Render -> Environment). Nothing secret lives in the code any more. See `.env.example`.
   - `MONGO_URI`, `API_SECRET_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD` (required)
   - `ADMIN_SECRET_PASS` (admin panel password), `SITE_WEBHOOK_URL`, `BUSINESS_UPI`, `PAYEE_NAME`, `PENDING_WINDOW_HOURS` (optional)
3. `npm install` then `npm start`.

## Main site integration
- Site calls `POST /api/create-payment` with header `x-api-key` and body `{ amount, orderId }`, then sends the user to the returned `checkoutUrl` + `&redirectUrl=<encoded link>`.
- After payment the user returns to `redirectUrl` with `orderId` and `status=SUCCESS` appended properly.
- The gateway marks the order `SUCCESS` in the shared `payments` collection and, if `SITE_WEBHOOK_URL` is set, also calls the site webhook.
- See `/docs.html` for details.

## Reliability notes
- Webhook to the main site is retried and re-sent automatically until the site replies 2xx (`webhookSent` flag on the payment).
- Open `/ping.html` for a live status/ping page (response time, uptime, DB, self-ping stats) and the steps to add a free external pinger (UptimeRobot / cron-job.org -> `/healthz`, every 5 min). A sleeping Render service cannot wake itself, so the external pinger is what guarantees it never sleeps.
- The anti-sleep ping now targets the public URL (`RENDER_EXTERNAL_URL` / `KEEP_ALIVE_URL`); pinging 127.0.0.1 does not keep Render awake.
- Async admin routes have error handling and the process no longer exits on an unhandled rejection.
- Speed/safety: cached QR codes, DB index on status+createdAt, lean queries, IMAP search limited by date, static asset caching, per-IP rate limits on public endpoints, input validation on `orderId`/`amount`, safe CSV export.

## Automatic ping (works with the page closed)
- **Inside the server:** pings its own public URL every `PING_INTERVAL_MIN` minutes (default 5).
- **From GitHub (recommended):** `.github/workflows/keep-alive.yml` pings `/healthz` every 5 minutes from GitHub's servers. Set it up once: repo -> Settings -> Secrets and variables -> Actions -> **Variables** -> New variable `PING_URL` = `https://taknapay.in/healthz`. Then Actions tab -> Keep Alive -> Run workflow to test.
- GitHub may delay scheduled runs by a few minutes, and pauses them if the repo has no activity for 60 days (re-enable from the Actions tab). Adding UptimeRobot / cron-job.org as a second pinger covers that.

## Checkout pages (Razorpay / Cashfree style)
- `/index.html` - hosted checkout: QR, **Pay with UPI app** (mobile), **Check payment status** button, **Cancel payment** link. Auto-checks every 4 s while the tab is visible.
- `/success.html` - shown after payment; verifies the order is really `SUCCESS` on the server (cannot be faked via URL), then returns the user to `redirectUrl` with `status=SUCCESS`.
- `/cancel.html` - shown on cancel/failed; offers **Try payment again** (only while the order is still PENDING) and **Return to merchant** with `status=CANCELLED`. Cancelling does not change the order in the database; unpaid orders simply expire after `PENDING_WINDOW_HOURS`.
- Shared styling lives in `/gateway.css`.

## Merchant sign-up (other people using your gateway)
- `/merchant.html` is the public home: anyone can register their site (name, email, website, optional https webhook). They get a one-time login token.
- In `/admin.html` -> **Merchants** tab you see the requests (badge shows how many are pending) and can **Approve / Reject / Suspend**, issue a new login token, or delete a merchant that has no orders. Approving creates their API key.
- The merchant logs in at `/merchant.html` (email + token) to see their API key, orders, revenue, set their webhook URL and send a test webhook.
- Merchant orders are separate: `orderId` collisions return 409, webhooks go only to the owner, and the return-to-site redirect only works for their registered website.
- Webhooks are signed: header `x-signature` = HMAC-SHA256(apiKey, `${x-timestamp}.${rawBody}`). Your main site still also gets the old `x-api-key` header.
- Merchant API keys are stored in the database (so merchants can view them); protect `MONGO_URI`.
- `GET /` now opens `/merchant.html`; the checkout still opens with `/index.html?orderId=...`.
- Full developer documentation: `/docs.html`.

## Plans, settlement and payouts
- Merchants start on **Free** (5% per transaction). **Pro** is ₹499 per 30 days with ₹1 per transaction. Edit the numbers in the `PLANS` block in `server.js` (`SETTLEMENT_DAYS` and `MIN_PAYOUT` are next to it).
- Money becomes withdrawable 3 working days (Mon-Fri) after payment. Merchants request a payout by NEFT, IMPS (name, account number, IFSC) or UPI; the charge depends on the plan.
- Admin panel -> **Payouts**: pay the money manually, then **Accept** with the UTR number, or **Reject** (the money returns to the merchant balance). **Merchants** tab: Make Pro / Make Free.
- Docs: `/docs.html#plans` and `/docs.html#payouts`.

## Refunds
- Merchant dashboard -> **Refunds** (or the Refund button in Orders): full or partial refund of a paid order with a reason (customer UPI ID optional).
- Admin panel -> **Refunds**: refund the customer manually from the same payment account, then **Accept** with the refund UTR, or **Reject**.
- The payment fee is never refunded. Every refund has a 1% refund charge (`REFUND_PERCENT` in `server.js`) on all plans. From the merchant balance we deduct `refund amount + charge`; the charge must be covered by the available balance.

## Merchant KYC
- The sign-up form on `/merchant.html` asks for: name on PAN, PAN number (validated `AAAAA9999A`), a PAN card photo (resized in the browser, stored in the `kycdocs` collection), business name, email, website, optional webhook / phone, and a declaration checkbox.
- Admin panel -> Merchants -> **View KYC** shows the PAN details and photo. A merchant cannot be approved without them. Rejecting asks for a reason that the merchant sees; the merchant can fix and resubmit from Profile.
- One PAN can be used by only one merchant account. Protect `MONGO_URI`: PAN data is stored as-is.

## Home page, Payment Links and merchant onboarding
- `/` is the public home page (`public/home.html`): products, instant verification, how it works, price chart (numbers are read live from `/api/public-config`, so they always match `PLANS` in `server.js`), FAQ.
- **Merchant onboarding** (website gateway) stays at `/merchant.html`.
- **Payment Links** (`/links.html`): a separate account type (`type: 'LINK'`). Registration asks for name, mobile, email, password and PAN (name, number, photo). The admin approves it in **Admin -> Merchants** (rows marked LINK; *New password* sets a temporary password). Only approved users can create links.
- Creating a link is free. Fee `PLANS.LINK`: **2%** on every payment received and **1%** on withdrawal (NEFT / IMPS / UPI). Change the numbers in `server.js`. `LINK_SETTLEMENT_DAYS` (default 3 working days) controls when money becomes withdrawable; set `0` for instant.
- Payers open `/l/<code>`, optionally enter name/contact (and the amount if the link has no fixed amount) and are sent to the normal checkout. After payment they return to the link page.
- Withdrawals use the same Payout flow as merchants (admin -> Payouts -> Accept with UTR).
- Loading animation: `public/loader.js` plays `assets/loader.webm` (Safari/iPhone use `assets/loader.mp4`); it also replaces the spinner on the checkout page.

## Support tickets and email (Contact us)
- `/contact.html` - public **Contact us** page. The user fills a form and gets a ticket number (`TKT-XXXXXX`), also emailed to them. The **Track ticket** tab (ticket number + the same email) shows the full conversation and lets the user reply.
- `/admin.html` -> **Tickets**: list with "Needs reply" badge, open a ticket, read the thread and reply. Tick "Also send this reply to the user's email" to email it. You can close/reopen tickets. **Email** tab: compose and send any email, plus a log of every email sent (success/failure).
- You get an email alert for every new ticket and every user reply at `SUPPORT_NOTIFY_TO`.
- **Important:** Render's free plan blocks SMTP ports, so Gmail SMTP will not deliver there. Set `BREVO_API_KEY` (free 300 mails/day; verify the sender in Brevo) or `RESEND_API_KEY` (verify your domain) plus `MAIL_FROM` in Render -> Environment. Without these the ticket system still works fully, only the emails will show FAILED in the Email log. SMTP (Gmail app password) is used as a fallback and works on a paid Render instance.
- A real mailbox such as `support@taknapay.in` cannot be hosted inside this Node app. Create it with your domain's email host (Zoho Mail free, Google Workspace, Brevo/Resend for sending), then use that address as `MAIL_FROM`.
- Run `npm install` once (adds `nodemailer`).

## Payment Links page
- `/links.html` now uses the same design as the Merchant page: landing with features / pricing / FAQ, and a sidebar dashboard (Overview, My links, Payments, Withdraw, Profile and KYC, Contact support). Fee numbers are read live from `/api/public-config`.

## Reseller setup (v1.5)
1. `npm install && npm start` - open the site address in a browser.
2. The setup wizard asks: site name + domain + logo -> MongoDB / Gmail / UPI -> admin ID + password -> purchase key + activation code.
3. Nothing is saved until the license server approves the key. After that the site restarts and is ready.
4. On hosts with a temporary disk (Render free) add the shown `CONFIG_BLOB` value as an environment variable.

## Updates (optional)
When the seller publishes a new version, the admin panel shows a dot next to **Updates**. Open it to read what's new, then press **Update now** (the site restarts for a few seconds) or ignore it. Settings, database and logo are never touched; replaced files are backed up in `data/backup/`. If an update says it needs new packages, redeploy the new package from the seller instead.

Note: on hosts with a temporary disk (e.g. Render free) installed updates can be lost when the host rebuilds the service. Use a host with a persistent disk, or redeploy the new package.

## Seller: publishing an update
1. Raise `version` in `package.json`, set `LICENSE_SERVER` in `utils/license.js`.
2. `npm i -D javascript-obfuscator && node scripts/build-release.js` -> creates `taknapay-update.gz`.
3. Open your license server page, Updates section, enter the same version, notes, choose `taknapay-update.gz`, Publish.
