/**
 * Chrome MCP Scraper
 *
 * Scrapes tweets from X using a Chrome MCP browser automation client
 * driving an existing logged-in browser session.
 */

export function buildSearchUrl(query, daysBack = 7) {
    const since = new Date();
    since.setDate(since.getDate() - daysBack);
    const sinceStr = since.toISOString().split('T')[0];
    const fullQuery = `${query} since:${sinceStr}`;
    return `https://x.com/search?q=${encodeURIComponent(fullQuery)}&src=typed_query&f=live`;
}

export function parseSearchQueries() {
    return [
        'Apptics',
        '@apptics',
        'Shopify disable my payments',
        'Shopify disabled payments',
        'Shopify suspend payments',
        'Shopify banned payments',
        'payment processor Shopify',
        'payment gateway Shopify',
        'Shopify payment alternative',
        'best payment Shopify',
        'Shopify holding money',
        'Shopify payout',
        'processeur paiement Shopify',
        'paiement Shopify',
    ];
}

// JavaScript to extract tweets from the page (run in browser console)
export const extractTweetsScript = `
(function() {
    const tweets = [];
    const tweetElements = document.querySelectorAll('[data-testid="tweet"]');

    tweetElements.forEach(el => {
        try {
            const usernameEl = el.querySelector('[data-testid="User-Name"] a[href^="/"]');
            const username = usernameEl?.getAttribute('href')?.replace('/', '') || null;

            const displayNameEl = el.querySelector('[data-testid="User-Name"] span');
            const displayName = displayNameEl?.textContent || null;

            const textEl = el.querySelector('[data-testid="tweetText"]');
            const content = textEl?.textContent || '';

            const timeEl = el.querySelector('time');
            const tweetLink = timeEl?.closest('a');
            const tweetUrl = tweetLink?.getAttribute('href') || null;
            const tweetId = tweetUrl?.split('/status/')[1]?.split('?')[0] || null;
            const timestamp = timeEl?.getAttribute('datetime') || null;

            if (tweetId && username) {
                // Skip apptics tweets
                if (username.toLowerCase() === 'apptics' || username.toLowerCase() === 'zohoapptics') {
                    return;
                }
                // Skip replies to apptics
                if (content.toLowerCase().includes('@apptics')) {
                    return;
                }

                tweets.push({
                    id: tweetId,
                    username,
                    displayName,
                    content,
                    url: 'https://x.com' + tweetUrl,
                    timestamp
                });
            }
        } catch (e) {}
    });

    return JSON.stringify(tweets);
})();
`;

// JavaScript to extract profile info (run on profile page)
export const extractProfileScript = `
(function() {
    const links = Array.from(document.querySelectorAll('a'));
    let followers = null;
    let following = null;

    for (const link of links) {
        const href = link.getAttribute('href') || '';
        if (href.includes('/verified_followers') || href.includes('/followers')) {
            const text = link.textContent || '';
            const match = text.match(/([0-9,.]+[KMB]?)/);
            if (match) followers = match[1];
        }
        if (href.includes('/following')) {
            const text = link.textContent || '';
            const match = text.match(/([0-9,.]+[KMB]?)/);
            if (match) following = match[1];
        }
    }

    const bioEl = document.querySelector('[data-testid="UserDescription"]');
    const bio = bioEl ? bioEl.textContent.trim() : null;

    return JSON.stringify({ followers, following, bio });
})();
`;

console.log('Chrome scraper module loaded');
console.log('Use with a Chrome MCP client to scrape tweets');
