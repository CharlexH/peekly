import { describe, expect, it } from "vitest";
import {
  buildGrowthOverview,
  deriveAppOpsAlerts,
  defaultGrowthAssumptions,
  ratePercent,
  remainingQuota,
  severityScore,
} from "../src/lib/app-ops";
import {
  billingProductWindows,
  buildVolcengineBillingSignedPostRequest,
  buildVolcengineBillingSignedRequest,
  parseVolcengineBillingProductCodes,
  parseVolcengineBillingProductResponse,
  parseVolcengineBalanceResponse,
  parseVolcengineSpeechQuotaResponse,
  parseVolcengineSpeechResourceIDs,
  parseVolcengineSpeechUsageResponse,
  speechMonitoringWindow,
} from "../src/lib/volcengine-billing";
import { normalizeNiansTokenUsageRow } from "../src/routes/apps";

describe("ratePercent", () => {
  it("rounds to one decimal place", () => {
    expect(ratePercent(2, 3)).toBe(66.7);
  });

  it("returns 0 for empty denominators", () => {
    expect(ratePercent(1, 0)).toBe(0);
  });
});

describe("remainingQuota", () => {
  it("subtracts used and reserved quota", () => {
    expect(remainingQuota(30, 11, 2)).toBe(17);
  });

  it("never returns negative quota", () => {
    expect(remainingQuota(3, 5, 1)).toBe(0);
  });
});

describe("deriveAppOpsAlerts", () => {
  it("flags an open sandbox cost gate and provider failures", () => {
    const alerts = deriveAppOpsAlerts({
      environmentName: "sandbox",
      isProduction: false,
      burnCostDisabled: false,
      failedJobs: 0,
      failedProviderAttempts: 2,
      activeLeases: 0,
      quotaRemaining: 20,
      latestJobAt: "2026-05-14T11:52:44.016Z",
      accountBalanceCny: 100,
    });

    expect(alerts.map((alert) => alert.title)).toContain("Sandbox provider spend is enabled");
    expect(alerts.map((alert) => alert.title)).toContain("Provider attempts failed");
  });

  it("sorts critical severities above warnings and info", () => {
    expect(severityScore("critical")).toBeGreaterThan(severityScore("warning"));
    expect(severityScore("warning")).toBeGreaterThan(severityScore("info"));
  });

  it("flags critically low Volcengine account balance", () => {
    const alerts = deriveAppOpsAlerts({
      environmentName: "sandbox",
      isProduction: false,
      burnCostDisabled: true,
      failedJobs: 0,
      failedProviderAttempts: 0,
      activeLeases: 0,
      quotaRemaining: 20,
      latestJobAt: "2026-05-14T11:52:44.016Z",
      accountBalanceCny: 9.99,
    });

    expect(alerts.map((alert) => alert.title)).toContain("Volcengine balance is critically low");
  });

  it("flags missing balance snapshots and high speech concurrency", () => {
    const alerts = deriveAppOpsAlerts({
      environmentName: "sandbox",
      isProduction: false,
      burnCostDisabled: true,
      failedJobs: 0,
      failedProviderAttempts: 0,
      activeLeases: 0,
      quotaRemaining: 20,
      latestJobAt: "2026-05-14T11:52:44.016Z",
      accountBalanceCny: null,
      speechConcurrencyUtilization: 90,
    });

    expect(alerts.map((alert) => alert.title)).toContain("Volcengine balance signal is missing");
    expect(alerts.map((alert) => alert.title)).toContain("Volcengine TTS concurrency is near limit");
  });
});

describe("parseVolcengineBalanceResponse", () => {
  it("signs QueryBalanceAcct with the Volcengine billing credential scope", async () => {
    const signed = await buildVolcengineBillingSignedRequest(
      "AKLTtest",
      "secret",
      new Date("2026-05-17T09:45:12Z"),
    );

    expect(signed.url).toBe("https://open.volcengineapi.com/?Action=QueryBalanceAcct&Version=2022-01-01");
    expect(signed.headers["X-Date"]).toBe("20260517T094512Z");
    expect(signed.headers.Authorization).toMatch(
      /^HMAC-SHA256 Credential=AKLTtest\/20260517\/cn-beijing\/billing\/request, SignedHeaders=host;x-date, Signature=[a-f0-9]{64}$/,
    );
  });

  it("signs billing product requests with the request body hash", async () => {
    const signed = await buildVolcengineBillingSignedPostRequest(
      "AKLTtest",
      "secret",
      "ListBillOverviewByProd",
      JSON.stringify({ BillPeriod: "2026-05", Offset: 0, Limit: 100 }),
      new Date("2026-05-17T09:45:12Z"),
    );

    expect(signed.url).toBe("https://open.volcengineapi.com/?Action=ListBillOverviewByProd&Version=2022-01-01");
    expect(signed.headers["Content-Type"]).toBe("application/json");
    expect(signed.headers["X-Date"]).toBe("20260517T094512Z");
    expect(signed.headers["X-Content-Sha256"]).toMatch(/^[a-f0-9]{64}$/);
    expect(signed.headers.Authorization).toMatch(
      /^HMAC-SHA256 Credential=AKLTtest\/20260517\/cn-beijing\/billing\/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=[a-f0-9]{64}$/,
    );
  });

  it("normalizes the official QueryBalanceAcct response", () => {
    const snapshot = parseVolcengineBalanceResponse({
      ResponseMetadata: {
        RequestId: "req",
        Action: "QueryBalanceAcct",
        Version: "2022-01-01",
        Service: "billing",
      },
      Result: {
        AccountID: 210000001,
        ArrearsBalance: "1.01",
        AvailableBalance: "77.01",
        CashBalance: "83.01",
        CreditLimit: "0.01",
        FreezeAmount: "5.01",
      },
    }, 1778889600);

    expect(snapshot).toEqual({
      account_id: "210000001",
      available_balance: 77.01,
      cash_balance: 83.01,
      arrears_balance: 1.01,
      credit_limit: 0.01,
      freeze_amount: 5.01,
      captured_at: 1778889600,
    });
  });

  it("surfaces Volcengine API errors", () => {
    expect(() => parseVolcengineBalanceResponse({
      ResponseMetadata: {
        Error: { Code: "RecordNoFound", Message: "The Record No Found." },
      },
    })).toThrow("RecordNoFound");
  });
});

describe("Volcengine billing product snapshots", () => {
  it("defaults to provider-cost product codes", () => {
    expect(parseVolcengineBillingProductCodes()).toEqual(["TTS-SeedTTS2.0", "ark_bd", "AI-SavingsPlans"]);
    expect(parseVolcengineBillingProductCodes(" ark_bd,TTS-SeedTTS2.0,ark_bd ")).toEqual([
      "ark_bd",
      "TTS-SeedTTS2.0",
    ]);
  });

  it("builds current and previous Shanghai billing month windows", () => {
    expect(billingProductWindows(1778928000).map((window) => window.billPeriod)).toEqual(["2026-05", "2026-04"]);
  });

  it("aggregates monthly provider product bills", () => {
    const [window] = billingProductWindows(1778928000, 1);
    const snapshots = parseVolcengineBillingProductResponse({
      Result: {
        Total: 4,
        List: [
          { BillPeriod: "2026-05", Product: "TTS-SeedTTS2.0", ProductZh: "Seed TTS", BillingMode: "2", PayableAmount: "0.36" },
          { BillPeriod: "2026-05", Product: "ark_bd", ProductZh: "Ark", BillingMode: "1", PayableAmount: "0.10" },
          { BillPeriod: "2026-05", Product: "ark_bd", ProductZh: "Ark", BillingMode: "2", PayableAmount: "0.20" },
          { BillPeriod: "2026-05", Product: "ECS", ProductZh: "Cloud Server", BillingMode: "1", PayableAmount: "12.00" },
        ],
      },
    }, window, ["TTS-SeedTTS2.0", "ark_bd"], 1778928000);

    expect(snapshots).toEqual([
      {
        bill_period: "2026-05",
        product: "TTS-SeedTTS2.0",
        product_zh: "Seed TTS",
        metric: "billing_tts_seedtts2_0_month_payable",
        value: 0.36,
        unit: "CNY",
        window_start: window.window_start,
        window_end: window.window_end,
        source: "ListBillOverviewByProd:2026-05:TTS-SeedTTS2.0",
        captured_at: 1778928000,
      },
      {
        bill_period: "2026-05",
        product: "ark_bd",
        product_zh: "Ark",
        metric: "billing_ark_bd_month_payable",
        value: 0.3,
        unit: "CNY",
        window_start: window.window_start,
        window_end: window.window_end,
        source: "ListBillOverviewByProd:2026-05:ark_bd",
        captured_at: 1778928000,
      },
    ]);
  });
});

describe("Volcengine speech monitoring helpers", () => {
  it("defaults to BigTTS and deduplicates configured resource IDs", () => {
    expect(parseVolcengineSpeechResourceIDs()).toEqual(["volc.service_type.10029"]);
    expect(parseVolcengineSpeechResourceIDs(" volc.service_type.10029,volc.tts.default,volc.tts.default ")).toEqual([
      "volc.service_type.10029",
      "volc.tts.default",
    ]);
  });

  it("normalizes UsageMonitoring rows into a seven-day BigTTS usage snapshot", () => {
    const window = speechMonitoringWindow(1778889600);
    const snapshot = parseVolcengineSpeechUsageResponse({
      code: 0,
      response: {
        status: "success",
        data: {
          usage_monitoring: [
            { date: "2026-05-14", value: "1200" },
            { date: "2026-05-15", value: 300 },
          ],
        },
      },
    }, "volc.service_type.10029", window, 1778889600);

    expect(snapshot).toEqual({
      resource_id: "volc.service_type.10029",
      metric: "speech_bigtts_usage_7d",
      value: 1500,
      unit: "text_words",
      window_start: window.window_start,
      window_end: window.window_end,
      captured_at: 1778889600,
    });
  });

  it("normalizes QuotaMonitoring rows into a concurrency headroom snapshot", () => {
    const snapshot = parseVolcengineSpeechQuotaResponse({
      code: 0,
      response: {
        status: "success",
        data: {
          quota_monitoring: [
            { time: "2026-05-15 10:00:00", value: 6, limit: 10 },
            { time: "2026-05-15 11:00:00", value: "8", limit: "10" },
          ],
        },
      },
    }, "volc.service_type.10029", 1778889600);

    expect(snapshot).toEqual({
      resource_id: "volc.service_type.10029",
      quota_type: "speech_bigtts_concurrency_peak",
      used: 8,
      limit_value: 10,
      remaining: 2,
      unit: "concurrency",
      captured_at: 1778889600,
    });
  });
});

describe("normalizeNiansTokenUsageRow", () => {
  it("normalizes Ark token usage sums and average per successful text attempt", () => {
    expect(normalizeNiansTokenUsageRow({
      attempts: 3,
      input_tokens: 300,
      output_tokens: 600,
      total_tokens: 900,
      reasoning_tokens: 45,
      cached_input_tokens: 30,
    })).toEqual({
      available: true,
      attempts: 3,
      input_tokens: 300,
      output_tokens: 600,
      total_tokens: 900,
      reasoning_tokens: 45,
      cached_input_tokens: 30,
      avg_total_tokens_per_attempt: 300,
      models: [],
    });
  });
});

describe("buildGrowthOverview", () => {
  it("derives revenue target, paid-user cost, and funnel targets from one monthly goal", () => {
    const growth = buildGrowthOverview({
      range: { start: 0, end: 30 * 86400 },
      assumptions: defaultGrowthAssumptions(),
      events: [
        { event_name: "app_launch", count: 1000, installs: 950 },
        { event_name: "first_story_completed", count: 520, installs: 500 },
        { event_name: "first_story_playback_completed", count: 330, installs: 320 },
        { event_name: "first_story_paywall_prompt_shown", count: 290, installs: 280 },
        { event_name: "paywall_viewed", count: 260, installs: 250 },
        { event_name: "paywall_plan_selected", count: 120, installs: 110 },
        { event_name: "purchase_started", count: 70, installs: 65 },
        { event_name: "purchase_succeeded", count: 32, installs: 30 },
      ],
      purchaseBreakdown: { total: 32, monthly: 24, yearly: 8 },
      activeSubscriptions: { total: 40, monthly: 30, yearly: 10, unknown: 0 },
    });

    expect(growth.target.monthly_revenue_cny).toBe(50000);
    expect(growth.target.period_revenue_cny).toBe(50000);
    expect(growth.target.required_paid_orders).toBe(807);
    expect(growth.target.required_active_payers).toBe(1946);
    expect(growth.costs.target_paid_ai_cost_cny).toBe(11676);
    expect(growth.revenue.estimated_period_sales_cny).toBe(2256);
    expect(growth.revenue.active_subscriber_mrr_cny).toBe(1005);
    expect(growth.funnel.steps.at(-1)?.actual_count).toBe(30);
    expect(growth.funnel.steps.at(-1)?.target_count).toBe(807);
    expect(growth.recommendations[0].title).toBe("Close the revenue gap first");
  });

  it("uses event count when distinct installs are unavailable", () => {
    const growth = buildGrowthOverview({
      range: { start: 0, end: 7 * 86400 },
      assumptions: defaultGrowthAssumptions(),
      events: [
        { event_name: "paywall_viewed", count: 12, installs: 0 },
        { event_name: "purchase_succeeded", count: 3, installs: 0 },
      ],
      purchaseBreakdown: { total: 3, monthly: 3, yearly: 0 },
      activeSubscriptions: { total: 3, monthly: 3, yearly: 0, unknown: 0 },
    });

    const paywall = growth.funnel.steps.find((step) => step.id === "paywall_viewed");
    const purchase = growth.funnel.steps.find((step) => step.id === "purchase_succeeded");
    expect(paywall?.actual_count).toBe(12);
    expect(purchase?.actual_count).toBe(3);
    expect(growth.target.period_revenue_cny).toBeCloseTo(11666.67, 2);
  });
});
