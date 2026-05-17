export type AppOpsSeverity = "critical" | "warning" | "info";

export const NIANS_MONTHLY_PRODUCT_ID = "com.charlex.nianstorybook.pro.monthly.v2";
export const NIANS_YEARLY_PRODUCT_ID = "com.charlex.nianstorybook.pro.yearly.v2";

export interface AppOpsAlert {
  severity: AppOpsSeverity;
  title: string;
  body: string;
}

export interface AppOpsHealthInput {
  environmentName: string;
  isProduction: boolean;
  burnCostDisabled: boolean | null;
  failedJobs: number;
  failedProviderAttempts: number;
  activeLeases: number;
  quotaRemaining: number | null;
  latestJobAt: string | null;
  accountBalanceCny?: number | null;
  providerSnapshotAgeSeconds?: number | null;
  speechConcurrencyUtilization?: number | null;
}

export interface GrowthAssumptions {
  monthlyRevenueTargetCny: number;
  monthlyPlanPriceCny: number;
  yearlyPlanPriceCny: number;
  yearlyOrderShare: number;
  appleCommissionRate: number;
  paidUserAiCostMonthlyCny: number;
  freeTrialCostPerRegisteredUserCny: number;
  targetRates: GrowthTargetRates;
}

export interface GrowthTargetRates {
  launchToFirstStory: number;
  firstStoryToPlayback: number;
  playbackToFirstPaywall: number;
  firstPaywallToPaywallView: number;
  paywallToPlanSelect: number;
  planSelectToPurchaseStart: number;
  purchaseStartToPurchase: number;
}

export interface GrowthEventRow {
  event_name: string;
  count: number;
  installs?: number | null;
}

export interface GrowthPurchaseBreakdown {
  total: number;
  monthly: number;
  yearly: number;
}

export interface GrowthSubscriptionCounts {
  total: number;
  monthly: number;
  yearly: number;
  unknown: number;
}

export interface BuildGrowthOverviewInput {
  range: { start: number; end: number };
  assumptions?: Partial<Omit<GrowthAssumptions, "targetRates">> & { targetRates?: Partial<GrowthTargetRates> };
  events: GrowthEventRow[];
  registeredUsers?: number | null;
  purchaseBreakdown?: GrowthPurchaseBreakdown;
  activeSubscriptions?: GrowthSubscriptionCounts;
}

export interface GrowthFunnelStep {
  id: string;
  label: string;
  event_name: string;
  actual_count: number;
  target_count: number;
  actual_rate: number | null;
  target_rate: number | null;
  rate_gap: number | null;
  count_gap: number;
  status: "ok" | "watch" | "missing";
}

export interface GrowthRecommendation {
  severity: AppOpsSeverity;
  title: string;
  body: string;
}

export function ratePercent(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function defaultGrowthAssumptions(): GrowthAssumptions {
  return {
    monthlyRevenueTargetCny: 50000,
    monthlyPlanPriceCny: 28,
    yearlyPlanPriceCny: 198,
    yearlyOrderShare: 0.2,
    appleCommissionRate: 0.15,
    paidUserAiCostMonthlyCny: 6,
    freeTrialCostPerRegisteredUserCny: 0.6,
    targetRates: {
      launchToFirstStory: 0.65,
      firstStoryToPlayback: 0.7,
      playbackToFirstPaywall: 0.85,
      firstPaywallToPaywallView: 0.95,
      paywallToPlanSelect: 0.35,
      planSelectToPurchaseStart: 0.75,
      purchaseStartToPurchase: 0.55,
    },
  };
}

export function buildGrowthOverview(input: BuildGrowthOverviewInput) {
  const assumptions = normalizeGrowthAssumptions(input.assumptions);
  const eventCounts = growthEventCounts(input.events);
  const purchaseBreakdown = normalizePurchaseBreakdown(input.purchaseBreakdown, eventCounts.purchase_succeeded);
  const activeSubscriptions = normalizeSubscriptionCounts(input.activeSubscriptions);
  const selectedDays = Math.max(1 / 24, (input.range.end - input.range.start) / 86400);
  const periodFactor = selectedDays / 30;
  const weightedOrderValue = weightedPlanValue(
    assumptions.monthlyPlanPriceCny,
    assumptions.yearlyPlanPriceCny,
    assumptions.yearlyOrderShare,
  );
  const weightedMonthlyArpu = weightedPlanValue(
    assumptions.monthlyPlanPriceCny,
    assumptions.yearlyPlanPriceCny / 12,
    assumptions.yearlyOrderShare,
  );
  const periodRevenueTarget = roundTwo(assumptions.monthlyRevenueTargetCny * periodFactor);
  const requiredPaidOrders = Math.ceil(periodRevenueTarget / weightedOrderValue);
  const requiredActivePayers = Math.ceil(assumptions.monthlyRevenueTargetCny / weightedMonthlyArpu);
  const estimatedSales = roundTwo(
    purchaseBreakdown.monthly * assumptions.monthlyPlanPriceCny
    + purchaseBreakdown.yearly * assumptions.yearlyPlanPriceCny
    + Math.max(0, purchaseBreakdown.total - purchaseBreakdown.monthly - purchaseBreakdown.yearly) * weightedOrderValue,
  );
  const activeSubscriberMrr = roundTwo(
    activeSubscriptions.monthly * assumptions.monthlyPlanPriceCny
    + activeSubscriptions.yearly * (assumptions.yearlyPlanPriceCny / 12)
    + activeSubscriptions.unknown * weightedMonthlyArpu,
  );
  const funnel = buildGrowthFunnel(eventCounts, requiredPaidOrders, assumptions);
  const targetRegisteredUsers = funnel.steps[0]?.target_count ?? 0;
  const targetPaidAiCost = roundTwo(requiredActivePayers * assumptions.paidUserAiCostMonthlyCny);
  const actualPaidAiCost = roundTwo(activeSubscriptions.total * assumptions.paidUserAiCostMonthlyCny);
  const targetFreeTrialCost = roundTwo(targetRegisteredUsers * assumptions.freeTrialCostPerRegisteredUserCny);
  const actualRegisteredUsers = nonNegativeNumber(input.registeredUsers, eventCounts.app_launch);
  const actualFreeTrialCost = roundTwo(actualRegisteredUsers * assumptions.freeTrialCostPerRegisteredUserCny);
  const targetAppleNet = roundTwo(periodRevenueTarget * (1 - assumptions.appleCommissionRate));
  const estimatedAppleNet = roundTwo(estimatedSales * (1 - assumptions.appleCommissionRate));
  const revenueGap = roundTwo(Math.max(0, periodRevenueTarget - estimatedSales));

  return {
    source: {
      sales: "app_ops_purchase_events",
      active_subscribers: "nians_d1_entitlements",
      asc_sales_reports: "not_configured",
    },
    assumptions,
    target: {
      monthly_revenue_cny: assumptions.monthlyRevenueTargetCny,
      period_revenue_cny: periodRevenueTarget,
      period_days: roundOne(selectedDays),
      weighted_order_value_cny: roundTwo(weightedOrderValue),
      weighted_monthly_arpu_cny: roundTwo(weightedMonthlyArpu),
      required_paid_orders: requiredPaidOrders,
      required_active_payers: requiredActivePayers,
      target_registered_users: targetRegisteredUsers,
      actual_registered_users: actualRegisteredUsers,
    },
    revenue: {
      estimated_period_sales_cny: estimatedSales,
      estimated_apple_net_cny: estimatedAppleNet,
      target_apple_net_cny: targetAppleNet,
      progress_percent: ratePercent(estimatedSales, periodRevenueTarget),
      gap_cny: revenueGap,
      active_subscriber_mrr_cny: activeSubscriberMrr,
      active_subscribers: activeSubscriptions,
      purchase_breakdown: purchaseBreakdown,
    },
    costs: {
      target_paid_ai_cost_cny: targetPaidAiCost,
      actual_paid_ai_cost_cny: actualPaidAiCost,
      target_free_trial_cost_cny: targetFreeTrialCost,
      actual_free_trial_cost_cny: actualFreeTrialCost,
      estimated_period_contribution_cny: roundTwo(estimatedAppleNet - actualPaidAiCost - actualFreeTrialCost),
      target_period_contribution_cny: roundTwo(targetAppleNet - targetPaidAiCost - targetFreeTrialCost),
    },
    funnel,
    paths: [
      {
        id: "first_story",
        label: "First-story prompt",
        event_name: "first_story_paywall_prompt_shown",
        count: eventCounts.first_story_paywall_prompt_shown,
        share_percent: ratePercent(eventCounts.first_story_paywall_prompt_shown, eventCounts.paywall_viewed),
      },
      {
        id: "quota_exhausted",
        label: "Quota-exhausted prompt",
        event_name: "quota_exhausted_paywall_shown",
        count: eventCounts.quota_exhausted_paywall_shown,
        share_percent: ratePercent(eventCounts.quota_exhausted_paywall_shown, eventCounts.paywall_viewed),
      },
    ],
    recommendations: growthRecommendations({
      revenueGap,
      progressPercent: ratePercent(estimatedSales, periodRevenueTarget),
      funnelSteps: funnel.steps,
      actualFreeTrialCost,
      estimatedSales,
    }),
  };
}

const growthFunnelDefinition: Array<{
  id: string;
  label: string;
  eventName: string;
  rateKey: keyof GrowthTargetRates | null;
}> = [
  { id: "app_launch", label: "App launches", eventName: "app_launch", rateKey: null },
  { id: "first_story_completed", label: "First story done", eventName: "first_story_completed", rateKey: "launchToFirstStory" },
  { id: "first_playback_completed", label: "First playback done", eventName: "first_story_playback_completed", rateKey: "firstStoryToPlayback" },
  { id: "first_paywall_prompt", label: "First-story CTA shown", eventName: "first_story_paywall_prompt_shown", rateKey: "playbackToFirstPaywall" },
  { id: "paywall_viewed", label: "Paywall viewed", eventName: "paywall_viewed", rateKey: "firstPaywallToPaywallView" },
  { id: "plan_selected", label: "Plan selected", eventName: "paywall_plan_selected", rateKey: "paywallToPlanSelect" },
  { id: "purchase_started", label: "Purchase started", eventName: "purchase_started", rateKey: "planSelectToPurchaseStart" },
  { id: "purchase_succeeded", label: "Purchase success", eventName: "purchase_succeeded", rateKey: "purchaseStartToPurchase" },
];

function normalizeGrowthAssumptions(
  input?: Partial<Omit<GrowthAssumptions, "targetRates">> & { targetRates?: Partial<GrowthTargetRates> },
): GrowthAssumptions {
  const defaults = defaultGrowthAssumptions();
  const targetRates = input?.targetRates as Partial<GrowthTargetRates> | undefined;
  return {
    monthlyRevenueTargetCny: positiveNumber(input?.monthlyRevenueTargetCny, defaults.monthlyRevenueTargetCny),
    monthlyPlanPriceCny: positiveNumber(input?.monthlyPlanPriceCny, defaults.monthlyPlanPriceCny),
    yearlyPlanPriceCny: positiveNumber(input?.yearlyPlanPriceCny, defaults.yearlyPlanPriceCny),
    yearlyOrderShare: boundedRate(input?.yearlyOrderShare, defaults.yearlyOrderShare),
    appleCommissionRate: boundedRate(input?.appleCommissionRate, defaults.appleCommissionRate),
    paidUserAiCostMonthlyCny: nonNegativeNumber(input?.paidUserAiCostMonthlyCny, defaults.paidUserAiCostMonthlyCny),
    freeTrialCostPerRegisteredUserCny: nonNegativeNumber(input?.freeTrialCostPerRegisteredUserCny, defaults.freeTrialCostPerRegisteredUserCny),
    targetRates: {
      launchToFirstStory: boundedRate(targetRates?.launchToFirstStory, defaults.targetRates.launchToFirstStory),
      firstStoryToPlayback: boundedRate(targetRates?.firstStoryToPlayback, defaults.targetRates.firstStoryToPlayback),
      playbackToFirstPaywall: boundedRate(targetRates?.playbackToFirstPaywall, defaults.targetRates.playbackToFirstPaywall),
      firstPaywallToPaywallView: boundedRate(targetRates?.firstPaywallToPaywallView, defaults.targetRates.firstPaywallToPaywallView),
      paywallToPlanSelect: boundedRate(targetRates?.paywallToPlanSelect, defaults.targetRates.paywallToPlanSelect),
      planSelectToPurchaseStart: boundedRate(targetRates?.planSelectToPurchaseStart, defaults.targetRates.planSelectToPurchaseStart),
      purchaseStartToPurchase: boundedRate(targetRates?.purchaseStartToPurchase, defaults.targetRates.purchaseStartToPurchase),
    },
  };
}

function growthEventCounts(rows: GrowthEventRow[]) {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const actorCount = nonNegativeNumber(row.installs, 0) > 0
      ? nonNegativeNumber(row.installs, 0)
      : nonNegativeNumber(row.count, 0);
    counts[row.event_name] = (counts[row.event_name] ?? 0) + actorCount;
  }

  return {
    app_launch: counts.app_launch ?? 0,
    first_story_completed: counts.first_story_completed ?? 0,
    first_story_playback_completed: counts.first_story_playback_completed ?? 0,
    first_story_paywall_prompt_shown: counts.first_story_paywall_prompt_shown ?? 0,
    quota_exhausted_paywall_shown: counts.quota_exhausted_paywall_shown ?? 0,
    paywall_viewed: counts.paywall_viewed ?? 0,
    paywall_plan_selected: counts.paywall_plan_selected ?? 0,
    purchase_started: counts.purchase_started ?? 0,
    purchase_succeeded: counts.purchase_succeeded ?? 0,
  };
}

function normalizePurchaseBreakdown(
  breakdown: GrowthPurchaseBreakdown | undefined,
  fallbackPurchases: number,
): GrowthPurchaseBreakdown {
  const monthly = nonNegativeNumber(breakdown?.monthly, 0);
  const yearly = nonNegativeNumber(breakdown?.yearly, 0);
  const explicitTotal = nonNegativeNumber(breakdown?.total, 0);
  return {
    monthly,
    yearly,
    total: Math.max(explicitTotal, monthly + yearly, fallbackPurchases),
  };
}

function normalizeSubscriptionCounts(counts?: GrowthSubscriptionCounts): GrowthSubscriptionCounts {
  const monthly = nonNegativeNumber(counts?.monthly, 0);
  const yearly = nonNegativeNumber(counts?.yearly, 0);
  const unknown = nonNegativeNumber(counts?.unknown, 0);
  return {
    monthly,
    yearly,
    unknown,
    total: Math.max(nonNegativeNumber(counts?.total, 0), monthly + yearly + unknown),
  };
}

function buildGrowthFunnel(
  eventCounts: ReturnType<typeof growthEventCounts>,
  requiredPaidOrders: number,
  assumptions: GrowthAssumptions,
) {
  const targetCounts = new Array(growthFunnelDefinition.length).fill(0);
  targetCounts[targetCounts.length - 1] = requiredPaidOrders;

  for (let i = growthFunnelDefinition.length - 2; i >= 0; i--) {
    const nextRateKey = growthFunnelDefinition[i + 1].rateKey;
    const nextRate = nextRateKey ? assumptions.targetRates[nextRateKey] : 1;
    targetCounts[i] = Math.ceil(targetCounts[i + 1] / Math.max(nextRate, 0.01));
  }

  const steps: GrowthFunnelStep[] = growthFunnelDefinition.map((step, index) => {
    const actualCount = eventCounts[step.eventName as keyof typeof eventCounts] ?? 0;
    const previousActual = index > 0
      ? eventCounts[growthFunnelDefinition[index - 1].eventName as keyof typeof eventCounts] ?? 0
      : null;
    const actualRate = previousActual == null ? null : ratePercent(actualCount, previousActual);
    const targetRate = step.rateKey ? roundOne(assumptions.targetRates[step.rateKey] * 100) : null;
    const rateGap = actualRate == null || targetRate == null ? null : roundOne(targetRate - actualRate);
    const targetCount = targetCounts[index];
    const countGap = Math.max(0, targetCount - actualCount);
    const status = actualCount === 0 && targetCount > 0
      ? "missing"
      : (countGap > targetCount * 0.25 || (rateGap != null && rateGap > targetRate! * 0.15))
        ? "watch"
        : "ok";

    return {
      id: step.id,
      label: step.label,
      event_name: step.eventName,
      actual_count: actualCount,
      target_count: targetCount,
      actual_rate: actualRate,
      target_rate: targetRate,
      rate_gap: rateGap,
      count_gap: countGap,
      status,
    };
  });

  return {
    overall_conversion_percent: ratePercent(
      steps[steps.length - 1]?.actual_count ?? 0,
      steps[0]?.actual_count ?? 0,
    ),
    target_overall_conversion_percent: roundOne(
      Object.values(assumptions.targetRates).reduce((product, rate) => product * rate, 1) * 100,
    ),
    bottleneck: steps
      .filter((step) => step.rate_gap != null)
      .sort((a, b) => (b.rate_gap ?? 0) - (a.rate_gap ?? 0))[0] ?? null,
    steps,
  };
}

function growthRecommendations(input: {
  revenueGap: number;
  progressPercent: number;
  funnelSteps: GrowthFunnelStep[];
  actualFreeTrialCost: number;
  estimatedSales: number;
}): GrowthRecommendation[] {
  const recommendations: GrowthRecommendation[] = [];

  if (input.revenueGap > 0) {
    recommendations.push({
      severity: input.progressPercent < 50 ? "critical" : "warning",
      title: "Close the revenue gap first",
      body: `Current estimated sales are ${input.progressPercent.toFixed(1)}% of the selected-window target. The remaining gap is ${input.revenueGap.toLocaleString()} CNY.`,
    });
  }

  const bottleneck = input.funnelSteps
    .filter((step) => step.rate_gap != null && step.rate_gap > 0)
    .sort((a, b) => (b.rate_gap ?? 0) - (a.rate_gap ?? 0))[0];

  if (bottleneck) {
    recommendations.push({
      severity: bottleneck.status === "missing" ? "critical" : "warning",
      title: `Improve ${bottleneck.label}`,
      body: `Actual conversion is ${bottleneck.actual_rate?.toFixed(1) ?? "0.0"}% vs target ${bottleneck.target_rate?.toFixed(1)}%. Prioritize this step before adding more acquisition.`,
    });
  }

  if (input.actualFreeTrialCost > 0 && input.estimatedSales === 0) {
    recommendations.push({
      severity: "warning",
      title: "Free-trial spend has no payback yet",
      body: `${input.actualFreeTrialCost.toLocaleString()} CNY estimated trial cost is visible before purchase revenue. Keep the daily free-trial cap tight while testing traffic quality.`,
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      severity: "info",
      title: "Keep monitoring the funnel",
      body: "Revenue, conversion, and cost are inside the configured targets for this window.",
    });
  }

  return recommendations.slice(0, 4);
}

function weightedPlanValue(monthlyValue: number, yearlyValue: number, yearlyShare: number): number {
  return monthlyValue * (1 - yearlyShare) + yearlyValue * yearlyShare;
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function positiveNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function boundedRate(value: unknown, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(1, Math.max(0.01, number));
}

export function remainingQuota(limit: number | null, used: number | null, reserved: number | null): number | null {
  if (limit == null) return null;
  return Math.max(0, Number(limit) - Number(used ?? 0) - Number(reserved ?? 0));
}

export function deriveAppOpsAlerts(input: AppOpsHealthInput): AppOpsAlert[] {
  const alerts: AppOpsAlert[] = [];

  if (!input.isProduction && input.burnCostDisabled === false) {
    alerts.push({
      severity: "warning",
      title: "Sandbox provider spend is enabled",
      body: "Real Ark/TTS calls can run in this environment. Keep this open only during active QA.",
    });
  }

  if (input.isProduction && input.burnCostDisabled === true) {
    alerts.push({
      severity: "info",
      title: "Production provider spend is disabled",
      body: "Public generation is protected by the cost gate. Open it only for a controlled production rollout.",
    });
  }

  if (input.failedJobs > 0) {
    alerts.push({
      severity: "critical",
      title: "Generation jobs failed",
      body: `${input.failedJobs} generation job${input.failedJobs === 1 ? "" : "s"} failed in the selected window.`,
    });
  }

  if (input.failedProviderAttempts > 0) {
    alerts.push({
      severity: "warning",
      title: "Provider attempts failed",
      body: `${input.failedProviderAttempts} Ark/TTS provider attempt${input.failedProviderAttempts === 1 ? "" : "s"} failed in the selected window.`,
    });
  }

  if (input.activeLeases > 0) {
    alerts.push({
      severity: "info",
      title: "TTS leases are active",
      body: `${input.activeLeases} TTS lease${input.activeLeases === 1 ? "" : "s"} are currently holding provider slots.`,
    });
  }

  if (input.quotaRemaining != null && input.quotaRemaining <= 2) {
    alerts.push({
      severity: "warning",
      title: "App quota is nearly exhausted",
      body: `${input.quotaRemaining} generation credit${input.quotaRemaining === 1 ? "" : "s"} remain after used and reserved quota.`,
    });
  }

  if (input.accountBalanceCny == null) {
    alerts.push({
      severity: "warning",
      title: "Volcengine balance signal is missing",
      body: "The dashboard cannot confirm the current recharge risk until the account-balance snapshot succeeds.",
    });
  } else if (input.providerSnapshotAgeSeconds != null && input.providerSnapshotAgeSeconds > 30 * 60) {
    alerts.push({
      severity: "warning",
      title: "Volcengine balance signal is stale",
      body: "The latest account-balance snapshot is older than 30 minutes. Check the cron job or Volcengine billing API before active traffic.",
    });
  }

  if (input.accountBalanceCny != null && input.accountBalanceCny <= 10) {
    alerts.push({
      severity: "critical",
      title: "Volcengine balance is critically low",
      body: `Available Volcengine account balance is ${input.accountBalanceCny.toFixed(2)} CNY. Recharge before running paid generation traffic.`,
    });
  } else if (input.accountBalanceCny != null && input.accountBalanceCny <= 50) {
    alerts.push({
      severity: "warning",
      title: "Volcengine balance is low",
      body: `Available Volcengine account balance is ${input.accountBalanceCny.toFixed(2)} CNY. Plan a recharge before active QA or launch traffic.`,
    });
  }

  if (input.speechConcurrencyUtilization != null && input.speechConcurrencyUtilization >= 100) {
    alerts.push({
      severity: "critical",
      title: "Volcengine TTS concurrency is exhausted",
      body: "The latest speech quota snapshot reached the configured provider concurrency limit. Generation audio may queue or fail.",
    });
  } else if (input.speechConcurrencyUtilization != null && input.speechConcurrencyUtilization >= 80) {
    alerts.push({
      severity: "warning",
      title: "Volcengine TTS concurrency is near limit",
      body: `The latest speech quota snapshot reached ${input.speechConcurrencyUtilization.toFixed(1)}% of the provider limit.`,
    });
  }

  if (!input.latestJobAt) {
    alerts.push({
      severity: "info",
      title: "No generation traffic in this window",
      body: `No generation jobs were found for ${input.environmentName} in the selected period.`,
    });
  }

  return alerts;
}

export function severityScore(severity: AppOpsSeverity): number {
  switch (severity) {
    case "critical":
      return 3;
    case "warning":
      return 2;
    default:
      return 1;
  }
}
