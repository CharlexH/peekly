function app() {
  return {
    // Auth
    token: localStorage.getItem('wh_token') || '',
    password: '',
    loggingIn: false,
    loginError: '',

    // Data
    sites: [],
    selectedSite: '',
    period: '30d',
    summary: { visitors: 0, pageviews: 0, bounce_rate: 0, avg_duration: 0 },
    timeseries: [],
    pages: [],
    referrers: [],
    countries: [],
    browsers: [],
    osData: [],
    devices: [],
    realtimeCount: 0,

    // UI
    showSiteModal: false,
    newSiteName: '',
    newSiteDomain: '',
    newSiteSnippet: '',
    chart: null,

    async init() {
      if (this.token) {
        await this.fetchSites();
        if (this.sites.length > 0) {
          this.selectedSite = this.sites[0].id;
          await this.fetchAll();
        }
        this.startRealtime();
      }
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
        localStorage.setItem('wh_token', data.token);
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
      localStorage.removeItem('wh_token');
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
      } catch (e) {
        console.error('Failed to fetch sites:', e);
      }
    },

    async fetchAll() {
      if (!this.selectedSite) return;
      const [summary, timeseries, pages, referrers, countries, devices] = await Promise.all([
        this.api('/api/stats/summary'),
        this.api('/api/stats/timeseries'),
        this.api('/api/stats/pages'),
        this.api('/api/stats/referrers'),
        this.api('/api/stats/countries'),
        this.api('/api/stats/devices'),
      ]);

      if (summary) {
        this.summary = summary;
      }
      if (timeseries) {
        this.timeseries = timeseries.data || [];
        this.$nextTick(() => this.renderChart());
      }
      if (pages) this.pages = pages.pages || [];
      if (referrers) this.referrers = referrers.referrers || [];
      if (countries) this.countries = countries.countries || [];
      if (devices) {
        this.browsers = devices.browsers || [];
        this.osData = devices.os || [];
        this.devices = devices.devices || [];
      }
    },

    startRealtime() {
      const poll = async () => {
        if (!this.token || !this.selectedSite) return;
        try {
          const data = await this.api('/api/stats/realtime');
          if (data) this.realtimeCount = data.active_visitors || 0;
        } catch (e) {}
      };
      poll();
      setInterval(poll, 30000);
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

    // Chart rendering (simple canvas — no library dependency)
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
      const pad = { top: 10, right: 10, bottom: 24, left: 40 };
      const plotW = w - pad.left - pad.right;
      const plotH = h - pad.top - pad.bottom;

      const data = this.timeseries;
      const maxVal = Math.max(...data.map(d => d.visitors), 1);

      ctx.clearRect(0, 0, w, h);

      // Grid lines
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = pad.top + (plotH * i / 4);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(w - pad.right, y);
        ctx.stroke();

        // Y labels
        ctx.fillStyle = '#444';
        ctx.font = '10px -apple-system, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(maxVal * (1 - i / 4)).toString(), pad.left - 6, y + 3);
      }

      if (data.length < 2) return;

      // Plot area fill
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = pad.left + (i / (data.length - 1)) * plotW;
        const y = pad.top + plotH - (data[i].visitors / maxVal) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      // Close path for fill
      ctx.lineTo(pad.left + plotW, pad.top + plotH);
      ctx.lineTo(pad.left, pad.top + plotH);
      ctx.closePath();
      ctx.fillStyle = 'rgba(184, 238, 65, 0.08)';
      ctx.fill();

      // Line
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = pad.left + (i / (data.length - 1)) * plotW;
        const y = pad.top + plotH - (data[i].visitors / maxVal) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#B8EE41';
      ctx.lineWidth = 2;
      ctx.stroke();

      // X labels (first, mid, last)
      ctx.fillStyle = '#444';
      ctx.font = '10px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      const labelIndices = [0, Math.floor(data.length / 2), data.length - 1];
      for (const i of labelIndices) {
        const x = pad.left + (i / (data.length - 1)) * plotW;
        const d = new Date(data[i].timestamp * 1000);
        const label = `${d.getMonth() + 1}/${d.getDate()}`;
        ctx.fillText(label, x, h - 4);
      }
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

    pct(val, arr, key) {
      if (!arr || arr.length === 0) return 0;
      const k = key || 'views';
      const max = Math.max(...arr.map(i => Number(i[k]) || 0));
      if (max === 0) return 0;
      return Math.round((Number(val) / max) * 100);
    },
  };
}
