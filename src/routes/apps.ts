import { Hono } from "hono";
import type { AppCollectPayload, AppEnvironment, AppProduct, Env } from "../types";
import { getTimeRange } from "../lib/time";
import { nanoid } from "../lib/nanoid";
import {
  buildGrowthOverview,
  deriveAppOpsAlerts,
  NIANS_MONTHLY_PRODUCT_ID,
  NIANS_YEARLY_PRODUCT_ID,
  ratePercent,
  remainingQuota,
  severityScore,
} from "../lib/app-ops";
import { hasVolcengineBillingCredentials, recordVolcengineProviderSnapshots } from "../lib/volcengine-billing";

export const appsRoute = new Hono<{ Bindings: Env }>();
export const appCollectRoute = new Hono<{ Bindings: Env }>();

interface NiansOverview {
  available: boolean;
  error?: string;
  generation: {
    total: number;
    acked: number;
    failed: number;
    active: number;
    success_rate: number;
    latest_job_at: string | null;
    avg_text_seconds: number;
    avg_tts_seconds: number;
  };
  quota: {
    periods: number;
    limit: number | null;
    used: number | null;
    reserved: number | null;
    remaining: number | null;
  };
  provider: {
    attempts: unknown[];
    failed_attempts: number;
    active_leases: number;
    token_usage: NiansTokenUsage;
  };
  commerce: {
    active_subscriptions: NiansSubscriptionCounts;
    registered_users: NiansRegisteredUsers;
  };
  system: {
    burn_cost_disabled: boolean | null;
    flags: unknown[];
  };
  timeline: unknown[];
}

interface NiansTokenUsage {
  available: boolean;
  error?: string;
  attempts: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  reasoning_tokens: number;
  cached_input_tokens: number;
  avg_total_tokens_per_attempt: number | null;
  models: NiansTokenUsageModel[];
}

interface NiansTokenUsageModel {
  model_id: string | null;
  endpoint_id: string | null;
  attempts: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  reasoning_tokens: number;
  cached_input_tokens: number;
  avg_total_tokens_per_attempt: number | null;
}

interface NiansSubscriptionCounts {
  available: boolean;
  error?: string;
  total: number;
  monthly: number;
  yearly: number;
  unknown: number;
}

interface NiansRegisteredUsers {
  available: boolean;
  error?: string;
  count: number;
}

appsRoute.get("/", async (c) => {
  const [apps, environments] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM apps ORDER BY created_at DESC"),
    c.env.DB.prepare("SELECT * FROM app_environments ORDER BY app_id, is_production ASC, name ASC"),
  ]);

  const envsByApp = new Map<string, AppEnvironment[]>();
  for (const env of environments.results as AppEnvironment[]) {
    const list = envsByApp.get(env.app_id) || [];
    list.push(safeEnvironment(env));
    envsByApp.set(env.app_id, list);
  }

  return c.json({
    apps: (apps.results as AppProduct[]).map((app) => ({
      ...app,
      environments: envsByApp.get(app.id) || [],
    })),
  });
});

appsRoute.get("/:id/overview", async (c) => {
  const appId = c.req.param("id");
  const environmentName = c.req.query("environment") || "sandbox";
  const period = c.req.query("period") || "7d";
  const start = c.req.query("start");
  const end = c.req.query("end");
  const range = getTimeRange(period, start, end);

  const app = await c.env.DB.prepare("SELECT * FROM apps WHERE id = ?")
    .bind(appId)
    .first<AppProduct>();
  if (!app) return c.json({ error: "App not found" }, 404);

  const environment = await c.env.DB.prepare(
    "SELECT * FROM app_environments WHERE app_id = ? AND name = ?"
  )
    .bind(appId, environmentName)
    .first<AppEnvironment>();
  if (!environment) return c.json({ error: "Environment not found" }, 404);

  const [eventSummary, eventBreakdown, growthEvents, purchaseEvents, usageSnapshots, quotaSnapshots, storedAlerts] = await c.env.DB.batch([
    c.env.DB.prepare(`
      SELECT COUNT(*) AS events, COUNT(DISTINCT install_hash) AS installs, COUNT(DISTINCT session_hash) AS sessions
      FROM app_events
      WHERE app_id = ? AND environment_id = ? AND timestamp BETWEEN ? AND ?
    `).bind(app.id, environment.id, range.start, range.end),
    c.env.DB.prepare(`
      SELECT event_name, COUNT(*) AS count, COUNT(DISTINCT install_hash) AS installs
      FROM app_events
      WHERE app_id = ? AND environment_id = ? AND timestamp BETWEEN ? AND ?
      GROUP BY event_name
      ORDER BY count DESC
      LIMIT 20
    `).bind(app.id, environment.id, range.start, range.end),
    c.env.DB.prepare(`
      SELECT event_name, COUNT(*) AS count, COUNT(DISTINCT install_hash) AS installs
      FROM app_events
      WHERE app_id = ? AND environment_id = ? AND timestamp BETWEEN ? AND ?
        AND event_name IN (
          'app_launch',
          'first_story_completed',
          'first_story_playback_completed',
          'first_story_paywall_prompt_shown',
          'quota_exhausted_paywall_shown',
          'paywall_viewed',
          'paywall_plan_selected',
          'purchase_started',
          'purchase_succeeded'
        )
      GROUP BY event_name
    `).bind(app.id, environment.id, range.start, range.end),
    c.env.DB.prepare(`
      SELECT metadata, COUNT(*) AS count
      FROM app_events
      WHERE app_id = ? AND environment_id = ? AND event_name = 'purchase_succeeded' AND timestamp BETWEEN ? AND ?
      GROUP BY metadata
      LIMIT 1000
    `).bind(app.id, environment.id, range.start, range.end),
    c.env.DB.prepare(`
      SELECT provider, metric, value, unit, window_start, window_end, source, captured_at
      FROM provider_usage_snapshots
      WHERE app_id = ? AND environment_id = ?
      ORDER BY captured_at DESC
      LIMIT 20
    `).bind(app.id, environment.id),
    c.env.DB.prepare(`
      SELECT provider, quota_type, used, limit_value, remaining, unit, source, captured_at
      FROM provider_quota_snapshots
      WHERE app_id = ? AND environment_id = ?
      ORDER BY captured_at DESC
      LIMIT 20
    `).bind(app.id, environment.id),
    c.env.DB.prepare(`
      SELECT severity, title, body, source, created_at
      FROM app_alerts
      WHERE app_id = ? AND (environment_id = ? OR environment_id IS NULL) AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 20
    `).bind(app.id, environment.id),
  ]);

  const nians = environment.source_kind === "nians_d1"
    ? await queryNiansOverview(c.env, environment, range)
    : emptyNiansOverview();

  const usageRows = usageSnapshots.results as Record<string, unknown>[];
  const quotaRows = quotaSnapshots.results as Record<string, unknown>[];
  const eventResult = eventSummary.results[0] as Record<string, unknown> | undefined;
  const eventRows = growthEvents.results as Record<string, unknown>[];
  const purchaseBreakdown = purchaseBreakdownFromEventRows(purchaseEvents.results as Record<string, unknown>[]);
  const growth = buildGrowthOverview({
    range,
    assumptions: growthAssumptionsFromQuery(c),
    events: eventRows.map((row) => ({
      event_name: String(row.event_name ?? ""),
      count: Number(row.count ?? 0),
      installs: nullableNumber(row.installs),
    })),
    registeredUsers: nians.commerce.registered_users.count,
    purchaseBreakdown,
    activeSubscriptions: nians.commerce.active_subscriptions,
  });
  const accountBalanceCapturedAt = latestProviderCapturedAt(usageRows, "volcengine", "account_available_balance");
  const computedAlerts = deriveAppOpsAlerts({
    environmentName: environment.name,
    isProduction: Boolean(environment.is_production),
    burnCostDisabled: nians.system.burn_cost_disabled,
    failedJobs: nians.generation.failed,
    failedProviderAttempts: nians.provider.failed_attempts,
    activeLeases: nians.provider.active_leases,
    quotaRemaining: nians.quota.remaining,
    latestJobAt: nians.generation.latest_job_at,
    accountBalanceCny: latestProviderMetric(usageRows, "volcengine", "account_available_balance"),
    providerSnapshotAgeSeconds: accountBalanceCapturedAt == null ? null : Math.max(0, Math.floor(Date.now() / 1000) - accountBalanceCapturedAt),
    speechConcurrencyUtilization: highestQuotaUtilization(quotaRows, "volcengine", "concurrency"),
  }).sort((a, b) => severityScore(b.severity) - severityScore(a.severity));

  const health = nians.available
    ? summarizeHealth(computedAlerts)
    : { status: "unavailable", label: "Data unavailable" };

  return c.json({
    app,
    environment: safeEnvironment(environment),
    period,
    range,
    health,
    behavior: {
      events: Number(eventResult?.events ?? 0),
      installs: Number(eventResult?.installs ?? 0),
      sessions: Number(eventResult?.sessions ?? 0),
      top_events: eventBreakdown.results,
    },
    growth,
    ledger: nians,
    provider_usage: usageRows,
    provider_quota: quotaRows,
    alerts: {
      computed: computedAlerts,
      stored: storedAlerts.results,
    },
  });
});

appsRoute.post("/:id/provider-snapshots/volcengine", async (c) => {
  if (!hasVolcengineBillingCredentials(c.env)) {
    return c.json({ error: "Volcengine billing credentials are not configured" }, 412);
  }

  const appId = c.req.param("id");
  const environmentName = c.req.query("environment") || "sandbox";
  const environment = await c.env.DB.prepare(
    "SELECT id FROM app_environments WHERE app_id = ? AND name = ?"
  )
    .bind(appId, environmentName)
    .first<{ id: string }>();
  if (!environment) return c.json({ error: "Environment not found" }, 404);

  try {
    const result = await recordVolcengineProviderSnapshots(c.env, { appId, environmentName });
    return c.json({
      balance: {
        inserted: result.balance.inserted,
        snapshot: {
          available_balance: result.balance.snapshot.available_balance,
          cash_balance: result.balance.snapshot.cash_balance,
          arrears_balance: result.balance.snapshot.arrears_balance,
          credit_limit: result.balance.snapshot.credit_limit,
          freeze_amount: result.balance.snapshot.freeze_amount,
          unit: "CNY",
          captured_at: result.balance.snapshot.captured_at,
        },
      },
      billing: {
        inserted: result.billing.inserted,
        products: result.billing.products,
        periods: result.billing.periods,
        errors: result.billing.errors,
      },
      speech: {
        configured: result.speech.configured,
        usage_inserted: result.speech.usageInserted,
        quota_inserted: result.speech.quotaInserted,
        resources: result.speech.resources,
        errors: result.speech.errors,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync Volcengine billing snapshot";
    return c.json({ error: message }, 502);
  }
});

appCollectRoute.post("/", async (c) => {
  const payload = await c.req.json<AppCollectPayload>().catch(() => null);
  if (!payload?.key || !payload.event) {
    return c.json({ error: "key and event required" }, 400);
  }
  if (payload.event.length > 128) {
    return c.json({ error: "event is too long" }, 400);
  }

  const environment = await c.env.DB.prepare(
    "SELECT * FROM app_environments WHERE collect_key = ?"
  )
    .bind(payload.key)
    .first<AppEnvironment>();
  if (!environment) return c.json({ error: "Invalid collect key" }, 404);

  const country = c.req.header("cf-ipcountry") || null;
  const metadata = payload.metadata ? JSON.stringify(trimMetadata(payload.metadata)) : null;

  await c.env.DB.prepare(`
    INSERT INTO app_events (
      id, app_id, environment_id, event_name, app_version, platform_version,
      country, install_hash, session_hash, metadata, timestamp
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      nanoid(),
      environment.app_id,
      environment.id,
      payload.event,
      boundedString(payload.app_version, 64),
      boundedString(payload.platform_version, 64),
      country,
      boundedString(payload.install_hash, 128),
      boundedString(payload.session_hash, 128),
      metadata,
      Math.floor(Date.now() / 1000),
    )
    .run();

  return c.body(null, 202);
});

function summarizeHealth(alerts: { severity: string }[]) {
  if (alerts.some((alert) => alert.severity === "critical")) {
    return { status: "critical", label: "Needs attention" };
  }
  if (alerts.some((alert) => alert.severity === "warning")) {
    return { status: "warning", label: "Watch closely" };
  }
  return { status: "healthy", label: "Healthy" };
}

function latestProviderMetric(rows: Record<string, unknown>[], provider: string, metric: string): number | null {
  const row = rows.find((item) => item.provider === provider && item.metric === metric);
  if (!row) return null;
  const value = Number(row.value);
  return Number.isFinite(value) ? value : null;
}

function latestProviderCapturedAt(rows: Record<string, unknown>[], provider: string, metric: string): number | null {
  const row = rows.find((item) => item.provider === provider && item.metric === metric);
  if (!row) return null;
  const value = Number(row.captured_at);
  return Number.isFinite(value) ? value : null;
}

function highestQuotaUtilization(rows: Record<string, unknown>[], provider: string, unit: string): number | null {
  const utilizations = rows
    .filter((item) => item.provider === provider && item.unit === unit)
    .map((item) => {
      const used = Number(item.used);
      const limit = Number(item.limit_value);
      return Number.isFinite(used) && Number.isFinite(limit) && limit > 0 ? ratePercent(used, limit) : null;
    })
    .filter((value): value is number => value != null);
  return utilizations.length ? Math.max(...utilizations) : null;
}

function safeEnvironment(environment: AppEnvironment): AppEnvironment {
  return { ...environment, collect_key: environment.collect_key ? "configured" : null };
}

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, maxLength) : null;
}

function trimMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata).slice(0, 20)) {
    if (typeof value === "string") out[key.slice(0, 64)] = value.slice(0, 512);
    else if (typeof value === "number" || typeof value === "boolean" || value == null) out[key.slice(0, 64)] = value;
  }
  return out;
}

function growthAssumptionsFromQuery(c: { req: { query(name: string): string | undefined } }) {
  const targetRates = {
    launchToFirstStory: rateFromQuery(c.req.query("target_first_story_rate")),
    firstStoryToPlayback: rateFromQuery(c.req.query("target_playback_rate")),
    playbackToFirstPaywall: rateFromQuery(c.req.query("target_first_paywall_rate")),
    firstPaywallToPaywallView: rateFromQuery(c.req.query("target_paywall_view_rate")),
    paywallToPlanSelect: rateFromQuery(c.req.query("target_plan_select_rate")),
    planSelectToPurchaseStart: rateFromQuery(c.req.query("target_purchase_start_rate")),
    purchaseStartToPurchase: rateFromQuery(c.req.query("target_purchase_rate")),
  };

  return {
    monthlyRevenueTargetCny: positiveQueryNumber(c.req.query("target_mrr_cny")),
    monthlyPlanPriceCny: positiveQueryNumber(c.req.query("monthly_price_cny")),
    yearlyPlanPriceCny: positiveQueryNumber(c.req.query("yearly_price_cny")),
    yearlyOrderShare: rateFromQuery(c.req.query("yearly_order_share")),
    appleCommissionRate: rateFromQuery(c.req.query("apple_commission_rate")),
    paidUserAiCostMonthlyCny: nonNegativeQueryNumber(c.req.query("paid_ai_cost_cny")),
    freeTrialCostPerRegisteredUserCny: nonNegativeQueryNumber(c.req.query("free_trial_cost_cny")),
    targetRates,
  };
}

function purchaseBreakdownFromEventRows(rows: Record<string, unknown>[]) {
  let total = 0;
  let monthly = 0;
  let yearly = 0;

  for (const row of rows) {
    const count = numericValue(row.count);
    const metadata = parseMetadata(row.metadata);
    const productID = typeof metadata.product_id === "string" ? metadata.product_id : null;
    const plan = typeof metadata.plan === "string" ? metadata.plan : null;
    total += count;

    if (productID === NIANS_MONTHLY_PRODUCT_ID || plan === "monthly") monthly += count;
    else if (productID === NIANS_YEARLY_PRODUCT_ID || plan === "yearly") yearly += count;
  }

  return { total, monthly, yearly };
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function positiveQueryNumber(value: string | undefined): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function nonNegativeQueryNumber(value: string | undefined): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function rateFromQuery(value: string | undefined): number | undefined {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return number > 1 ? number / 100 : number;
}

function getBoundLedger(env: Env, sourceBinding: string | null): D1Database | null {
  switch (sourceBinding) {
    case "NIANS_SANDBOX_DB":
      return env.NIANS_SANDBOX_DB || null;
    case "NIANS_PROD_DB":
      return env.NIANS_PROD_DB || null;
    default:
      return null;
  }
}

function emptyNiansOverview(): NiansOverview {
  return {
    available: true,
    generation: {
      total: 0,
      acked: 0,
      failed: 0,
      active: 0,
      success_rate: 0,
      latest_job_at: null,
      avg_text_seconds: 0,
      avg_tts_seconds: 0,
    },
    quota: {
      periods: 0,
      limit: null,
      used: null,
      reserved: null,
      remaining: null,
    },
    provider: {
      attempts: [],
      failed_attempts: 0,
      active_leases: 0,
      token_usage: emptyNiansTokenUsage(),
    },
    commerce: {
      active_subscriptions: emptyNiansSubscriptionCounts(),
      registered_users: emptyNiansRegisteredUsers(),
    },
    system: {
      burn_cost_disabled: null,
      flags: [],
    },
    timeline: [],
  };
}

async function queryNiansOverview(env: Env, environment: AppEnvironment, range: { start: number; end: number }): Promise<NiansOverview> {
  const db = getBoundLedger(env, environment.source_binding);
  if (!db) {
    return { ...emptyNiansOverview(), available: false, error: "Nians ledger binding is not configured" };
  }

  const startIso = new Date(range.start * 1000).toISOString();
  const endIso = new Date(range.end * 1000).toISOString();
  const nowIso = new Date().toISOString();

  try {
    const [
      jobs,
      quota,
      attempts,
      durations,
      leases,
      flags,
      timeline,
    ] = await db.batch([
      db.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN state = 'acked' THEN 1 ELSE 0 END) AS acked,
          SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN state IN ('text_generating', 'text_ready', 'tts_generating', 'tts_ready') THEN 1 ELSE 0 END) AS active,
          MAX(created_at) AS latest_job_at
        FROM generation_jobs
        WHERE created_at BETWEEN ? AND ?
      `).bind(startIso, endIso),
      db.prepare(`
        SELECT
          COUNT(*) AS periods,
          SUM(limit_count) AS total_limit,
          SUM(used_count) AS total_used,
          SUM(reserved_count) AS total_reserved
        FROM quota_periods
      `),
      db.prepare(`
        SELECT kind, status, error_code, COUNT(*) AS count
        FROM provider_attempts
        WHERE created_at BETWEEN ? AND ?
        GROUP BY kind, status, error_code
        ORDER BY kind, status, error_code
      `).bind(startIso, endIso),
      db.prepare(`
        SELECT
          kind,
          ROUND(AVG((julianday(completed_at) - julianday(created_at)) * 86400.0), 1) AS avg_seconds
        FROM provider_attempts
        WHERE status = 'succeeded' AND completed_at IS NOT NULL AND created_at BETWEEN ? AND ?
        GROUP BY kind
      `).bind(startIso, endIso),
      db.prepare(`
        SELECT COUNT(*) AS active_leases
        FROM provider_leases
        WHERE expires_at > ?
      `).bind(nowIso),
      db.prepare("SELECT key, value, updated_at FROM system_flags ORDER BY key"),
      db.prepare(`
        SELECT
          substr(created_at, 1, 10) AS day,
          COUNT(*) AS jobs,
          SUM(CASE WHEN state = 'acked' THEN 1 ELSE 0 END) AS acked,
          SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS failed
        FROM generation_jobs
        WHERE created_at BETWEEN ? AND ?
        GROUP BY day
        ORDER BY day ASC
      `).bind(startIso, endIso),
    ]);

    const tokenUsage = await queryNiansTokenUsage(db, startIso, endIso);
    const activeSubscriptions = await queryNiansActiveSubscriptions(db, nowIso);
    const registeredUsers = await queryNiansRegisteredUsers(db, startIso, endIso);
    const jobRow = jobs.results[0] as Record<string, unknown> | undefined;
    const quotaRow = quota.results[0] as Record<string, unknown> | undefined;
    const leaseRow = leases.results[0] as Record<string, unknown> | undefined;
    const totalJobs = Number(jobRow?.total ?? 0);
    const ackedJobs = Number(jobRow?.acked ?? 0);
    const failedJobs = Number(jobRow?.failed ?? 0);
    const totalLimit = nullableNumber(quotaRow?.total_limit);
    const used = nullableNumber(quotaRow?.total_used);
    const reserved = nullableNumber(quotaRow?.total_reserved);
    const durationRows = durations.results as Record<string, unknown>[];
    const avgTextSeconds = Number(durationRows.find((row) => row.kind === "text")?.avg_seconds ?? 0);
    const avgTtsSeconds = Number(durationRows.find((row) => row.kind === "tts")?.avg_seconds ?? 0);
    const flagsRows = flags.results as Record<string, unknown>[];
    const burnFlag = flagsRows.find((row) => row.key === "burn_cost_disabled");

    return {
      available: true,
      generation: {
        total: totalJobs,
        acked: ackedJobs,
        failed: failedJobs,
        active: Number(jobRow?.active ?? 0),
        success_rate: ratePercent(ackedJobs, totalJobs),
        latest_job_at: (jobRow?.latest_job_at as string | null) || null,
        avg_text_seconds: avgTextSeconds,
        avg_tts_seconds: avgTtsSeconds,
      },
      quota: {
        periods: Number(quotaRow?.periods ?? 0),
        limit: totalLimit,
        used,
        reserved,
        remaining: remainingQuota(totalLimit, used, reserved),
      },
      provider: {
        attempts: attempts.results,
        failed_attempts: (attempts.results as Record<string, unknown>[])
          .filter((row) => row.status === "failed")
          .reduce((sum, row) => sum + Number(row.count ?? 0), 0),
        active_leases: Number(leaseRow?.active_leases ?? 0),
        token_usage: tokenUsage,
      },
      commerce: {
        active_subscriptions: activeSubscriptions,
        registered_users: registeredUsers,
      },
      system: {
        burn_cost_disabled: burnFlag ? String(burnFlag.value) === "true" : null,
        flags: flags.results,
      },
      timeline: timeline.results,
    };
  } catch (error) {
    return {
      ...emptyNiansOverview(),
      available: false,
      error: error instanceof Error ? error.message : "Failed to query Nians ledger",
    };
  }
}

async function queryNiansTokenUsage(db: D1Database, startIso: string, endIso: string): Promise<NiansTokenUsage> {
  try {
    const [summary, models] = await db.batch([
      db.prepare(`
        SELECT
          COUNT(*) AS attempts,
          SUM(input_tokens) AS input_tokens,
          SUM(output_tokens) AS output_tokens,
          SUM(total_tokens) AS total_tokens,
          SUM(reasoning_tokens) AS reasoning_tokens,
          SUM(cached_input_tokens) AS cached_input_tokens
        FROM provider_attempts
        WHERE kind = 'text'
          AND status = 'succeeded'
          AND created_at BETWEEN ? AND ?
      `).bind(startIso, endIso),
      db.prepare(`
        SELECT
          model_id,
          endpoint_id,
          COUNT(*) AS attempts,
          SUM(input_tokens) AS input_tokens,
          SUM(output_tokens) AS output_tokens,
          SUM(total_tokens) AS total_tokens,
          SUM(reasoning_tokens) AS reasoning_tokens,
          SUM(cached_input_tokens) AS cached_input_tokens
        FROM provider_attempts
        WHERE kind = 'text'
          AND status = 'succeeded'
          AND created_at BETWEEN ? AND ?
        GROUP BY model_id, endpoint_id
        ORDER BY total_tokens DESC
        LIMIT 10
      `).bind(startIso, endIso),
    ]);
    const tokenUsage = normalizeNiansTokenUsageRow(summary.results[0] as Record<string, unknown> | undefined);
    tokenUsage.models = normalizeNiansTokenUsageModelRows(models.results as Record<string, unknown>[]);
    return tokenUsage;
  } catch (error) {
    return {
      ...emptyNiansTokenUsage(false),
      error: error instanceof Error ? error.message : "Token usage columns are not available",
    };
  }
}

async function queryNiansActiveSubscriptions(db: D1Database, nowIso: string): Promise<NiansSubscriptionCounts> {
  try {
    const rows = await db.prepare(`
      SELECT product_id, COUNT(DISTINCT user_id) AS subscribers
      FROM entitlements
      WHERE status = 'active'
        AND (expires_at IS NULL OR expires_at > ?)
      GROUP BY product_id
    `).bind(nowIso).all<Record<string, unknown>>();

    let monthly = 0;
    let yearly = 0;
    let unknown = 0;
    for (const row of rows.results || []) {
      const count = numericValue(row.subscribers);
      if (row.product_id === NIANS_MONTHLY_PRODUCT_ID) monthly += count;
      else if (row.product_id === NIANS_YEARLY_PRODUCT_ID) yearly += count;
      else unknown += count;
    }

    return {
      available: true,
      monthly,
      yearly,
      unknown,
      total: monthly + yearly + unknown,
    };
  } catch (error) {
    return {
      ...emptyNiansSubscriptionCounts(false),
      error: error instanceof Error ? error.message : "Subscription entitlement rows are not available",
    };
  }
}

async function queryNiansRegisteredUsers(db: D1Database, startIso: string, endIso: string): Promise<NiansRegisteredUsers> {
  try {
    const row = await db.prepare(`
      SELECT COUNT(*) AS count
      FROM users
      WHERE created_at BETWEEN ? AND ?
    `).bind(startIso, endIso).first<Record<string, unknown>>();

    return {
      available: true,
      count: numericValue(row?.count),
    };
  } catch (error) {
    return {
      ...emptyNiansRegisteredUsers(false),
      error: error instanceof Error ? error.message : "Registered-user rows are not available",
    };
  }
}

function emptyNiansTokenUsage(available = true): NiansTokenUsage {
  return {
    available,
    attempts: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    reasoning_tokens: 0,
    cached_input_tokens: 0,
    avg_total_tokens_per_attempt: null,
    models: [],
  };
}

function emptyNiansSubscriptionCounts(available = true): NiansSubscriptionCounts {
  return {
    available,
    total: 0,
    monthly: 0,
    yearly: 0,
    unknown: 0,
  };
}

function emptyNiansRegisteredUsers(available = true): NiansRegisteredUsers {
  return {
    available,
    count: 0,
  };
}

export function normalizeNiansTokenUsageRow(row?: Record<string, unknown> | null): NiansTokenUsage {
  const attempts = numericValue(row?.attempts);
  const totalTokens = numericValue(row?.total_tokens);
  return {
    available: true,
    attempts,
    input_tokens: numericValue(row?.input_tokens),
    output_tokens: numericValue(row?.output_tokens),
    total_tokens: totalTokens,
    reasoning_tokens: numericValue(row?.reasoning_tokens),
    cached_input_tokens: numericValue(row?.cached_input_tokens),
    avg_total_tokens_per_attempt: attempts > 0 ? roundOne(totalTokens / attempts) : null,
    models: [],
  };
}

function normalizeNiansTokenUsageModelRows(rows: Record<string, unknown>[]): NiansTokenUsageModel[] {
  return rows.map((row) => {
    const attempts = numericValue(row.attempts);
    const totalTokens = numericValue(row.total_tokens);
    return {
      model_id: typeof row.model_id === "string" && row.model_id ? row.model_id : null,
      endpoint_id: typeof row.endpoint_id === "string" && row.endpoint_id ? row.endpoint_id : null,
      attempts,
      input_tokens: numericValue(row.input_tokens),
      output_tokens: numericValue(row.output_tokens),
      total_tokens: totalTokens,
      reasoning_tokens: numericValue(row.reasoning_tokens),
      cached_input_tokens: numericValue(row.cached_input_tokens),
      avg_total_tokens_per_attempt: attempts > 0 ? roundOne(totalTokens / attempts) : null,
    };
  });
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numericValue(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}
