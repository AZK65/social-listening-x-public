const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3001';

class DashboardReporter {
    constructor() {
        this.enabled = !!process.env.DASHBOARD_URL;
        this.platform = 'twitter';
        this.logBuffer = [];
        this.flushInterval = null;
    }

    async log(message, level = 'info') {
        if (!this.enabled) return;
        this.logBuffer.push({ source: this.platform, level, message });
        if (!this.flushInterval) {
            this.flushInterval = setTimeout(() => this.flushLogs(), 2000);
        }
    }

    async flushLogs() {
        this.flushInterval = null;
        if (this.logBuffer.length === 0) return;
        const messages = [...this.logBuffer];
        this.logBuffer = [];
        try {
            await fetch(`${DASHBOARD_URL}/api/logs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source: this.platform, messages }),
            });
        } catch (e) { /* silent */ }
    }

    async reportRun(platform, allResults, stats = {}) {
        if (!this.enabled) return;
        this.platform = platform;

        try {
            await this.log(`Run complete: found=${stats.found || 0} new=${stats.new || 0} qualified=${stats.qualified || 0}`);

            const leads = allResults.map(result => {
                const post = result.post || result;
                const verdict = result.verdict || null;
                const enrichment = result.enrichment || null;

                return {
                    platform: post.source || platform,
                    id: post.id,
                    username: post.username,
                    title: post.title || '',
                    content: post.content || '',
                    url: post.url || '',
                    subreddit: post.subreddit || '',
                    score: post.score || 0,
                    numComments: post.numComments || 0,
                    matchedQuery: post.matchedQuery || '',
                    timestamp: post.timestamp || new Date().toISOString(),
                    decision: verdict?.decision || null,
                    confidence: verdict?.confidence || null,
                    reason: verdict?.reason || null,
                    store_domain: verdict?.store_domain || null,
                    contact_channels: verdict?.contact_channels || [],
                    best_approach: verdict?.best_approach || null,
                    draft_reply: verdict?.draft_reply || null,
                    verdict,
                    enrichment: enrichment?.found ? {
                        bio: enrichment.bio,
                        domains: enrichment.domains,
                        emails: enrichment.emails,
                        socials: enrichment.socials,
                    } : null,
                };
            });

            const response = await fetch(`${DASHBOARD_URL}/api/webhook/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ platform, leads, stats }),
            });

            if (!response.ok) {
                console.error(`[dashboard] webhook failed: ${response.status}`);
                return;
            }

            const data = await response.json();
            console.log(`[dashboard] reported ${data.inserted} new leads to dashboard`);
        } catch (error) {
            console.error(`[dashboard] report failed: ${error.message}`);
        }
    }
}

export const dashboard = new DashboardReporter();

// Hook into console.log to forward logs to dashboard
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = (...args) => {
    originalLog(...args);
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    if (msg && !msg.startsWith('[dashboard]')) {
        dashboard.log(msg, 'info');
    }
};

console.error = (...args) => {
    originalError(...args);
    const msg = args.map(a => typeof a === 'string' ? a : (a?.message || JSON.stringify(a))).join(' ');
    if (msg) dashboard.log(msg, 'error');
};

console.warn = (...args) => {
    originalWarn(...args);
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    if (msg) dashboard.log(msg, 'warn');
};
