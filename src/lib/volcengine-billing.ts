import type { Env } from "../types";
import { nanoid } from "./nanoid";

const BALANCE_HOST = "open.volcengineapi.com";
const BALANCE_ACTION = "QueryBalanceAcct";
const BALANCE_SERVICE = "billing";
const BALANCE_REGION = "cn-beijing";
const BALANCE_VERSION = "2022-01-01";
const BILLING_CONTENT_TYPE = "application/json";
const BILLING_PRODUCTS_ACTION = "ListBillOverviewByProd";
const DEFAULT_BILLING_PRODUCT_CODES = "TTS-SeedTTS2.0,ark_bd,AI-SavingsPlans";
const SPEECH_HOST = "open.volcengineapi.com";
const SPEECH_SERVICE = "speech_saas_prod";
const SPEECH_REGION = "cn-north-1";
const SPEECH_VERSION = "2021-08-30";
const SPEECH_CONTENT_TYPE = "application/json; charset=utf-8";
const DEFAULT_SPEECH_RESOURCE_IDS = "volc.service_type.10029";

interface VolcengineBalanceResult {
  AccountID?: number | string;
  ArrearsBalance?: string | number;
  AvailableBalance?: string | number;
  CashBalance?: string | number;
  CreditLimit?: string | number;
  FreezeAmount?: string | number;
}

interface VolcengineResponseMetadata {
  Error?: {
    Code?: string;
    Message?: string;
  };
}

interface VolcengineBillingProductRow {
  BillPeriod?: string;
  BillingMode?: string;
  PayableAmount?: string | number;
  Product?: string;
  ProductZh?: string;
}

export interface VolcengineBalanceSnapshot {
  account_id: string | null;
  available_balance: number;
  cash_balance: number | null;
  arrears_balance: number | null;
  credit_limit: number | null;
  freeze_amount: number | null;
  captured_at: number;
}

export interface VolcengineSnapshotWriteResult {
  snapshot: VolcengineBalanceSnapshot;
  inserted: number;
}

export interface VolcengineBillingProductWindow {
  billPeriod: string;
  window_start: number;
  window_end: number;
}

export interface VolcengineBillingProductSnapshot {
  bill_period: string;
  product: string;
  product_zh: string | null;
  metric: string;
  value: number;
  unit: string;
  window_start: number;
  window_end: number;
  source: string;
  captured_at: number;
}

export interface VolcengineBillingProductWriteResult {
  inserted: number;
  products: string[];
  periods: string[];
  errors: string[];
}

export interface VolcengineSpeechMonitoringWindow {
  startDate: string;
  endDate: string;
  window_start: number;
  window_end: number;
}

export interface VolcengineSpeechUsageSnapshot {
  resource_id: string;
  metric: string;
  value: number;
  unit: string;
  window_start: number;
  window_end: number;
  captured_at: number;
}

export interface VolcengineSpeechQuotaSnapshot {
  resource_id: string;
  quota_type: string;
  used: number | null;
  limit_value: number | null;
  remaining: number | null;
  unit: string;
  captured_at: number;
}

export interface VolcengineSpeechMonitoringWriteResult {
  configured: boolean;
  usageInserted: number;
  quotaInserted: number;
  resources: string[];
  errors: string[];
}

export interface VolcengineProviderSnapshotWriteResult {
  balance: VolcengineSnapshotWriteResult;
  billing: VolcengineBillingProductWriteResult;
  speech: VolcengineSpeechMonitoringWriteResult;
}

export function hasVolcengineBillingCredentials(env: Env): boolean {
  return Boolean(env.VOLCENGINE_ACCESS_KEY_ID && env.VOLCENGINE_SECRET_ACCESS_KEY);
}

export function hasVolcengineSpeechMonitoringConfig(env: Env): boolean {
  return hasVolcengineBillingCredentials(env) && Boolean(env.VOLCENGINE_SPEECH_APP_ID);
}

export async function fetchVolcengineBalanceSnapshot(
  env: Env,
  now = Math.floor(Date.now() / 1000),
): Promise<VolcengineBalanceSnapshot> {
  const accessKey = env.VOLCENGINE_ACCESS_KEY_ID;
  const secretKey = env.VOLCENGINE_SECRET_ACCESS_KEY;
  if (!accessKey || !secretKey) {
    throw new Error("Volcengine billing credentials are not configured");
  }

  const signed = await buildVolcengineBillingSignedRequest(accessKey, secretKey);
  const res = await fetch(signed.url, {
    method: "GET",
    headers: signed.headers,
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = extractVolcengineError(body) || `Volcengine billing request failed with ${res.status}`;
    throw new Error(message);
  }

  return parseVolcengineBalanceResponse(body, now);
}

export async function buildVolcengineBillingSignedRequest(
  accessKey: string,
  secretKey: string,
  now = new Date(),
): Promise<{ url: string; headers: Record<string, string> }> {
  const method = "GET";
  const path = "/";
  const body = "";
  const xDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const shortDate = xDate.slice(0, 8);
  const payloadHash = await sha256Hex(body);
  const signedHeaders = "host;x-date";
  const params = {
    Action: BALANCE_ACTION,
    Version: BALANCE_VERSION,
  };
  const queryString = canonicalQuery(params);
  const canonicalHeaders = [
    `host:${BALANCE_HOST}`,
    `x-date:${xDate}`,
  ].join("\n");
  const canonicalRequest = [
    method,
    path,
    queryString,
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const hashedCanonicalRequest = await sha256Hex(canonicalRequest);
  const credentialScope = `${shortDate}/${BALANCE_REGION}/${BALANCE_SERVICE}/request`;
  const stringToSign = ["HMAC-SHA256", xDate, credentialScope, hashedCanonicalRequest].join("\n");
  const signingKey = await signingSecretKey(secretKey, shortDate, BALANCE_REGION, BALANCE_SERVICE);
  const signature = bytesToHex(await hmacSha256(signingKey, stringToSign));

  return {
    url: `https://${BALANCE_HOST}/?${queryString}`,
    headers: {
      "X-Date": xDate,
      Authorization: `HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

export async function buildVolcengineBillingSignedPostRequest(
  accessKey: string,
  secretKey: string,
  action: string,
  body: string,
  now = new Date(),
): Promise<{ url: string; headers: Record<string, string> }> {
  const method = "POST";
  const path = "/";
  const xDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const shortDate = xDate.slice(0, 8);
  const payloadHash = await sha256Hex(body);
  const signedHeaders = "content-type;host;x-content-sha256;x-date";
  const queryString = canonicalQuery({
    Action: action,
    Version: BALANCE_VERSION,
  });
  const canonicalHeaders = [
    `content-type:${BILLING_CONTENT_TYPE}`,
    `host:${BALANCE_HOST}`,
    `x-content-sha256:${payloadHash}`,
    `x-date:${xDate}`,
  ].join("\n");
  const canonicalRequest = [
    method,
    path,
    queryString,
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const hashedCanonicalRequest = await sha256Hex(canonicalRequest);
  const credentialScope = `${shortDate}/${BALANCE_REGION}/${BALANCE_SERVICE}/request`;
  const stringToSign = ["HMAC-SHA256", xDate, credentialScope, hashedCanonicalRequest].join("\n");
  const signingKey = await signingSecretKey(secretKey, shortDate, BALANCE_REGION, BALANCE_SERVICE);
  const signature = bytesToHex(await hmacSha256(signingKey, stringToSign));

  return {
    url: `https://${BALANCE_HOST}/?${queryString}`,
    headers: {
      "Content-Type": BILLING_CONTENT_TYPE,
      "X-Content-Sha256": payloadHash,
      "X-Date": xDate,
      Authorization: `HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

export function parseVolcengineBalanceResponse(body: unknown, now = Math.floor(Date.now() / 1000)): VolcengineBalanceSnapshot {
  const error = extractVolcengineError(body);
  if (error) throw new Error(error);

  const response = asRecord(body, "response");
  const result = asRecord(response.Result, "Result") as VolcengineBalanceResult;
  return {
    account_id: result.AccountID == null ? null : String(result.AccountID),
    available_balance: parseMoney(result.AvailableBalance, "AvailableBalance"),
    cash_balance: parseOptionalMoney(result.CashBalance, "CashBalance"),
    arrears_balance: parseOptionalMoney(result.ArrearsBalance, "ArrearsBalance"),
    credit_limit: parseOptionalMoney(result.CreditLimit, "CreditLimit"),
    freeze_amount: parseOptionalMoney(result.FreezeAmount, "FreezeAmount"),
    captured_at: now,
  };
}

export function parseVolcengineBillingProductCodes(raw?: string): string[] {
  const source = raw?.trim() ? raw : DEFAULT_BILLING_PRODUCT_CODES;
  return [...new Set(source.split(",").map((item) => item.trim()).filter(Boolean))];
}

export function billingProductWindows(now = Math.floor(Date.now() / 1000), months = 2): VolcengineBillingProductWindow[] {
  const safeMonths = Math.max(1, Math.min(months, 12));
  const shanghaiDate = new Date((now + 8 * 3600) * 1000);
  const year = shanghaiDate.getUTCFullYear();
  const monthIndex = shanghaiDate.getUTCMonth();
  const windows: VolcengineBillingProductWindow[] = [];

  for (let offset = 0; offset < safeMonths; offset += 1) {
    const monthStart = Date.UTC(year, monthIndex - offset, 1) / 1000 - 8 * 3600;
    const nextMonthStart = Date.UTC(year, monthIndex - offset + 1, 1) / 1000 - 8 * 3600;
    const date = new Date((monthStart + 8 * 3600) * 1000);
    windows.push({
      billPeriod: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
      window_start: monthStart,
      window_end: nextMonthStart - 1,
    });
  }

  return windows;
}

export function parseVolcengineBillingProductResponse(
  body: unknown,
  window: VolcengineBillingProductWindow,
  productCodes = parseVolcengineBillingProductCodes(),
  now = Math.floor(Date.now() / 1000),
): VolcengineBillingProductSnapshot[] {
  const error = extractVolcengineError(body);
  if (error) throw new Error(error);

  const response = asRecord(body, "response");
  const result = asRecord(response.Result, "Result");
  const rows = Array.isArray(result.List) ? result.List as VolcengineBillingProductRow[] : [];
  const allowedProducts = new Set(productCodes);
  const byProduct = new Map<string, {
    product: string;
    product_zh: string | null;
    value: number;
  }>();

  for (const row of rows) {
    const product = row.Product;
    if (!product || !allowedProducts.has(product)) continue;
    const current = byProduct.get(product) ?? {
      product,
      product_zh: typeof row.ProductZh === "string" && row.ProductZh.trim() ? row.ProductZh : null,
      value: 0,
    };
    current.product_zh ||= typeof row.ProductZh === "string" && row.ProductZh.trim() ? row.ProductZh : null;
    current.value += parseMoney(row.PayableAmount ?? 0, "PayableAmount");
    byProduct.set(product, current);
  }

  return [...byProduct.values()].map((item) => ({
    bill_period: window.billPeriod,
    product: item.product,
    product_zh: item.product_zh,
    metric: `billing_${slugifyMetricPart(item.product)}_month_payable`,
    value: roundMoney(item.value),
    unit: "CNY",
    window_start: window.window_start,
    window_end: window.window_end,
    source: `${BILLING_PRODUCTS_ACTION}:${window.billPeriod}:${item.product}`,
    captured_at: now,
  }));
}

export async function recordVolcengineBalanceSnapshots(
  env: Env,
  options: { appId?: string; appSlug?: string; environmentName?: string } = {},
): Promise<VolcengineSnapshotWriteResult> {
  const snapshot = await fetchVolcengineBalanceSnapshot(env);
  const environments = await getTargetEnvironments(env, options);

  let inserted = 0;
  for (const environment of environments.results) {
    await env.DB.prepare(`
      INSERT INTO provider_usage_snapshots (
        id, app_id, environment_id, provider, metric, value, unit,
        window_start, window_end, source, captured_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        nanoid(),
        environment.app_id,
        environment.id,
        "volcengine",
        "account_available_balance",
        snapshot.available_balance,
        "CNY",
        snapshot.captured_at,
        snapshot.captured_at,
        "QueryBalanceAcct",
        snapshot.captured_at,
      )
      .run();
    inserted += 1;
  }

  return { snapshot, inserted };
}

export async function fetchVolcengineBillingProductSnapshots(
  env: Env,
  window: VolcengineBillingProductWindow,
  productCodes = parseVolcengineBillingProductCodes(env.VOLCENGINE_BILLING_PRODUCT_CODES),
  now = Math.floor(Date.now() / 1000),
): Promise<VolcengineBillingProductSnapshot[]> {
  const accessKey = env.VOLCENGINE_ACCESS_KEY_ID;
  const secretKey = env.VOLCENGINE_SECRET_ACCESS_KEY;
  if (!accessKey || !secretKey) {
    throw new Error("Volcengine billing credentials are not configured");
  }

  const body = JSON.stringify({
    Offset: 0,
    Limit: 100,
    BillPeriod: window.billPeriod,
    IgnoreZero: 0,
    NeedRecordNum: 1,
  });
  const signed = await buildVolcengineBillingSignedPostRequest(
    accessKey,
    secretKey,
    BILLING_PRODUCTS_ACTION,
    body,
  );
  const res = await fetch(signed.url, {
    method: "POST",
    headers: signed.headers,
    body,
  });

  const response = await res.json().catch(() => null);
  if (!res.ok) {
    const message = extractVolcengineError(response) || `Volcengine billing products request failed with ${res.status}`;
    throw new Error(message);
  }

  return parseVolcengineBillingProductResponse(response, window, productCodes, now);
}

export async function recordVolcengineBillingProductSnapshots(
  env: Env,
  options: { appId?: string; appSlug?: string; environmentName?: string } = {},
): Promise<VolcengineBillingProductWriteResult> {
  const environments = await getTargetEnvironments(env, options);
  const productCodes = parseVolcengineBillingProductCodes(env.VOLCENGINE_BILLING_PRODUCT_CODES);
  const windows = billingProductWindows();
  const errors: string[] = [];
  let inserted = 0;

  for (const window of windows) {
    try {
      const snapshots = await fetchVolcengineBillingProductSnapshots(env, window, productCodes);
      for (const snapshot of snapshots) {
        for (const environment of environments.results) {
          await env.DB.prepare(`
            INSERT INTO provider_usage_snapshots (
              id, app_id, environment_id, provider, metric, value, unit,
              window_start, window_end, source, captured_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
            .bind(
              nanoid(),
              environment.app_id,
              environment.id,
              "volcengine",
              snapshot.metric,
              snapshot.value,
              snapshot.unit,
              snapshot.window_start,
              snapshot.window_end,
              snapshot.source,
              snapshot.captured_at,
            )
            .run();
          inserted += 1;
        }
      }
    } catch (error) {
      errors.push(formatBillingProductError(window.billPeriod, error));
    }
  }

  return {
    inserted,
    products: productCodes,
    periods: windows.map((window) => window.billPeriod),
    errors,
  };
}

export async function recordVolcengineProviderSnapshots(
  env: Env,
  options: { appId?: string; appSlug?: string; environmentName?: string } = {},
): Promise<VolcengineProviderSnapshotWriteResult> {
  const balance = await recordVolcengineBalanceSnapshots(env, options);
  const billing = await recordVolcengineBillingProductSnapshots(env, options);
  const speech = await recordVolcengineSpeechMonitoringSnapshots(env, options);
  return { balance, billing, speech };
}

export async function recordVolcengineSpeechMonitoringSnapshots(
  env: Env,
  options: { appId?: string; appSlug?: string; environmentName?: string } = {},
): Promise<VolcengineSpeechMonitoringWriteResult> {
  if (!hasVolcengineSpeechMonitoringConfig(env)) {
    return { configured: false, usageInserted: 0, quotaInserted: 0, resources: [], errors: [] };
  }

  const environments = await getTargetEnvironments(env, options);
  const resources = parseVolcengineSpeechResourceIDs(env.VOLCENGINE_SPEECH_RESOURCE_IDS);
  const window = speechMonitoringWindow();
  const errors: string[] = [];
  let usageInserted = 0;
  let quotaInserted = 0;

  for (const resourceID of resources) {
    try {
      const usage = await fetchVolcengineSpeechUsageSnapshot(env, resourceID, window);
      for (const environment of environments.results) {
        await env.DB.prepare(`
          INSERT INTO provider_usage_snapshots (
            id, app_id, environment_id, provider, metric, value, unit,
            window_start, window_end, source, captured_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
          .bind(
            nanoid(),
            environment.app_id,
            environment.id,
            "volcengine",
            usage.metric,
            usage.value,
            usage.unit,
            usage.window_start,
            usage.window_end,
            `UsageMonitoring:${usage.resource_id}`,
            usage.captured_at,
          )
          .run();
        usageInserted += 1;
      }
    } catch (error) {
      errors.push(formatMonitoringError("UsageMonitoring", resourceID, error));
    }

    try {
      const quota = await fetchVolcengineSpeechQuotaSnapshot(env, resourceID, window);
      for (const environment of environments.results) {
        await env.DB.prepare(`
          INSERT INTO provider_quota_snapshots (
            id, app_id, environment_id, provider, quota_type, used, limit_value,
            remaining, unit, source, captured_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
          .bind(
            nanoid(),
            environment.app_id,
            environment.id,
            "volcengine",
            quota.quota_type,
            quota.used,
            quota.limit_value,
            quota.remaining,
            quota.unit,
            `QuotaMonitoring:${quota.resource_id}:hourly`,
            quota.captured_at,
          )
          .run();
        quotaInserted += 1;
      }
    } catch (error) {
      errors.push(formatMonitoringError("QuotaMonitoring", resourceID, error));
    }
  }

  return { configured: true, usageInserted, quotaInserted, resources, errors };
}

export function parseVolcengineSpeechResourceIDs(raw?: string): string[] {
  const source = raw?.trim() ? raw : DEFAULT_SPEECH_RESOURCE_IDS;
  return [...new Set(source.split(",").map((item) => item.trim()).filter(Boolean))];
}

export function speechMonitoringWindow(now = Math.floor(Date.now() / 1000), days = 7): VolcengineSpeechMonitoringWindow {
  const safeDays = Math.max(1, Math.min(days, 7));
  const endDate = formatShanghaiDate(now);
  const startDate = formatShanghaiDate(now - (safeDays - 1) * 86400);
  return {
    startDate,
    endDate,
    window_start: Date.parse(`${startDate}T00:00:00+08:00`) / 1000,
    window_end: Date.parse(`${endDate}T23:59:59+08:00`) / 1000,
  };
}

export async function fetchVolcengineSpeechUsageSnapshot(
  env: Env,
  resourceID: string,
  window = speechMonitoringWindow(),
  now = Math.floor(Date.now() / 1000),
): Promise<VolcengineSpeechUsageSnapshot> {
  const appID = env.VOLCENGINE_SPEECH_APP_ID;
  if (!appID) {
    throw new Error("VOLCENGINE_SPEECH_APP_ID is not configured");
  }
  const body = await callVolcengineSpeechAPI(env, "UsageMonitoring", {
    AppID: appID,
    ResourceID: resourceID,
    Start: window.startDate,
    End: window.endDate,
    Mode: "daily",
  });
  return parseVolcengineSpeechUsageResponse(body, resourceID, window, now);
}

export async function fetchVolcengineSpeechQuotaSnapshot(
  env: Env,
  resourceID: string,
  window = speechMonitoringWindow(),
  now = Math.floor(Date.now() / 1000),
): Promise<VolcengineSpeechQuotaSnapshot> {
  const appID = env.VOLCENGINE_SPEECH_APP_ID;
  if (!appID) {
    throw new Error("VOLCENGINE_SPEECH_APP_ID is not configured");
  }
  const body = await callVolcengineSpeechAPI(env, "QuotaMonitoring", {
    AppID: appID,
    ResourceID: resourceID,
    Start: window.startDate,
    End: window.endDate,
    Mode: "hourly",
  });
  return parseVolcengineSpeechQuotaResponse(body, resourceID, now);
}

export function parseVolcengineSpeechUsageResponse(
  body: unknown,
  resourceID: string,
  window: VolcengineSpeechMonitoringWindow,
  now = Math.floor(Date.now() / 1000),
): VolcengineSpeechUsageSnapshot {
  assertVolcengineMonitoringSuccess(body);
  const response = monitoringResponse(body);
  const data = asRecord(response.data, "data");
  const rows = Array.isArray(data.usage_monitoring) ? data.usage_monitoring : [];
  const usage = rows.reduce((sum, row) => sum + optionalNumber((row as Record<string, unknown>).value), 0);
  const resource = speechResourceForID(resourceID);

  return {
    resource_id: resourceID,
    metric: resource.usageMetric,
    value: usage,
    unit: resource.usageUnit,
    window_start: window.window_start,
    window_end: window.window_end,
    captured_at: now,
  };
}

export function parseVolcengineSpeechQuotaResponse(
  body: unknown,
  resourceID: string,
  now = Math.floor(Date.now() / 1000),
): VolcengineSpeechQuotaSnapshot {
  assertVolcengineMonitoringSuccess(body);
  const response = monitoringResponse(body);
  const data = asRecord(response.data, "data");
  const rows = Array.isArray(data.quota_monitoring) ? data.quota_monitoring as Record<string, unknown>[] : [];
  const peakUsed = rows.reduce<number | null>((max, row) => {
    const value = nullableNumber(row.value);
    if (value == null) return max;
    return max == null ? value : Math.max(max, value);
  }, null);
  const latestLimit = [...rows].reverse().map((row) => nullableNumber(row.limit)).find((value) => value != null) ?? null;
  const resource = speechResourceForID(resourceID);

  return {
    resource_id: resourceID,
    quota_type: resource.quotaType,
    used: peakUsed,
    limit_value: latestLimit,
    remaining: latestLimit == null || peakUsed == null ? null : Math.max(0, latestLimit - peakUsed),
    unit: resource.quotaUnit,
    captured_at: now,
  };
}

async function getTargetEnvironments(
  env: Env,
  options: { appId?: string; appSlug?: string; environmentName?: string },
): Promise<D1Result<{ id: string; app_id: string }>> {
  const bindings: unknown[] = [];
  const filters: string[] = [];

  if (options.appId) {
    filters.push("e.app_id = ?");
    bindings.push(options.appId);
  }
  if (options.appSlug) {
    filters.push("a.slug = ?");
    bindings.push(options.appSlug);
  }
  if (options.environmentName) {
    filters.push("e.name = ?");
    bindings.push(options.environmentName);
  }

  const sql = `
    SELECT e.id, e.app_id
    FROM app_environments e
    JOIN apps a ON a.id = e.app_id
    ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
    ORDER BY e.app_id, e.name
  `;
  return env.DB.prepare(sql).bind(...bindings).all<{ id: string; app_id: string }>();
}

async function callVolcengineSpeechAPI(env: Env, action: "UsageMonitoring" | "QuotaMonitoring", query: Record<string, string>): Promise<unknown> {
  const accessKey = env.VOLCENGINE_ACCESS_KEY_ID;
  const secretKey = env.VOLCENGINE_SECRET_ACCESS_KEY;
  if (!accessKey || !secretKey) {
    throw new Error("Volcengine billing credentials are not configured");
  }

  const signed = await buildVolcengineSpeechSignedRequest(accessKey, secretKey, action, query);
  const res = await fetch(signed.url, {
    method: "GET",
    headers: signed.headers,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(extractVolcengineMonitoringError(body) || `Volcengine ${action} request failed with ${res.status}`);
  }
  return body;
}

async function buildVolcengineSpeechSignedRequest(
  accessKey: string,
  secretKey: string,
  action: string,
  query: Record<string, string>,
  now = new Date(),
): Promise<{ url: string; headers: Record<string, string> }> {
  const method = "GET";
  const path = "/";
  const body = "";
  const xDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const shortDate = xDate.slice(0, 8);
  const payloadHash = await sha256Hex(body);
  const signedHeaders = "content-type;host;x-content-sha256;x-date";
  const params = {
    Action: action,
    Version: SPEECH_VERSION,
    ...query,
  };
  const queryString = canonicalQuery(params);
  const canonicalHeaders = [
    `content-type:${SPEECH_CONTENT_TYPE}`,
    `host:${SPEECH_HOST}`,
    `x-content-sha256:${payloadHash}`,
    `x-date:${xDate}`,
  ].join("\n");
  const canonicalRequest = [
    method,
    path,
    queryString,
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const hashedCanonicalRequest = await sha256Hex(canonicalRequest);
  const credentialScope = `${shortDate}/${SPEECH_REGION}/${SPEECH_SERVICE}/request`;
  const stringToSign = ["HMAC-SHA256", xDate, credentialScope, hashedCanonicalRequest].join("\n");
  const signingKey = await signingSecretKey(secretKey, shortDate, SPEECH_REGION, SPEECH_SERVICE);
  const signature = bytesToHex(await hmacSha256(signingKey, stringToSign));

  return {
    url: `https://${SPEECH_HOST}/?${queryString}`,
    headers: {
      "Content-Type": SPEECH_CONTENT_TYPE,
      "X-Content-Sha256": payloadHash,
      "X-Date": xDate,
      Authorization: `HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

function extractVolcengineError(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const metadata = (body as { ResponseMetadata?: VolcengineResponseMetadata }).ResponseMetadata;
  const error = metadata?.Error;
  if (!error) return null;
  const code = error.Code || "VolcengineError";
  return error.Message ? `${code}: ${error.Message}` : code;
}

function assertVolcengineMonitoringSuccess(body: unknown): void {
  const error = extractVolcengineMonitoringError(body);
  if (error) throw new Error(error);
  const response = monitoringResponse(body);
  if (response.status != null && response.status !== "success") {
    throw new Error(`Volcengine monitoring request failed: ${String(response.status)}`);
  }
}

function extractVolcengineMonitoringError(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const response = body as Record<string, unknown>;
  const metadataError = extractVolcengineError(body);
  if (metadataError) return metadataError;
  const error = response.error ?? response.error_message;
  if (typeof error === "string" && error.trim()) return error;
  return null;
}

function monitoringResponse(body: unknown): Record<string, unknown> {
  const response = asRecord(body, "response");
  return response.response && typeof response.response === "object" && !Array.isArray(response.response)
    ? response.response as Record<string, unknown>
    : response;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Volcengine billing response missing ${label}`);
  }
  return value as Record<string, unknown>;
}

function parseMoney(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Volcengine billing response has invalid ${field}`);
  }
  return number;
}

function parseOptionalMoney(value: unknown, field: string): number | null {
  return value == null ? null : parseMoney(value, field);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function optionalNumber(value: unknown): number {
  return nullableNumber(value) ?? 0;
}

function speechResourceForID(resourceID: string): {
  usageMetric: string;
  usageUnit: string;
  quotaType: string;
  quotaUnit: string;
} {
  if (resourceID === "volc.service_type.10029") {
    return {
      usageMetric: "speech_bigtts_usage_7d",
      usageUnit: "text_words",
      quotaType: "speech_bigtts_concurrency_peak",
      quotaUnit: "concurrency",
    };
  }
  if (resourceID === "volc.tts.default") {
    return {
      usageMetric: "speech_tts_default_usage_7d",
      usageUnit: "requests",
      quotaType: "speech_tts_default_concurrency_peak",
      quotaUnit: "concurrency",
    };
  }

  const slug = resourceID.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
  return {
    usageMetric: `speech_${slug}_usage_7d`,
    usageUnit: "units",
    quotaType: `speech_${slug}_quota_peak`,
    quotaUnit: "quota",
  };
}

function formatShanghaiDate(timestampSeconds: number): string {
  return new Date((timestampSeconds + 8 * 3600) * 1000).toISOString().slice(0, 10);
}

function formatMonitoringError(action: string, resourceID: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${action}:${resourceID}:${message}`;
}

function formatBillingProductError(billPeriod: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${BILLING_PRODUCTS_ACTION}:${billPeriod}:${message}`;
}

function slugifyMetricPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${rfc3986Encode(key)}=${rfc3986Encode(params[key])}`)
    .join("&");
}

function rfc3986Encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function signingSecretKey(secretKey: string, date: string, region: string, service: string): Promise<Uint8Array> {
  const kDate = await hmacSha256(new TextEncoder().encode(secretKey), date);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, "request");
}

async function hmacSha256(key: Uint8Array, content: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(content));
  return new Uint8Array(signature);
}

async function sha256Hex(content: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
