import 'dotenv/config';
import { config } from './src/config.js';
import { llmFilter } from './src/llm-filter.js';
import { telegram } from './src/telegram.js';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const APIFY_ACTOR_URL = 'https://api.apify.com/v2/acts/kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest/runs';

// 72 hours backtest
const HOURS_BACK = 72;

function buildSearchQuery(query, hoursBack) {
    const since = new Date();
    since.setTime(since.getTime() - (hoursBack * 60 * 60 * 1000));
    const sinceStr = since.toISOString().split('T')[0];
    return `${query} since:${sinceStr}`;
}

async function waitForResults(runId, maxWaitTime = 120000) {
    const startTime = Date.now();
    const pollInterval = 3000;

    while (Date.now() - startTime < maxWaitTime) {
        const statusResponse = await fetch(
            `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`
        );
        const statusData = await statusResponse.json();
        const status = statusData.data?.status;

        if (status === 'SUCCEEDED') {
            const datasetId = statusData.data?.defaultDatasetId;
            const resultsResponse = await fetch(
                `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}`
            );
            return await resultsResponse.json();
        } else if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
            return [];
        }
        await new Promise(r => setTimeout(r, pollInterval));
    }
    return [];
}

function processResults(results, matchedQuery) {
    const tweets = [];
    const seenIds = new Set();

    for (const item of results) {
        try {
            const tweetId = item.id || item.tweetId || item.id_str;
            if (!tweetId || seenIds.has(tweetId)) continue;

            const username = item.author?.userName || item.user?.screen_name || item.username;
            const displayName = item.author?.name || item.user?.name || item.name;
            const content = item.text || item.full_text || item.content;
            const followers = item.author?.followers || item.user?.followers_count;
            const bio = item.author?.description || item.user?.description;

            if (!username || !content) continue;
            if (content.includes('KaitoEasyAPI')) continue;
            if (username?.toLowerCase() === 'apptics') continue;
            if (content?.trim().startsWith('@')) continue;
            if (content?.startsWith('RT @')) continue;

            // Language filter
            const lowerContent = content.toLowerCase();
            const foreignPatterns = [
                /\b(não|você|muito|também|fazer|está|isso|para|como|mais|esse|essa|meu|minha|seu|sua|kkk|pqp|mano|cara|nunca|sempre|agora|aqui|vocês|obrigado|obrigada|shopee)\b/,
                /\b(está|qué|cómo|también|pero|para|porque|tiene|hace|este|esta|más|muy|siempre|nunca|ahora|aquí|ustedes|gracias|hola|tienda)\b/,
                /\b(vous|nous|est|sont|mais|pour|avec|dans|cette|votre|notre|très|aussi|toujours|jamais|maintenant|merci|bonjour)\b/,
                /\b(nicht|aber|für|mit|sind|haben|werden|diese|dieser|sehr|auch|immer|wieder|heute|danke|bitte)\b/,
                /\b(bir|için|değil|var|olan|gibi|daha|çok|şey|benim|senin|nasıl|neden|şimdi|bugün|teşekkür)\b/,
            ];
            if (foreignPatterns.some(p => p.test(lowerContent))) continue;
            if (lowerContent.includes('shopee') && !lowerContent.includes('shopify')) continue;
            if (content.length < 30) continue;

            tweets.push({
                id: tweetId,
                username,
                displayName,
                content,
                url: `https://x.com/${username}/status/${tweetId}`,
                matchedQuery,
                followers,
                bio,
            });
            seenIds.add(tweetId);
        } catch (e) {}
    }
    return tweets;
}

async function scrapeQuery(query) {
    const searchQuery = buildSearchQuery(query, HOURS_BACK);
    console.log(`\nSearching: "${query}" (last ${HOURS_BACK} hours)`);

    try {
        const response = await fetch(`${APIFY_ACTOR_URL}?token=${APIFY_TOKEN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                searchTerms: [searchQuery],
                maxItems: 50,
                sort: 'Latest',
                tweetLanguage: 'en',
            }),
        });

        const runData = await response.json();
        const runId = runData.data?.id;
        if (!runId) return [];

        const results = await waitForResults(runId);
        console.log(`  Got ${results.length} raw results`);
        return processResults(results, query);
    } catch (error) {
        console.error(`  Error: ${error.message}`);
        return [];
    }
}

async function runBacktest() {
    console.log('='.repeat(60));
    console.log(`BACKTEST: 72 HOURS with ${config.searchQueries.length} subscription-focused queries`);
    console.log('='.repeat(60));

    // Initialize Telegram
    const telegramReady = telegram.init();
    if (!telegramReady) {
        console.error('Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID');
        return;
    }

    await telegram.sendStatusMessage(`🧪 BACKTEST STARTED: 72 hours, ${config.searchQueries.length} queries`);

    const allTweets = [];
    const seenIds = new Set();

    for (const query of config.searchQueries) {
        const tweets = await scrapeQuery(query);
        for (const t of tweets) {
            if (!seenIds.has(t.id)) {
                allTweets.push(t);
                seenIds.add(t.id);
            }
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    console.log('\n' + '='.repeat(60));
    console.log(`TOTAL UNIQUE TWEETS FOUND: ${allTweets.length}`);
    console.log('='.repeat(60));

    if (allTweets.length === 0) {
        console.log('\nNo tweets found. Queries might be too specific.');
        await telegram.sendStatusMessage('🧪 BACKTEST: No tweets found with these queries');
        return;
    }

    // Run LLM filter
    console.log('\n' + '='.repeat(60));
    console.log('RUNNING LLM FILTER...');
    console.log('='.repeat(60));

    const filtered = await llmFilter.filterTweets(allTweets);

    console.log('\n' + '='.repeat(60));
    console.log(`LLM APPROVED: ${filtered.length}/${allTweets.length} tweets`);
    console.log('='.repeat(60));

    await telegram.sendStatusMessage(`🧪 BACKTEST RESULTS: ${filtered.length}/${allTweets.length} passed LLM filter`);

    if (filtered.length > 0) {
        // Send approved leads to Telegram
        await telegram.sendBatchAlert(filtered);
        console.log(`\nSent ${filtered.length} leads to Telegram`);
    } else {
        console.log('\nNo tweets passed LLM filter.');
        await telegram.sendStatusMessage('🧪 BACKTEST: No leads passed the filter');
    }

    console.log('\n✅ Backtest complete!');
}

runBacktest().catch(console.error);
