# Whoshere

Self-hosted, privacy-friendly web analytics. Built on Cloudflare Workers + D1.

No cookies. No fingerprinting. < 1KB tracking script. Free to run.

## Features

- **Privacy-first** — No cookies, no localStorage, no fingerprinting. Visitor counting uses a daily-rotating SHA-256 hash (IP + UA + salt) that's impossible to reverse.
- **Lightweight** — Tracking script is ~536 bytes gzipped. Zero impact on page load.
- **Multi-site** — Track multiple websites from a single dashboard.
- **Realtime** — See active visitors in the last 5 minutes.
- **SPA support** — Automatically tracks pushState/popstate navigation.
- **Custom events** — Track button clicks, form submissions, or any interaction.
- **Dark dashboard** — Clean, minimal analytics dashboard.
- **Free** — Runs entirely on Cloudflare's free tier (Workers + D1).

## Metrics

- Unique visitors, pageviews, bounce rate, average session duration
- Top pages, traffic sources (referrers)
- Browser, OS, and device breakdown
- Geographic distribution (country-level)
- Custom events
- Realtime active visitors

## Architecture

```
Browser → tracker.js (536B) → POST /api/collect → Cloudflare Worker → D1 (SQLite)
                                                        ↕
Dashboard (Alpine.js SPA) ← GET /api/stats/* ← JWT auth middleware
```

- **Backend**: Cloudflare Workers + Hono
- **Database**: Cloudflare D1 (SQLite at the edge)
- **Dashboard**: Alpine.js SPA with canvas charts
- **Auth**: PBKDF2 + JWT (Web Crypto API, zero npm auth deps)

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/CharlexH/whoshere.git
cd whoshere
npm install
```

### 2. Create D1 database

```bash
npx wrangler d1 create whoshere
```

Copy the `database_id` from the output into `wrangler.toml`.

### 3. Initialize schema

```bash
# Local
npx wrangler d1 execute whoshere --local --file=./schema.sql
npx wrangler d1 execute whoshere --local --file=./seed.sql

# Remote (after first deploy)
npx wrangler d1 execute whoshere --remote --file=./schema.sql
npx wrangler d1 execute whoshere --remote --file=./seed.sql
```

### 4. Set secrets

Generate a password hash first (run in Node.js or the Worker):

```bash
npx wrangler secret put JWT_SECRET
# Enter a random string (e.g., output of: openssl rand -hex 32)

npx wrangler secret put AUTH_PASSWORD_HASH
# Enter your PBKDF2 hash (see "Generating a password hash" below)
```

### 5. Local development

Create a `.dev.vars` file:

```
JWT_SECRET=dev-secret-change-in-production
AUTH_PASSWORD_HASH=<your-hash>
```

```bash
npm run dev
```

### 6. Deploy

```bash
npm run deploy
```

## Generating a password hash

Run this in any JavaScript environment with Web Crypto:

```javascript
// In browser console or Node.js 20+
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits", "deriveKey"]);
  const derived = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, { name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", derived));
  const toHex = (b) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
  return toHex(salt) + ':' + toHex(raw);
}
hashPassword("your-password").then(console.log);
```

## Adding the tracking script

After creating a site in the dashboard, add this to your website's `<head>`:

```html
<script defer data-site="YOUR_TRACKING_ID" src="https://your-worker.workers.dev/tracker.js"></script>
```

## Custom events

```javascript
// Track a custom event
whoshere("signup", { plan: "pro" });

// Track a button click
document.querySelector("#cta").addEventListener("click", () => {
  whoshere("cta_click");
});
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/collect` | No | Receive pageview/event data |
| GET | `/tracker.js` | No | Serve tracking script |
| POST | `/api/auth/login` | No | Login, returns JWT |
| GET | `/api/stats/summary` | JWT | Visitors, pageviews, bounce rate |
| GET | `/api/stats/timeseries` | JWT | Traffic over time |
| GET | `/api/stats/pages` | JWT | Top pages |
| GET | `/api/stats/referrers` | JWT | Traffic sources |
| GET | `/api/stats/devices` | JWT | Browser/OS/device breakdown |
| GET | `/api/stats/countries` | JWT | Geographic distribution |
| GET | `/api/stats/events` | JWT | Custom events |
| GET | `/api/stats/realtime` | JWT | Active visitors (5 min) |
| GET | `/api/sites` | JWT | List sites |
| POST | `/api/sites` | JWT | Add site |
| DELETE | `/api/sites/:id` | JWT | Remove site |

All stats endpoints accept `?site_id=X&period=30d` (today, 7d, 30d, 90d, custom).

## Cloudflare Free Tier Limits

| Resource | Limit | What it means |
|----------|-------|---------------|
| Worker requests | 100K/day | ~100K pageviews/day |
| D1 rows read | 5M/day | ~50K dashboard loads/day |
| D1 rows written | 100K/day | ~100K pageviews/day |
| D1 storage | 5 GB | Years of analytics data |

## Tech Stack

- [Hono](https://hono.dev) — Lightweight web framework for Cloudflare Workers
- [Cloudflare D1](https://developers.cloudflare.com/d1/) — SQLite at the edge
- [Alpine.js](https://alpinejs.dev) — Minimal reactive UI
- Web Crypto API — Password hashing (PBKDF2) and JWT signing (HMAC-SHA256)

## License

MIT
