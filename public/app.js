function app() {
  return {
    // Auth
    token: localStorage.getItem('pk_token') || '',
    password: '',
    loggingIn: false,
    loginError: '',

    // Data
    sites: [],
    selectedSite: '',
    period: '30d',
    summary: { visitors: 0, pageviews: 0, bounce_rate: 0, avg_duration: 0, sparkline: [], compare: {} },
    timeseries: [],
    pages: [],
    referrers: [],
    countries: [],
    browsers: [],
    osData: [],
    devices: [],
    entryPages: [],
    exitPages: [],
    utmSources: [],
    utmCampaigns: [],
    funnels: [],
    realtimeCount: 0,

    // UI
    showSiteModal: false,
    newSiteName: '',
    newSiteDomain: '',
    newSiteSnippet: '',
    chart: null,
    theme: localStorage.getItem('pk_theme') || 'dark',
    currentShareToken: null,
    showFunnelModal: false,
    newFunnelName: '',
    newFunnelSteps: [
      { name: '', match_type: 'path', match_value: '' },
      { name: '', match_type: 'path', match_value: '' },
    ],

    // Globe state
    _globe: null,

    async init() {
      document.documentElement.setAttribute('data-theme', this.theme);
      if (this.token) {
        await this.fetchSites();
        if (this.sites.length > 0) {
          this.selectedSite = this.sites[0].id;
          await this.fetchAll();
        }
        this.startRealtime();
        // Delay globe init to ensure DOM is fully rendered after Alpine template switch
        setTimeout(() => this.initGlobe(), 300);
      }
    },

    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', this.theme);
      localStorage.setItem('pk_theme', this.theme);
      this.$nextTick(() => {
        this.renderChart();
        this.renderSparklines();
      });
    },

    async login() {
      this.loggingIn = true;
      this.loginError = '';
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: this.password }),
        });
        const data = await res.json();
        if (!res.ok) {
          this.loginError = data.error || 'Login failed';
          return;
        }
        this.token = data.token;
        localStorage.setItem('pk_token', data.token);
        this.password = '';
        await this.init();
      } catch (e) {
        this.loginError = 'Connection error';
      } finally {
        this.loggingIn = false;
      }
    },

    logout() {
      this.token = '';
      localStorage.removeItem('pk_token');
      this.destroyGlobe();
    },

    headers() {
      return {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      };
    },

    async api(path) {
      const sep = path.includes('?') ? '&' : '?';
      const url = `${path}${sep}site_id=${this.selectedSite}&period=${this.period}`;
      const res = await fetch(url, { headers: this.headers() });
      if (res.status === 401) {
        this.logout();
        return null;
      }
      return res.json();
    },

    async fetchSites() {
      try {
        const res = await fetch('/api/sites', { headers: this.headers() });
        if (res.status === 401) { this.logout(); return; }
        const data = await res.json();
        this.sites = data.sites || [];
        this.updateShareToken();
      } catch (e) {
        console.error('Failed to fetch sites:', e);
      }
    },

    updateShareToken() {
      const site = this.sites.find(s => s.id === this.selectedSite);
      this.currentShareToken = site?.share_token || null;
    },

    get shareUrl() {
      if (!this.currentShareToken) return '';
      return window.location.origin + '/shared/' + this.currentShareToken;
    },

    async toggleShare() {
      if (!this.selectedSite) return;
      if (this.currentShareToken) {
        await fetch(`/api/sites/${this.selectedSite}/share`, { method: 'DELETE', headers: this.headers() });
        const site = this.sites.find(s => s.id === this.selectedSite);
        if (site) site.share_token = null;
      } else {
        const res = await fetch(`/api/sites/${this.selectedSite}/share`, { method: 'POST', headers: this.headers() });
        const data = await res.json();
        const site = this.sites.find(s => s.id === this.selectedSite);
        if (site) site.share_token = data.share_token;
      }
      this.updateShareToken();
    },

    async copyShare() {
      try {
        await navigator.clipboard.writeText(this.shareUrl);
      } catch (e) {}
    },

    async fetchFunnels() {
      if (!this.selectedSite) return;
      const data = await this.api('/api/funnels');
      if (!data || !data.funnels) return;
      const analyzed = await Promise.all(
        data.funnels.map(async (f) => {
          const res = await this.api(`/api/funnels/${f.id}/analyze`);
          return { ...f, steps: res?.steps || [], overall: res?.overall || 0 };
        })
      );
      // Inject demo data on localhost so charts are visible
      if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        const demoProfiles = [
          [{ visitors: 86, conversion: 100 }, { visitors: 52, conversion: 60 }, { visitors: 31, conversion: 60 }],
          [{ visitors: 86, conversion: 100 }, { visitors: 38, conversion: 44 }, { visitors: 14, conversion: 37 }],
          [{ visitors: 86, conversion: 100 }, { visitors: 26, conversion: 30 }, { visitors: 5, conversion: 19 }],
          [{ visitors: 26, conversion: 100 }, { visitors: 8, conversion: 31 }],
          [{ visitors: 31, conversion: 100 }, { visitors: 11, conversion: 35 }, { visitors: 3, conversion: 27 }],
        ];
        for (let i = 0; i < analyzed.length; i++) {
          const profile = demoProfiles[i % demoProfiles.length];
          if (analyzed[i].steps.length > 0 && analyzed[i].steps.every(s => s.visitors === 0)) {
            for (let j = 0; j < analyzed[i].steps.length && j < profile.length; j++) {
              analyzed[i].steps[j].visitors = profile[j].visitors;
              analyzed[i].steps[j].conversion = profile[j].conversion;
            }
            const first = analyzed[i].steps[0].visitors;
            const last = analyzed[i].steps[analyzed[i].steps.length - 1].visitors;
            analyzed[i].overall = first > 0 ? Math.round((last / first) * 100) : 0;
          }
        }
      }
      this.funnels = analyzed;
      this.$nextTick(() => this.renderFunnels());
    },

    renderFunnels() {
      const canvases = document.querySelectorAll('.funnel-canvas');
      canvases.forEach((canvas) => {
        const idx = parseInt(canvas.dataset.funnelIdx);
        const funnel = this.funnels[idx];
        if (!funnel || !funnel.steps.length) return;
        this.drawFunnel(canvas, funnel);
      });
    },

    drawFunnel(canvas, funnel) {
      const wrap = canvas.parentElement;
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      const steps = funnel.steps;
      const n = steps.length;
      if (n === 0) return;

      // Green palette: decreasing opacity — 1.0, 0.8, 0.6, 0.4, 0.2
      const opacities = [];
      for (let i = 0; i < n; i++) {
        opacities.push(Math.max(0.15, 1.0 - i * 0.2));
      }

      // Layout: funnel area on left, conversion % column on right
      const pctColW = 44;
      const padX = 8;
      const padTop = 6;
      const padBottom = 6;
      const gap = 4;
      const funnelW = w - padX * 2 - pctColW;
      const availH = h - padTop - padBottom;
      const bandH = (availH - gap * (n - 1)) / n;
      const maxV = steps[0].visitors || 1;
      const r = 6; // corner radius

      // Widths as ratio to first step
      const widths = steps.map((s) => {
        const ratio = maxV > 0 ? s.visitors / maxV : 0;
        return Math.max(0.10, ratio);
      });
      const tipRatio = widths[n - 1] * 0.2;

      // Center X of the funnel area
      const cx = padX + funnelW / 2;

      for (let i = 0; i < n; i++) {
        const topW = funnelW * widths[i];
        const bottomW = (i < n - 1) ? funnelW * widths[i + 1] : funnelW * tipRatio;
        const topY = padTop + i * (bandH + gap);
        const bottomY = topY + bandH;

        // Draw trapezoid (sharp corners)
        ctx.beginPath();
        ctx.moveTo(cx - topW / 2, topY);
        ctx.lineTo(cx + topW / 2, topY);
        ctx.lineTo(cx + bottomW / 2, bottomY);
        ctx.lineTo(cx - bottomW / 2, bottomY);
        ctx.closePath();
        ctx.fillStyle = 'rgba(184, 238, 65, ' + opacities[i] + ')';
        ctx.fill();

        // White text label centered on band
        const textY = topY + bandH / 2;
        ctx.save();
        ctx.font = '600 11px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        const label = steps[i].name;
        const count = this.fmt(steps[i].visitors);
        ctx.fillText(label + '  ·  ' + count, cx, textY);
        ctx.restore();

        // Right column: conversion percentage
        ctx.save();
        ctx.font = '600 11px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        if (i === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.3)';
          ctx.fillText('100%', w - padX, textY);
        } else {
          ctx.fillStyle = steps[i].conversion < 50 ? 'rgba(239,68,68,0.85)' : 'rgba(255,255,255,0.45)';
          ctx.fillText(steps[i].conversion + '%', w - padX, textY);
        }
        ctx.restore();
      }
    },


    async createFunnel() {
      const valid = this.newFunnelName && this.newFunnelSteps.every(s => s.name && s.match_value);
      if (!valid) return;
      await fetch('/api/funnels', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          site_id: this.selectedSite,
          name: this.newFunnelName,
          steps: this.newFunnelSteps,
        }),
      });
      this.showFunnelModal = false;
      this.newFunnelName = '';
      this.newFunnelSteps = [
        { name: '', match_type: 'path', match_value: '' },
        { name: '', match_type: 'path', match_value: '' },
      ];
      await this.fetchFunnels();
    },

    async deleteFunnel(id) {
      await fetch(`/api/funnels/${id}`, { method: 'DELETE', headers: this.headers() });
      this.funnels = this.funnels.filter(f => f.id !== id);
      this.$nextTick(() => this.renderFunnels());
    },

    async fetchAll() {
      if (!this.selectedSite) return;
      this.updateShareToken();
      const [summary, timeseries, pages, referrers, countries, devices, entry, exit, utm] = await Promise.all([
        this.api('/api/stats/summary'),
        this.api('/api/stats/timeseries'),
        this.api('/api/stats/pages'),
        this.api('/api/stats/referrers'),
        this.api('/api/stats/countries'),
        this.api('/api/stats/devices'),
        this.api('/api/stats/entry-pages'),
        this.api('/api/stats/exit-pages'),
        this.api('/api/stats/utm'),
      ]);

      if (summary) {
        this.summary = summary;
        this.$nextTick(() => this.renderSparklines());
      }
      if (timeseries) {
        this.timeseries = timeseries.data || [];
        this.$nextTick(() => this.renderChart());
      }
      if (pages) this.pages = pages.pages || [];
      if (referrers) this.referrers = referrers.referrers || [];
      if (countries) {
        this.countries = countries.countries || [];
        // Demo data for local development only
        if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
          const demo = [
            { country: 'US', visitors: 320 },
            { country: 'CN', visitors: 180 },
            { country: 'DE', visitors: 95 },
            { country: 'JP', visitors: 75 },
            { country: 'GB', visitors: 60 },
            { country: 'BR', visitors: 55 },
            { country: 'FR', visitors: 50 },
            { country: 'IN', visitors: 45 },
            { country: 'CA', visitors: 40 },
            { country: 'AU', visitors: 35 },
            { country: 'KR', visitors: 30 },
            { country: 'RU', visitors: 28 },
            { country: 'MX', visitors: 22 },
            { country: 'IT', visitors: 20 },
            { country: 'ES', visitors: 18 },
            { country: 'NL', visitors: 15 },
            { country: 'SE', visitors: 12 },
            { country: 'TR', visitors: 10 },
            { country: 'AR', visitors: 8 },
            { country: 'ZA', visitors: 6 },
            { country: 'NG', visitors: 5 },
            { country: 'TH', visitors: 4 },
            { country: 'EG', visitors: 3 },
          ];
          // Merge: keep real data, add demo for countries not already present
          const existing = new Set(this.countries.map(c => c.country));
          for (const d of demo) {
            if (!existing.has(d.country)) this.countries.push(d);
          }
        }
        this.updateGlobeCountries(this.countries);
      }
      if (devices) {
        this.browsers = devices.browsers || [];
        this.osData = devices.os || [];
        this.devices = devices.devices || [];
      }
      if (entry) this.entryPages = entry.entry_pages || [];
      if (exit) this.exitPages = exit.exit_pages || [];
      if (utm) {
        this.utmSources = utm.sources || [];
        this.utmCampaigns = utm.campaigns || [];
      }
      await this.fetchFunnels();
    },

    startRealtime() {
      const poll = async () => {
        if (!this.token || !this.selectedSite) return;
        try {
          const data = await this.api('/api/stats/realtime');
          if (data) {
            this.realtimeCount = data.active_visitors || 0;
            this.updateGlobeRealtime(data);
          }
        } catch (e) {}
      };
      poll();
      setInterval(poll, 15000);
    },

    async addSite() {
      try {
        const res = await fetch('/api/sites', {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ name: this.newSiteName, domain: this.newSiteDomain }),
        });
        const data = await res.json();
        if (data.site) {
          this.sites = [...this.sites, data.site];
          this.selectedSite = data.site.id;
          const origin = window.location.origin;
          this.newSiteSnippet = `<script defer data-site="${data.site.tracking_id}" src="${origin}/tracker.js"><\/script>`;
          this.newSiteName = '';
          this.newSiteDomain = '';
          await this.fetchAll();
        }
      } catch (e) {
        console.error('Failed to add site:', e);
      }
    },

    cssVar(name) {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    },

    // Sparkline rendering
    renderSparklines() {
      const sparkline = this.summary.sparkline || [];
      if (sparkline.length < 2) return;
      this.drawSparkline(this.$refs.sparkVisitors, sparkline.map(s => s.visitors));
      this.drawSparkline(this.$refs.sparkPageviews, sparkline.map(s => s.pageviews));
    },

    drawSparkline(canvas, values) {
      if (!canvas || values.length < 2) return;
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      const w = rect.width;
      const h = rect.height;
      const max = Math.max(...values, 1);
      const pad = 2;

      ctx.clearRect(0, 0, w, h);

      // Fill
      ctx.beginPath();
      for (let i = 0; i < values.length; i++) {
        const x = pad + (i / (values.length - 1)) * (w - pad * 2);
        const y = pad + (h - pad * 2) - (values[i] / max) * (h - pad * 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(pad + (w - pad * 2), h - pad);
      ctx.lineTo(pad, h - pad);
      ctx.closePath();
      ctx.fillStyle = this.cssVar('--sparkline-fill');
      ctx.fill();

      // Line
      ctx.beginPath();
      for (let i = 0; i < values.length; i++) {
        const x = pad + (i / (values.length - 1)) * (w - pad * 2);
        const y = pad + (h - pad * 2) - (values[i] / max) * (h - pad * 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = this.cssVar('--sparkline');
      ctx.lineWidth = 1.5;
      ctx.stroke();
    },

    // Chart rendering
    renderChart() {
      const canvas = this.$refs.chart;
      if (!canvas || this.timeseries.length === 0) return;

      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      const w = rect.width;
      const h = rect.height;
      const pad = { top: 8, right: 8, bottom: 20, left: 32 };
      const plotW = w - pad.left - pad.right;
      const plotH = h - pad.top - pad.bottom;

      const data = this.timeseries;
      const maxVal = Math.max(...data.map(d => d.visitors), 1);

      const gridColor = this.cssVar('--chart-grid');
      const labelColor = this.cssVar('--chart-label');
      const accentColor = this.cssVar('--sparkline');
      const fillColor = this.cssVar('--sparkline-fill');

      ctx.clearRect(0, 0, w, h);

      // Grid lines
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      for (let i = 0; i <= 3; i++) {
        const y = pad.top + (plotH * i / 3);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(w - pad.right, y);
        ctx.stroke();

        ctx.fillStyle = labelColor;
        ctx.font = '9px -apple-system, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(maxVal * (1 - i / 3)).toString(), pad.left - 4, y + 3);
      }

      if (data.length < 2) return;

      // Fill
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = pad.left + (i / (data.length - 1)) * plotW;
        const y = pad.top + plotH - (data[i].visitors / maxVal) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(pad.left + plotW, pad.top + plotH);
      ctx.lineTo(pad.left, pad.top + plotH);
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();

      // Line
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = pad.left + (i / (data.length - 1)) * plotW;
        const y = pad.top + plotH - (data[i].visitors / maxVal) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // X labels
      ctx.fillStyle = labelColor;
      ctx.font = '9px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      const labelIndices = [0, Math.floor(data.length / 2), data.length - 1];
      for (const i of labelIndices) {
        const x = pad.left + (i / (data.length - 1)) * plotW;
        const d = new Date(data[i].timestamp * 1000);
        const label = `${d.getMonth() + 1}/${d.getDate()}`;
        ctx.fillText(label, x, h - 4);
      }
    },

    // ============================
    // 3D GLOBE (Three.js)
    // ============================

    // ISO 3166-1 numeric → alpha-2 mapping for world-atlas TopoJSON
    _isoNumToAlpha2: {
      '004':'AF','008':'AL','012':'DZ','016':'AS','020':'AD','024':'AO','028':'AG','031':'AZ',
      '032':'AR','036':'AU','040':'AT','044':'BS','048':'BH','050':'BD','051':'AM','056':'BE',
      '064':'BT','068':'BO','070':'BA','072':'BW','076':'BR','084':'BZ','090':'SB','096':'BN',
      '100':'BG','104':'MM','108':'BI','112':'BY','116':'KH','120':'CM','124':'CA','140':'CF',
      '144':'LK','148':'TD','152':'CL','156':'CN','170':'CO','178':'CG','180':'CD','188':'CR',
      '191':'HR','192':'CU','196':'CY','203':'CZ','208':'DK','262':'DJ','214':'DO','218':'EC',
      '818':'EG','222':'SV','226':'GQ','232':'ER','233':'EE','231':'ET','242':'FJ','246':'FI',
      '250':'FR','266':'GA','270':'GM','268':'GE','276':'DE','288':'GH','300':'GR','320':'GT',
      '324':'GN','328':'GY','332':'HT','340':'HN','348':'HU','352':'IS','356':'IN','360':'ID',
      '364':'IR','368':'IQ','372':'IE','376':'IL','380':'IT','388':'JM','392':'JP','400':'JO',
      '398':'KZ','404':'KE','408':'KP','410':'KR','414':'KW','417':'KG','418':'LA','422':'LB',
      '426':'LS','428':'LV','430':'LR','434':'LY','440':'LT','442':'LU','450':'MG','454':'MW',
      '458':'MY','466':'ML','478':'MR','484':'MX','496':'MN','498':'MD','504':'MA','508':'MZ',
      '512':'OM','516':'NA','524':'NP','528':'NL','540':'NC','554':'NZ','558':'NI','562':'NE',
      '566':'NG','578':'NO','586':'PK','591':'PA','598':'PG','600':'PY','604':'PE','608':'PH',
      '616':'PL','620':'PT','630':'PR','634':'QA','642':'RO','643':'RU','646':'RW','682':'SA',
      '686':'SN','688':'RS','694':'SL','702':'SG','703':'SK','705':'SI','706':'SO','710':'ZA',
      '724':'ES','729':'SD','740':'SR','752':'SE','756':'CH','760':'SY','158':'TW','762':'TJ',
      '764':'TH','768':'TG','780':'TT','788':'TN','792':'TR','795':'TM','800':'UG','804':'UA',
      '784':'AE','826':'GB','840':'US','858':'UY','860':'UZ','862':'VE','704':'VN','887':'YE',
      '894':'ZM','716':'ZW','275':'PS','-99':'XK',
    },

    // Country coordinate lookup (alpha-2 → [lat, lng])
    _countryCoords: {
      US: [39.8, -98.6], CN: [35.0, 105.0], JP: [36.2, 138.3], DE: [51.2, 10.4],
      GB: [55.4, -3.4], FR: [46.2, 2.2], BR: [-14.2, -51.9], IN: [20.6, 78.9],
      CA: [56.1, -106.3], AU: [-25.3, 133.8], KR: [35.9, 127.8], IT: [41.9, 12.5],
      ES: [40.5, -3.7], RU: [61.5, 105.3], MX: [23.6, -102.6], NL: [52.1, 5.3],
      SE: [60.1, 18.6], PL: [51.9, 19.1], TR: [38.9, 35.2], AR: [-38.4, -63.6],
      TW: [23.7, 120.9], SG: [1.3, 103.8], HK: [22.4, 114.1], TH: [15.9, 100.5],
      MY: [4.2, 101.9], ID: [-0.8, 113.9], VN: [14.1, 108.3], PH: [12.9, 121.8],
      ZA: [-30.6, 22.9], NG: [9.1, 8.7], EG: [26.8, 30.8], KE: [-0.0, 37.9],
      CO: [4.6, -74.1], CL: [-35.7, -71.5], PE: [-9.2, -75.0], UA: [48.4, 31.2],
      CZ: [49.8, 15.5], AT: [47.5, 14.6], CH: [46.8, 8.2], BE: [50.5, 4.5],
      PT: [39.4, -8.2], DK: [56.3, 9.5], NO: [60.5, 8.5], FI: [61.9, 25.7],
      IE: [53.1, -7.7], NZ: [-40.9, 174.9], IL: [31.0, 34.9], AE: [23.4, 53.8],
      SA: [23.9, 45.1], RO: [45.9, 24.9], HU: [47.2, 19.5], GR: [39.1, 21.8],
    },

    // Load world GeoJSON (cached after first fetch)
    _geoJsonCache: null,
    async _loadGeoJson() {
      if (this._geoJsonCache) return this._geoJsonCache;
      try {
        const res = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
        const topo = await res.json();
        const countries = window.topojson.feature(topo, topo.objects.countries);
        // Attach alpha-2 codes to features
        const features = countries.features.map(f => ({
          ...f,
          properties: {
            ...f.properties,
            iso_a2: this._isoNumToAlpha2[String(f.id)] || null,
          },
        }));
        this._geoJsonCache = features;
        return features;
      } catch (e) {
        console.error('Failed to load GeoJSON:', e);
        return [];
      }
    },

    // Build a canvas texture with country polygons colored by visitor intensity
    _buildCountryTexture(THREE, geoFeatures, visitorMap, maxVisitors) {
      const W = 2048;
      const H = 1024;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');

      // Transparent base
      ctx.clearRect(0, 0, W, H);

      // Equirectangular projection helper
      function projectLng(lng) { return ((lng + 180) / 360) * W; }
      function projectLat(lat) { return ((90 - lat) / 180) * H; }

      function drawRing(coords) {
        ctx.moveTo(projectLng(coords[0][0]), projectLat(coords[0][1]));
        for (let i = 1; i < coords.length; i++) {
          // Break path when crossing antimeridian (large lng jump)
          if (Math.abs(coords[i][0] - coords[i - 1][0]) > 90) {
            ctx.moveTo(projectLng(coords[i][0]), projectLat(coords[i][1]));
          } else {
            ctx.lineTo(projectLng(coords[i][0]), projectLat(coords[i][1]));
          }
        }
      }

      function drawGeometry(geometry) {
        if (geometry.type === 'Polygon') {
          for (const ring of geometry.coordinates) { drawRing(ring); }
        } else if (geometry.type === 'MultiPolygon') {
          for (const polygon of geometry.coordinates) {
            for (const ring of polygon) { drawRing(ring); }
          }
        }
      }

      // First pass: draw all country borders — thin precise outline
      for (const feature of geoFeatures) {
        ctx.beginPath();
        drawGeometry(feature.geometry);
        ctx.strokeStyle = 'rgba(184, 238, 65, 0.35)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      // Second pass: fill countries with visitors (green intensity by count)
      for (const feature of geoFeatures) {
        const code = feature.properties.iso_a2;
        const visitors = (code && visitorMap[code]) || 0;
        if (visitors <= 0) continue;

        const intensity = maxVisitors > 0 ? visitors / maxVisitors : 0;

        ctx.beginPath();
        drawGeometry(feature.geometry);

        // Green fill — darker for low traffic, brighter for high
        const r = Math.round(60 + intensity * 124);
        const g = Math.round(120 + intensity * 118);
        const b = Math.round(20 + intensity * 45);
        const alpha = 0.4 + intensity * 0.5;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.fill();

        // Slightly brighter border on active countries
        ctx.strokeStyle = `rgba(184, 238, 65, ${0.5 + intensity * 0.4})`;
        ctx.lineWidth = 1.0;
        ctx.stroke();
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      return texture;
    },

    async initGlobe() {
      const container = this.$refs.globeContainer || document.querySelector('.globe-container');
      if (!container) return;
      if (this._globe) return; // already initialized

      try {
        const THREE = await import('three');
        const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');

        // Load GeoJSON in parallel with scene setup
        const geoPromise = this._loadGeoJson();

        const rect = container.getBoundingClientRect();
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, rect.width / rect.height, 0.1, 1000);
        camera.position.set(0, 0.3, 2.8);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(rect.width, rect.height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0x000000, 0);
        container.appendChild(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.enablePan = false;
        controls.minDistance = 1.5;
        controls.maxDistance = 5;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.3;

        // Wait for GeoJSON before creating globe material
        const geoFeatures = await geoPromise;

        // Initial country texture (empty visitor data)
        let countryTexture = this._buildCountryTexture(THREE, geoFeatures, {}, 0);

        // Solid dark globe
        const globeGeo = new THREE.SphereGeometry(1, 64, 64);
        const globeMat = new THREE.MeshPhongMaterial({
          color: 0x080808,
          emissive: 0x050505,
          specular: 0x222222,
          shininess: 20,
        });
        const globe = new THREE.Mesh(globeGeo, globeMat);
        scene.add(globe);

        // Country overlay sphere — renders country polygons on the surface
        const overlayGeo = new THREE.SphereGeometry(1.005, 64, 64);
        const overlayMat = new THREE.MeshBasicMaterial({
          map: countryTexture,
          transparent: true,
          opacity: 1.0,
          depthWrite: false,
        });
        const overlay = new THREE.Mesh(overlayGeo, overlayMat);
        scene.add(overlay);

        // Latitude and longitude lines (real graticule)
        const gridRadius = 1.008;
        const gridMat = new THREE.LineBasicMaterial({ color: 0x3a5a30, transparent: true, opacity: 0.35 });

        // Latitude lines: every 30 degrees
        for (let lat = -60; lat <= 60; lat += 30) {
          const pts = [];
          const phi = (90 - lat) * Math.PI / 180;
          for (let lng = 0; lng <= 360; lng += 2) {
            const theta = (lng + 180) * Math.PI / 180;
            pts.push(new THREE.Vector3(
              -gridRadius * Math.sin(phi) * Math.cos(theta),
              gridRadius * Math.cos(phi),
              gridRadius * Math.sin(phi) * Math.sin(theta)
            ));
          }
          const geo = new THREE.BufferGeometry().setFromPoints(pts);
          scene.add(new THREE.Line(geo, gridMat));
        }

        // Longitude lines: every 30 degrees
        for (let lng = 0; lng < 360; lng += 30) {
          const pts = [];
          const theta = (lng + 180) * Math.PI / 180;
          for (let lat = -90; lat <= 90; lat += 2) {
            const phi = (90 - lat) * Math.PI / 180;
            pts.push(new THREE.Vector3(
              -gridRadius * Math.sin(phi) * Math.cos(theta),
              gridRadius * Math.cos(phi),
              gridRadius * Math.sin(phi) * Math.sin(theta)
            ));
          }
          const geo = new THREE.BufferGeometry().setFromPoints(pts);
          scene.add(new THREE.Line(geo, gridMat));
        }

        // Lighting — neutral, let the country texture provide color
        scene.add(new THREE.AmbientLight(0x222222));
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
        dirLight.position.set(5, 3, 5);
        scene.add(dirLight);

        const pointsGroup = new THREE.Group();
        scene.add(pointsGroup);
        const arcsGroup = new THREE.Group();
        scene.add(arcsGroup);

        function latLngToVec3(lat, lng, radius) {
          radius = radius || 1.01;
          const phi = (90 - lat) * Math.PI / 180;
          const theta = (lng + 180) * Math.PI / 180;
          return new THREE.Vector3(
            -radius * Math.sin(phi) * Math.cos(theta),
            radius * Math.cos(phi),
            radius * Math.sin(phi) * Math.sin(theta)
          );
        }

        function addDot(lat, lng, size, color) {
          const dotGeo = new THREE.SphereGeometry(size || 0.012, 8, 8);
          const dotMat = new THREE.MeshBasicMaterial({ color: color || 0xB8EE41, transparent: true, opacity: 0.9 });
          const dot = new THREE.Mesh(dotGeo, dotMat);
          dot.position.copy(latLngToVec3(lat, lng, 1.015));
          dot.userData.created = Date.now();
          pointsGroup.add(dot);

          // Pulse ring
          const ringGeo = new THREE.RingGeometry(0.015, 0.03, 16);
          const ringMat = new THREE.MeshBasicMaterial({
            color: color || 0xB8EE41, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
          });
          const ring = new THREE.Mesh(ringGeo, ringMat);
          ring.position.copy(latLngToVec3(lat, lng, 1.015));
          ring.lookAt(new THREE.Vector3(0, 0, 0));
          ring.userData.created = Date.now();
          ring.userData.isRing = true;
          pointsGroup.add(ring);
        }

        function addArc(fromLat, fromLng, toLat, toLng, delay) {
          delay = delay || 0;
          const created = Date.now() + delay;
          const from = latLngToVec3(fromLat, fromLng, 1.015);
          const to = latLngToVec3(toLat, toLng, 1.015);
          const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
          const dist = from.distanceTo(to);
          mid.normalize().multiplyScalar(1 + dist * 0.35);

          const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
          const points = curve.getPoints(40);
          const geo = new THREE.BufferGeometry().setFromPoints(points);
          const mat = new THREE.LineBasicMaterial({
            color: 0xB8EE41, transparent: true, opacity: 0.0,
          });
          const line = new THREE.Line(geo, mat);
          line.userData.created = created;
          line.userData.delay = delay;
          arcsGroup.add(line);
        }

        // Calculate distance between two lat/lng pairs
        function geoDistance(lat1, lng1, lat2, lng2) {
          const dLat = (lat2 - lat1) * Math.PI / 180;
          const dLng = (lng2 - lng1) * Math.PI / 180;
          return Math.sqrt(dLat * dLat + dLng * dLng);
        }

        // Build a hop path from origin country to CN (max 3 hops)
        function buildPathToCN(originCode, activeCountries, COORDS) {
          const target = COORDS['CN'];
          if (!target) return [];
          const origin = COORDS[originCode];
          if (!origin) return [];

          const path = [{ code: originCode, lat: origin[0], lng: origin[1] }];
          const visited = new Set([originCode, 'CN']);
          let current = origin;

          // Find intermediate hops (max 2 intermediates, then final hop to CN)
          const maxIntermediates = 2;
          const distToCN = geoDistance(current[0], current[1], target[0], target[1]);

          for (let hop = 0; hop < maxIntermediates; hop++) {
            // Only add intermediate if we're far enough from CN
            if (geoDistance(current[0], current[1], target[0], target[1]) < 30 * Math.PI / 180) break;

            // Find the best intermediate: an active country closer to CN
            let bestCode = null;
            let bestDist = geoDistance(current[0], current[1], target[0], target[1]);
            for (const c of activeCountries) {
              if (visited.has(c.country) || !COORDS[c.country]) continue;
              const coord = COORDS[c.country];
              const dToTarget = geoDistance(coord[0], coord[1], target[0], target[1]);
              const dFromCurrent = geoDistance(current[0], current[1], coord[0], coord[1]);
              // Must be closer to CN than current, and not too far from current
              if (dToTarget < bestDist && dFromCurrent < bestDist * 0.8) {
                bestDist = dToTarget;
                bestCode = c.country;
              }
            }
            if (!bestCode) break;
            visited.add(bestCode);
            const coord = COORDS[bestCode];
            path.push({ code: bestCode, lat: coord[0], lng: coord[1] });
            current = coord;
          }

          // Final hop to CN
          path.push({ code: 'CN', lat: target[0], lng: target[1] });
          return path;
        }

        let animFrameId;
        function animate() {
          animFrameId = requestAnimationFrame(animate);
          controls.update();

          const now = Date.now();

          // Animate rings + fade dots
          for (let i = pointsGroup.children.length - 1; i >= 0; i--) {
            const child = pointsGroup.children[i];
            const age = now - child.userData.created;
            if (child.userData.isRing) {
              const scale = 1 + (age / 1000) * 2;
              child.scale.set(scale, scale, scale);
              child.material.opacity = Math.max(0, 0.5 - age / 3000);
              if (age > 3000) { child.geometry.dispose(); child.material.dispose(); pointsGroup.remove(child); }
            } else {
              if (age > 60000) {
                child.material.opacity = Math.max(0, 0.9 - (age - 60000) / 5000);
                if (age > 65000) { child.geometry.dispose(); child.material.dispose(); pointsGroup.remove(child); }
              }
            }
          }

          // Fade arcs (with delay support)
          for (let i = arcsGroup.children.length - 1; i >= 0; i--) {
            const arc = arcsGroup.children[i];
            const age = now - arc.userData.created;
            if (age < 0) {
              // Not yet visible (delayed)
              arc.material.opacity = 0;
            } else {
              // Fade in quickly, then fade out
              const fadeIn = Math.min(age / 400, 1.0);
              const fadeOut = Math.max(0, 1.0 - age / 4000);
              arc.material.opacity = 0.45 * fadeIn * fadeOut;
              if (age > 4000) { arc.geometry.dispose(); arc.material.dispose(); arcsGroup.remove(arc); }
            }
          }

          renderer.render(scene, camera);
        }
        animate();

        // Resize handler
        const onResize = () => {
          const r = container.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          camera.aspect = r.width / r.height;
          camera.updateProjectionMatrix();
          renderer.setSize(r.width, r.height);
        };
        window.addEventListener('resize', onResize);

        // Flight animation interval — every 5s, pick a random country and fly to CN
        let flightIdx = 0;
        const flightInterval = setInterval(() => {
          if (!this._globe) return;
          const countries = this._globe.lastCountries || [];
          const COORDS = this._countryCoords;
          // Filter countries that aren't CN and have coords
          const candidates = countries.filter(c => c.country !== 'CN' && COORDS[c.country]);
          if (candidates.length === 0) return;

          // Round-robin through countries, weighted by visitors
          const c = candidates[flightIdx % candidates.length];
          flightIdx++;

          const path = buildPathToCN(c.country, countries, COORDS);
          if (path.length < 2) return;

          // Add arcs for each hop with staggered delay
          for (let i = 0; i < path.length - 1; i++) {
            const hopDelay = i * 800; // 800ms between each hop
            addArc(path[i].lat, path[i].lng, path[i + 1].lat, path[i + 1].lng, hopDelay);
            // Add a dot at each hop point
            addDot(path[i].lat, path[i].lng, 0.01);
          }
          // Dot at CN arrival
          addDot(path[path.length - 1].lat, path[path.length - 1].lng, 0.012);
        }, 5000);

        // Store references for cleanup and data updates
        this._globe = {
          THREE, scene, camera, renderer, controls, pointsGroup, arcsGroup,
          globe, globeMat, overlay, overlayMat, countryTexture,
          geoFeatures, addDot, addArc, latLngToVec3, buildPathToCN,
          animFrameId, onResize, flightInterval,
          lastCountries: [],
        };

        // Load initial country data onto texture
        if (this.countries.length > 0) {
          this.updateGlobeCountries(this.countries);
        }

      } catch (e) {
        console.error('Globe init error:', e);
      }
    },

    updateGlobeCountries(countries) {
      if (!this._globe || !countries.length) return;

      const COORDS = this._countryCoords;
      const g = this._globe;

      // Build visitor lookup { 'US': 120, 'CN': 45, ... }
      const visitorMap = {};
      const maxVisitors = Math.max(...countries.map(c => c.visitors), 1);
      for (const c of countries) {
        visitorMap[c.country] = c.visitors;
      }

      // Rebuild country texture
      if (g.geoFeatures.length > 0) {
        if (g.countryTexture) g.countryTexture.dispose();
        const newTexture = this._buildCountryTexture(g.THREE, g.geoFeatures, visitorMap, maxVisitors);
        g.overlayMat.map = newTexture;
        g.overlayMat.needsUpdate = true;
        g.countryTexture = newTexture;
      }

      // Update country list for flight animation
      g.lastCountries = countries;
    },

    updateGlobeRealtime(data) {
      // Realtime data can trigger additional visual effects on the globe
      // Already handled through polling — countries update via fetchAll
    },

    destroyGlobe() {
      if (!this._globe) return;
      const g = this._globe;
      cancelAnimationFrame(g.animFrameId);
      if (g.flightInterval) clearInterval(g.flightInterval);
      window.removeEventListener('resize', g.onResize);
      if (g.countryTexture) g.countryTexture.dispose();
      g.renderer.dispose();
      g.controls.dispose();
      // Dispose scene objects
      g.scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
      // Remove canvas
      if (g.renderer.domElement && g.renderer.domElement.parentNode) {
        g.renderer.domElement.parentNode.removeChild(g.renderer.domElement);
      }
      this._globe = null;
    },

    // Helpers
    fmt(n) {
      if (n == null) return '0';
      return Number(n).toLocaleString();
    },

    fmtDuration(sec) {
      if (!sec || sec === 0) return '0s';
      sec = Math.round(Number(sec));
      if (sec < 60) return sec + 's';
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return m + 'm ' + s + 's';
    },

    fmtDelta(val) {
      if (val == null) return '';
      const sign = val > 0 ? '+' : '';
      return sign + val + '%';
    },

    deltaClass(val, inverted) {
      if (val == null || val === 0) return 'neutral';
      if (inverted) return val < 0 ? 'up' : 'down';
      return val > 0 ? 'up' : 'down';
    },

    pct(val, arr, key) {
      if (!arr || arr.length === 0) return 0;
      const k = key || 'views';
      const max = Math.max(...arr.map(i => Number(i[k]) || 0));
      if (max === 0) return 0;
      return Math.round((Number(val) / max) * 100);
    },
  };
}
