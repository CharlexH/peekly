# App Ops Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a sidecar App Ops dashboard in Peekly for app behavior, backend health, and provider cost visibility.

**Architecture:** Keep existing web analytics untouched. Add separate App Ops schema, protected API routes, D1 bindings for Nians Storybook ledgers, and an Alpine dashboard mode that consumes the new API.

**Tech Stack:** Cloudflare Workers, Hono, D1, TypeScript, Alpine.js, Canvas charts, Vitest.

---

### Task 1: Add App Ops Schema

**Files:**
- Create: `migrations/004_app_ops.sql`
- Modify: `schema.sql`

**Steps:**
1. Add app, environment, event, provider snapshot, quota snapshot, and alert tables.
2. Seed `app_nians_storybook` with sandbox and production environments.
3. Keep this independent from `sites`, `pageviews`, and `events`.

### Task 2: Add App Ops Types and Utilities

**Files:**
- Modify: `src/types.ts`
- Create: `src/lib/app-ops.ts`
- Test: `test/app-ops.test.ts`

**Steps:**
1. Add optional Nians D1 bindings to `Env`.
2. Implement pure helpers for success rates, severity, and alert derivation.
3. Test the pure helpers before route wiring.

### Task 3: Add App Ops Routes

**Files:**
- Create: `src/routes/apps.ts`
- Modify: `src/index.ts`

**Steps:**
1. Add `GET /api/apps`.
2. Add `GET /api/apps/:id/overview?environment=sandbox&period=7d`.
3. Add public `POST /api/app-collect` for future app events, validated by per-environment collect keys.
4. Keep Nians queries aggregate-only.

### Task 4: Add D1 Bindings

**Files:**
- Modify: `wrangler.toml`

**Steps:**
1. Bind `NIANS_SANDBOX_DB` to `nians-storybook-ledger`.
2. Bind `NIANS_PROD_DB` to `nians-storybook-ledger-prod`.
3. Leave the primary `DB` binding untouched.

### Task 5: Add Apps Dashboard UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`

**Steps:**
1. Add a mode selector for `Sites` and `Apps`.
2. Keep the existing site dashboard visible only in Sites mode.
3. Add App selector, environment selector, health cards, cost cards, trend chart, provider attempts table, and alert list.
4. Reuse the existing visual system instead of introducing a separate frontend framework.

### Task 6: Verify

**Commands:**
- `npm test`
- `npx tsc --noEmit`
- `npm run dev`

**Manual checks:**
- Login still works.
- Existing Sites dashboard still renders.
- Apps mode loads Nians Storybook sandbox/prod overview.
- Empty/missing Nians bindings degrade with a clear unavailable state.

### 2026-05-16 Follow-up Implementation Notes

- Added Volcengine account-balance snapshots through `QueryBalanceAcct`, stored as `provider_usage_snapshots.metric = account_available_balance`; this is an account-level recharge signal, not a per-model remaining-token quota.
- Added protected manual sync route: `POST /api/apps/:id/provider-snapshots/volcengine?environment=sandbox`.
- Added five-minute cron route for App Ops provider snapshots while preserving the existing Monday weekly report cron.
- Added dashboard `Sync` control for provider snapshots and low-balance alert thresholds:
  - `<= 50 CNY`: warning
  - `<= 10 CNY`: critical
- Added signed Volcengine Speech monitoring support:
  - `UsageMonitoring` writes 7-day `speech_*_usage_7d` rows into `provider_usage_snapshots`.
  - `QuotaMonitoring` writes hourly speech concurrency/qps peak rows into `provider_quota_snapshots`.
  - `VOLCENGINE_SPEECH_APP_ID` is required before these snapshots can run; `VOLCENGINE_SPEECH_RESOURCE_IDS` defaults to BigTTS `volc.service_type.10029` and can be comma-separated for more resources.
- Created the Volcengine IAM user `peekly-app-ops-monitor` with `ReadOnlyAccess` and stored the generated AK/SK as Cloudflare Worker secrets `VOLCENGINE_ACCESS_KEY_ID` and `VOLCENGINE_SECRET_ACCESS_KEY`; the downloaded CSV was deleted after upload.
- Validation passed: `npx tsc --noEmit`, `npm test` (`43` tests), static page fetch, `public/app.js` syntax check.

### 2026-05-17 Growth Target Implementation Notes

- Added pure growth-model helpers in `src/lib/app-ops.ts` and regression tests for the `¥50,000/month` North Star decomposition.
- `GET /api/apps/:id/overview` now accepts `target_mrr_cny` and returns `growth`, combining Peekly app events, Nians D1 active entitlements, configured plan prices, paid-user AI cost, and free-trial exposure.
- The Apps UI now includes a Revenue Target board with editable monthly target, sales progress, MRR, revenue gap, paid AI cost, free-trial exposure, contribution estimate, funnel targets, and action recommendations.
- Apple Sales/Finance import is still a future connector. Current local `asc 0.1.21` does not expose `analytics sales` or `finance reports`, so Peekly labels ASC sales reports as `not_configured` and uses App Ops purchase events only as a near-real-time estimate.
