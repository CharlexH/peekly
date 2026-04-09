import type { Env } from "../types";

interface SiteRow {
  id: string;
  name: string;
  domain: string;
}

interface SummaryRow {
  pageviews: number;
  visitors: number;
  bounce_rate: number;
  avg_duration: number;
}

interface PageRow {
  path: string;
  views: number;
}

interface ReferrerRow {
  source: string;
  views: number;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export async function handleWeeklyReport(env: Env): Promise<void> {
  const reportEmail = env.REPORT_EMAIL;
  if (!reportEmail) {
    console.log("REPORT_EMAIL not set, skipping weekly report");
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const weekAgo = now - 7 * 86400;
  const twoWeeksAgo = now - 14 * 86400;

  const sites = await env.DB.prepare("SELECT id, name, domain FROM sites").all<SiteRow>();

  for (const site of sites.results) {
    const [current, previous, topPages, topRefs] = await env.DB.batch([
      env.DB.prepare(`
        SELECT COUNT(*) as pageviews, COUNT(DISTINCT visitor_hash) as visitors,
        ROUND(AVG(CASE WHEN is_bounce = 1 THEN 100.0 ELSE 0.0 END), 1) as bounce_rate,
        ROUND(AVG(CASE WHEN duration > 0 THEN duration ELSE NULL END), 0) as avg_duration
        FROM pageviews WHERE site_id = ? AND timestamp BETWEEN ? AND ?
      `).bind(site.id, weekAgo, now),
      env.DB.prepare(`
        SELECT COUNT(*) as pageviews, COUNT(DISTINCT visitor_hash) as visitors,
        ROUND(AVG(CASE WHEN is_bounce = 1 THEN 100.0 ELSE 0.0 END), 1) as bounce_rate,
        ROUND(AVG(CASE WHEN duration > 0 THEN duration ELSE NULL END), 0) as avg_duration
        FROM pageviews WHERE site_id = ? AND timestamp BETWEEN ? AND ?
      `).bind(site.id, twoWeeksAgo, weekAgo),
      env.DB.prepare(`
        SELECT path, COUNT(*) as views FROM pageviews
        WHERE site_id = ? AND timestamp BETWEEN ? AND ?
        GROUP BY path ORDER BY views DESC LIMIT 5
      `).bind(site.id, weekAgo, now),
      env.DB.prepare(`
        SELECT COALESCE(referrer, 'Direct') as source, COUNT(*) as views FROM pageviews
        WHERE site_id = ? AND timestamp BETWEEN ? AND ?
        GROUP BY referrer ORDER BY views DESC LIMIT 5
      `).bind(site.id, weekAgo, now),
    ]);

    const curr = current.results[0] as SummaryRow | undefined;
    const prev = previous.results[0] as SummaryRow | undefined;

    if (!curr || Number(curr.pageviews) === 0) continue;

    const delta = (c: number, p: number) => {
      if (p === 0) return c > 0 ? "+100%" : "—";
      const d = Math.round(((c - p) / p) * 100);
      return d > 0 ? `+${d}%` : `${d}%`;
    };

    const visitors = Number(curr.visitors);
    const pageviews = Number(curr.pageviews);
    const prevVisitors = Number(prev?.visitors ?? 0);
    const prevPageviews = Number(prev?.pageviews ?? 0);

    const pages = (topPages.results as PageRow[])
      .map(p => `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${escapeHtml(String(p.path))}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${Number(p.views).toLocaleString()}</td></tr>`)
      .join("");

    const refs = (topRefs.results as ReferrerRow[])
      .map(r => `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${escapeHtml(String(r.source))}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${Number(r.views).toLocaleString()}</td></tr>`)
      .join("");

    const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
  <h2 style="margin-bottom:4px">Peekly Weekly Report</h2>
  <p style="color:#888;font-size:14px;margin-bottom:24px">${escapeHtml(site.name)} (${escapeHtml(site.domain)})</p>

  <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
    <tr>
      <td style="padding:12px;background:#f8f8f8;border-radius:8px;text-align:center;width:25%">
        <div style="font-size:24px;font-weight:700">${visitors.toLocaleString()}</div>
        <div style="font-size:12px;color:#888">Visitors <span style="color:${visitors >= prevVisitors ? '#22c55e' : '#ef4444'}">${delta(visitors, prevVisitors)}</span></div>
      </td>
      <td style="width:8px"></td>
      <td style="padding:12px;background:#f8f8f8;border-radius:8px;text-align:center;width:25%">
        <div style="font-size:24px;font-weight:700">${pageviews.toLocaleString()}</div>
        <div style="font-size:12px;color:#888">Pageviews <span style="color:${pageviews >= prevPageviews ? '#22c55e' : '#ef4444'}">${delta(pageviews, prevPageviews)}</span></div>
      </td>
      <td style="width:8px"></td>
      <td style="padding:12px;background:#f8f8f8;border-radius:8px;text-align:center;width:25%">
        <div style="font-size:24px;font-weight:700">${curr.bounce_rate}%</div>
        <div style="font-size:12px;color:#888">Bounce Rate</div>
      </td>
      <td style="width:8px"></td>
      <td style="padding:12px;background:#f8f8f8;border-radius:8px;text-align:center;width:25%">
        <div style="font-size:24px;font-weight:700">${Math.round(Number(curr.avg_duration || 0))}s</div>
        <div style="font-size:12px;color:#888">Avg Duration</div>
      </td>
    </tr>
  </table>

  ${pages ? `
  <h3 style="font-size:14px;margin-bottom:8px">Top Pages</h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px">
    <tr><th style="padding:4px 8px;text-align:left;border-bottom:2px solid #ddd">Page</th><th style="padding:4px 8px;text-align:right;border-bottom:2px solid #ddd">Views</th></tr>
    ${pages}
  </table>` : ""}

  ${refs ? `
  <h3 style="font-size:14px;margin-bottom:8px">Top Sources</h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px">
    <tr><th style="padding:4px 8px;text-align:left;border-bottom:2px solid #ddd">Source</th><th style="padding:4px 8px;text-align:right;border-bottom:2px solid #ddd">Views</th></tr>
    ${refs}
  </table>` : ""}

  <p style="font-size:12px;color:#aaa;text-align:center;margin-top:32px">Sent by Peekly — Privacy-friendly analytics</p>
</body></html>`;

    // Send via MailChannels (free on CF Workers)
    try {
      const mailRes = await fetch("https://api.mailchannels.net/tx/v1/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: reportEmail }] }],
          from: { email: `analytics@${site.domain}`, name: "Peekly" },
          subject: `${site.name} — Weekly Report (${new Date().toISOString().slice(0, 10)})`,
          content: [{ type: "text/html", value: html }],
        }),
      });
      if (!mailRes.ok) {
        console.error(`MailChannels error for ${site.name}: ${mailRes.status} ${await mailRes.text()}`);
      }
    } catch (e) {
      console.error(`Failed to send report for ${site.name}:`, e);
    }
  }
}
