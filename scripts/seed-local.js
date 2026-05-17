#!/usr/bin/env node
/**
 * Seed local D1 with realistic demo data for charlex.me
 * Usage: node scripts/seed-local.js | npx wrangler d1 execute peekly --local --file=-
 * Or:    node scripts/seed-local.js > /tmp/seed.sql && npx wrangler d1 execute peekly --local --file=/tmp/seed.sql
 */

const SITE_ID = 'site_001';
const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;

// charlex.me page structure
const PAGES = [
  { path: '/', weight: 30 },
  { path: '/works/', weight: 25 },
  { path: '/works/lms/', weight: 8 },
  { path: '/works/chatbar', weight: 7 },
  { path: '/works/see-summit/', weight: 5 },
  { path: '/works/sales-ai/', weight: 4 },
  { path: '/works/amail-art/', weight: 3 },
  { path: '/works/youtube-summarier/', weight: 3 },
  { path: '/lab/', weight: 18 },
  { path: '/lab/tailorcraft/', weight: 6 },
  { path: '/lab/sideb/', weight: 4 },
  { path: '/about/', weight: 12 },
  { path: '/contact/', weight: 2 },
];

const REFERRERS = [
  { source: null, weight: 35 },               // Direct
  { source: 'google.com', weight: 20 },
  { source: 'linkedin.com', weight: 12 },
  { source: 'twitter.com', weight: 8 },
  { source: 'github.com', weight: 10 },
  { source: 'xiaohongshu.com', weight: 5 },
  { source: 'bing.com', weight: 3 },
  { source: 'producthunt.com', weight: 4 },
  { source: 'reddit.com', weight: 3 },
];

const BROWSERS = [
  { name: 'Chrome', weight: 45 },
  { name: 'Safari', weight: 25 },
  { name: 'Firefox', weight: 12 },
  { name: 'Edge', weight: 10 },
  { name: 'Arc', weight: 5 },
  { name: 'Brave', weight: 3 },
];

const OS_LIST = [
  { name: 'macOS', weight: 35 },
  { name: 'Windows', weight: 30 },
  { name: 'iOS', weight: 18 },
  { name: 'Android', weight: 12 },
  { name: 'Linux', weight: 5 },
];

const COUNTRIES = [
  { code: 'US', weight: 25 },
  { code: 'CN', weight: 20 },
  { code: 'DE', weight: 8 },
  { code: 'GB', weight: 7 },
  { code: 'JP', weight: 6 },
  { code: 'CA', weight: 5 },
  { code: 'FR', weight: 4 },
  { code: 'AU', weight: 4 },
  { code: 'KR', weight: 3 },
  { code: 'IN', weight: 3 },
  { code: 'SG', weight: 3 },
  { code: 'NL', weight: 2 },
  { code: 'BR', weight: 2 },
  { code: 'SE', weight: 2 },
  { code: 'TW', weight: 2 },
  { code: 'HK', weight: 2 },
  { code: 'IT', weight: 1 },
  { code: 'ES', weight: 1 },
];

const SCREEN_WIDTHS = [
  { w: 390, weight: 20 },   // iPhone
  { w: 414, weight: 10 },   // iPhone Plus
  { w: 768, weight: 8 },    // iPad
  { w: 1024, weight: 5 },   // iPad Pro
  { w: 1280, weight: 10 },  // Laptop
  { w: 1440, weight: 20 },  // Desktop
  { w: 1680, weight: 10 },  // Large desktop
  { w: 1920, weight: 12 },  // Full HD
  { w: 2560, weight: 5 },   // 2K
];

const UTM_SOURCES = [
  { source: 'linkedin', medium: 'social', campaign: 'portfolio-2026', weight: 8 },
  { source: 'twitter', medium: 'social', campaign: 'launch-post', weight: 5 },
  { source: 'google', medium: 'cpc', campaign: 'brand-search', weight: 4 },
  { source: 'xiaohongshu', medium: 'social', campaign: 'design-share', weight: 3 },
  { source: 'producthunt', medium: 'referral', campaign: 'launch-day', weight: 3 },
  { source: null, medium: null, campaign: null, weight: 77 }, // no UTM
];

function weightedRandom(items) {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

function randomId(len = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < len; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

function visitorHash() {
  return 'v_' + randomId(12);
}

function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

// Traffic pattern: more on weekdays, peak around day -5 to -2
function dailyMultiplier(daysAgo) {
  const dayOfWeek = new Date((NOW - daysAgo * DAY) * 1000).getDay();
  let mult = 1.0;
  // Weekend dip
  if (dayOfWeek === 0 || dayOfWeek === 6) mult *= 0.6;
  // Recency boost (more recent = more traffic, simulating growth)
  mult *= 0.5 + 0.5 * (1 - daysAgo / 30);
  // Random daily variance
  mult *= 0.7 + Math.random() * 0.6;
  // Spike on certain days (simulating social posts)
  if (daysAgo === 3 || daysAgo === 12 || daysAgo === 21) mult *= 2.2;
  return mult;
}

const sql = [];
sql.push('-- Auto-generated seed data for local development');
sql.push(`DELETE FROM events WHERE site_id = '${SITE_ID}';`);
sql.push(`DELETE FROM pageviews WHERE site_id = '${SITE_ID}';`);
sql.push(`DELETE FROM funnel_steps WHERE funnel_id IN (SELECT id FROM funnels WHERE site_id = '${SITE_ID}');`);
sql.push(`DELETE FROM funnels WHERE site_id = '${SITE_ID}';`);
sql.push('');

const eventRows = [];
let totalPV = 0;

// Generate 30 days of data
for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
  const dayStart = NOW - (daysAgo + 1) * DAY;
  const dayEnd = NOW - daysAgo * DAY;
  const baseVisitors = Math.round(25 * dailyMultiplier(daysAgo));
  const numVisitors = Math.max(5, baseVisitors);

  for (let v = 0; v < numVisitors; v++) {
    const vh = visitorHash();
    const country = weightedRandom(COUNTRIES);
    const browser = weightedRandom(BROWSERS);
    const os = weightedRandom(OS_LIST);
    const screen = weightedRandom(SCREEN_WIDTHS);
    const ref = weightedRandom(REFERRERS);
    const utm = weightedRandom(UTM_SOURCES);

    // Each visitor views 1-5 pages
    const numPages = 1 + Math.floor(Math.random() * Math.random() * 5);
    const sessionStart = dayStart + Math.floor(Math.random() * (dayEnd - dayStart - 300));

    // Visitor journey: start at homepage or landing page, then navigate deeper
    const journey = [];
    const startPage = numPages === 1 ? weightedRandom(PAGES) : PAGES[0]; // single page = random, multi = start at /
    journey.push(startPage);

    for (let p = 1; p < numPages; p++) {
      // Tendency to go deeper in the site
      const prev = journey[journey.length - 1];
      let next;
      if (prev.path === '/') {
        // From homepage, go to section pages
        const sections = PAGES.filter(pg => ['/', '/works/', '/lab/', '/about/'].includes(pg.path) && pg.path !== '/');
        next = weightedRandom(sections);
      } else if (prev.path === '/works/') {
        // From works listing, go to a project
        const projects = PAGES.filter(pg => pg.path.startsWith('/works/') && pg.path !== '/works/');
        next = weightedRandom(projects);
      } else if (prev.path === '/lab/') {
        const labs = PAGES.filter(pg => pg.path.startsWith('/lab/') && pg.path !== '/lab/');
        next = weightedRandom(labs);
      } else {
        next = weightedRandom(PAGES);
      }
      journey.push(next);
    }

    for (let p = 0; p < journey.length; p++) {
      const page = journey[p];
      const ts = sessionStart + p * (30 + Math.floor(Math.random() * 120));
      const duration = p < journey.length - 1 ? 15 + Math.floor(Math.random() * 180) : (Math.random() < 0.4 ? 0 : 10 + Math.floor(Math.random() * 60));
      const isBounce = journey.length === 1 ? 1 : 0;
      const pvId = randomId(16);

      sql.push(
        `INSERT INTO pageviews (id, site_id, path, referrer, country, browser, os, screen_width, visitor_hash, is_bounce, duration, utm_source, utm_medium, utm_campaign, timestamp) VALUES (${esc(pvId)}, ${esc(SITE_ID)}, ${esc(page.path)}, ${p === 0 ? esc(ref.source) : 'NULL'}, ${esc(country.code)}, ${esc(browser.name)}, ${esc(os.name)}, ${screen.w}, ${esc(vh)}, ${isBounce}, ${duration}, ${p === 0 ? esc(utm.source) : 'NULL'}, ${p === 0 ? esc(utm.medium) : 'NULL'}, ${p === 0 ? esc(utm.campaign) : 'NULL'}, ${ts});`
      );
      totalPV++;

      // Generate events for certain pages
      if (page.path === '/about/' && Math.random() < 0.3) {
        // Outbound click: resume
        eventRows.push(
          `INSERT INTO events (id, site_id, name, path, metadata, visitor_hash, timestamp) VALUES (${esc(randomId(16))}, ${esc(SITE_ID)}, 'outbound', '/about/', ${esc(JSON.stringify({ url: 'https://drive.google.com/resume-charlex', text: 'Get Full Resume' }))}, ${esc(vh)}, ${ts + 20});`
        );
      }
      if (page.path === '/about/' && Math.random() < 0.25) {
        // Outbound click: linkedin
        eventRows.push(
          `INSERT INTO events (id, site_id, name, path, metadata, visitor_hash, timestamp) VALUES (${esc(randomId(16))}, ${esc(SITE_ID)}, 'outbound', '/about/', ${esc(JSON.stringify({ url: 'https://linkedin.com/in/charlex', text: 'LinkedIn' }))}, ${esc(vh)}, ${ts + 15});`
        );
      }
      if (page.path.startsWith('/works/') && page.path !== '/works/' && Math.random() < 0.15) {
        // Project demo click
        eventRows.push(
          `INSERT INTO events (id, site_id, name, path, metadata, visitor_hash, timestamp) VALUES (${esc(randomId(16))}, ${esc(SITE_ID)}, 'outbound', ${esc(page.path)}, ${esc(JSON.stringify({ url: 'https://demo.' + page.path.split('/')[2] + '.com', text: 'Live Demo' }))}, ${esc(vh)}, ${ts + 25});`
        );
      }
      if (Math.random() < 0.05) {
        // Scroll depth event
        eventRows.push(
          `INSERT INTO events (id, site_id, name, path, metadata, visitor_hash, timestamp) VALUES (${esc(randomId(16))}, ${esc(SITE_ID)}, 'scroll_depth', ${esc(page.path)}, ${esc(JSON.stringify({ depth: [25, 50, 75, 100][Math.floor(Math.random() * 4)] }))}, ${esc(vh)}, ${ts + 30});`
        );
      }
    }
  }
}

// Add events
sql.push('');
sql.push('-- Events');
for (const e of eventRows) sql.push(e);

// Create funnels
sql.push('');
sql.push('-- Funnels');

const funnels = [
  {
    id: 'f_portfolio', name: 'Portfolio Depth',
    steps: [
      { name: 'Homepage', match_type: 'path', match_value: '/' },
      { name: 'Works Listing', match_type: 'path', match_value: '/works/' },
      { name: 'View Project', match_type: 'starts_with', match_value: '/works/' },
    ]
  },
  {
    id: 'f_lab', name: 'Lab Curiosity',
    steps: [
      { name: 'Homepage', match_type: 'path', match_value: '/' },
      { name: 'Lab Listing', match_type: 'path', match_value: '/lab/' },
      { name: 'Open Experiment', match_type: 'starts_with', match_value: '/lab/' },
    ]
  },
  {
    id: 'f_hiring', name: 'Hiring Intent',
    steps: [
      { name: 'Homepage', match_type: 'path', match_value: '/' },
      { name: 'About Page', match_type: 'path', match_value: '/about/' },
      { name: 'Download Resume', match_type: 'event_meta', match_value: 'outbound::url::resume' },
    ]
  },
  {
    id: 'f_linkedin', name: 'LinkedIn Reach',
    steps: [
      { name: 'About Page', match_type: 'path', match_value: '/about/' },
      { name: 'Click LinkedIn', match_type: 'event_meta', match_value: 'outbound::url::linkedin' },
    ]
  },
  {
    id: 'f_works2hire', name: 'Works to Contact',
    steps: [
      { name: 'View Any Project', match_type: 'starts_with', match_value: '/works/' },
      { name: 'About Page', match_type: 'path', match_value: '/about/' },
      { name: 'Download Resume', match_type: 'event_meta', match_value: 'outbound::url::resume' },
    ]
  },
];

for (const f of funnels) {
  sql.push(`INSERT INTO funnels (id, site_id, name, created_at) VALUES (${esc(f.id)}, ${esc(SITE_ID)}, ${esc(f.name)}, ${NOW});`);
  for (let i = 0; i < f.steps.length; i++) {
    const s = f.steps[i];
    sql.push(`INSERT INTO funnel_steps (id, funnel_id, step_order, name, match_type, match_value) VALUES (${esc('fs_' + randomId(8))}, ${esc(f.id)}, ${i}, ${esc(s.name)}, ${esc(s.match_type)}, ${esc(s.match_value)});`);
  }
}

console.log(sql.join('\n'));
console.error(`\nGenerated ${totalPV} pageviews, ${eventRows.length} events, ${funnels.length} funnels`);
