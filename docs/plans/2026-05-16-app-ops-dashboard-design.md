# App Ops Dashboard Design

## Goal

Add a parallel App Ops module to Peekly so mobile apps can report product behavior, backend health, and provider cost signals without disturbing the existing website analytics dashboard.

## Current Context

Peekly currently tracks websites through `sites`, `pageviews`, `events`, and `funnels`. The UI is a single Alpine dashboard backed by Hono routes and D1. That model is good for web traffic, but app operations need a separate vocabulary: app environments, generation jobs, provider attempts, quota state, app events, cost snapshots, and alerts.

## Architecture

The first version is a sidecar, not a migration. Website analytics stays on the existing `sites` model. App monitoring gets its own tables, routes, and UI mode. Nians Storybook is the first concrete app and reads its Cloudflare D1 ledger through dedicated D1 bindings, while generic app event collection is stored in Peekly's own D1.

## Data Model

- `apps`: one row per mobile/product app.
- `app_environments`: environment metadata and source binding hints, such as `sandbox` and `production`.
- `app_events`: privacy-preserving app behavior events for future app SDK or server-side sends.
- `provider_usage_snapshots`: periodic external provider usage and balance snapshots.
- `provider_quota_snapshots`: periodic provider quota snapshots.
- `app_alerts`: persisted or manually acknowledged operational alerts.

## Nians Storybook Integration

The initial dashboard reads aggregated data from the Nians ledger only:

- `generation_jobs`
- `provider_attempts`
- `quota_periods`
- `quota_events`
- `provider_leases`
- `system_flags`

It must not read generated story text, audio, Apple JWS payloads, raw user identifiers, or child profile content.

## UI

Add an Apps mode next to the existing website dashboard. The Apps page shows:

- environment health, cost gate, and data freshness
- active users/events from app telemetry when available
- generation success rate and average generation-to-play time from backend ledger
- app quota used/reserved/remaining
- provider attempts by kind/status/error
- daily generation trend
- computed alerts for burn-cost state, failed jobs, failed provider attempts, leases, and missing production traffic

## Rollout Strategy

1. Land the App Ops sidecar with Nians read-only ledger aggregation.
2. Add official Volcengine account-balance snapshots through a read-only IAM user.
3. Add iOS generation-chain event ingestion for cost and health visibility.
4. Add conversion events after StoreKit/App Store flows are stable.
5. Generalize the module for future apps once one real app has been running cleanly.

## First Event Taxonomy

Cost and generation health events come before conversion events:

- `app_launch`
- `generation_requested`
- `generation_job_created`
- `generation_tts_requested`
- `generation_tts_queued`
- `generation_tts_retrying`
- `generation_tts_succeeded`
- `generation_tts_attempt_failed`
- `generation_ack_succeeded`
- `generation_ack_queued`
- `generation_completed`
- `generation_failed`
- `generation_cancelled`

Privacy boundary: event metadata may include flow, theme, age group, gender, companion count, BGM track, locale, voice, speech rate, job id, attempt number, duration, and normalized error type. It must not include child names, story text, audio content, signed text tokens, Apple JWS payloads, or provider secrets.

## Provider Balance Boundary

The first Volcengine integration uses the Billing `QueryBalanceAcct` API. It is an account-balance signal for recharge timing, not a per-model remaining-token or resource-package quota feed. Per-model Ark free quota, inference limits, and endpoint token usage must be treated as a separate data source; Doubao Speech usage can be queried by product resource IDs, but that is historical usage rather than account cash balance.

## 2026-05-16 Provider Monitoring Update

Official docs show three different signal classes:

- Billing `QueryBalanceAcct`: account-level available cash balance for recharge timing.
- Doubao Speech `UsageMonitoring`: historical usage by `AppID + ResourceID + date range`, such as BigTTS `text_words`.
- Doubao Speech `QuotaMonitoring`: qps/concurrency utilization and limits by `AppID + ResourceID`, useful for provider health and generation-chain risk.

The App Ops dashboard should label these separately. It must not present Speech usage or concurrency as Ark model token balance, and it must not present account cash balance as per-model quota. Missing or stale balance data is an operational warning because recharge risk cannot be assessed.

Current unresolved boundary: Volcengine Ark exposes console-level model/endpoint usage statistics, but no stable public OpenAPI was confirmed for “all model remaining free token quota” in the official docs reviewed today. For Ark, the safer first-party product signal remains the Worker ledger (`provider_attempts`, text latency, job failures, and quota ledger), plus later provider-response token accounting if the generation response includes usage fields.

## 2026-05-17 Growth Target Update

The Apps dashboard now treats monthly gross subscription sales as a configurable North Star. The default target is `¥50,000/month`, and the overview API accepts `target_mrr_cny` so all derived targets move together when the target changes.

The first growth layer shows:

- selected-window sales target and estimated App Ops purchase-event sales
- active subscriber MRR from Nians D1 entitlements
- required paid orders, required active payers, revenue gap, Apple-net estimate, paid-user AI cost, and free-trial exposure
- the first-story revenue funnel: app launch -> first story completed -> first playback completed -> first-story paywall prompt -> paywall viewed -> plan selected -> purchase started -> purchase succeeded
- first-story vs quota-exhausted paywall path mix
- prioritized growth recommendations based on revenue gap, funnel bottleneck, and trial-cost exposure

Revenue source boundary: App Ops `purchase_succeeded` events are useful for fast directional monitoring, but they are not the final sales authority. Apple Sales and Finance reports should be imported from the official App Store Connect reports API once a Team API key and vendor number are configured. The current local `asc` CLI version does not expose sales/finance report commands, so the dashboard explicitly labels ASC sales reports as not configured until that import exists.
