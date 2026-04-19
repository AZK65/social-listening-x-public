import { config } from './config.js';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const APIFY_ACTOR_URL = 'https://api.apify.com/v2/acts/kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest/runs';

class XScraper {
    constructor() {
        this.seenInSession = new Set();
    }

    async scrapeForQuery(query, hoursBack = 168) {
        // NOTE: we intentionally do NOT append "since:YYYY-MM-DD" to the query.
        // The KaitoEasyAPI actor returns billing-notice placeholders instead of
        // real tweets when since: is used. We filter by timestamp client-side
        // below in processResults using hoursBack.
        const searchQuery = query;
        const timeLabel = hoursBack < 24 ? `last ${hoursBack} hours` : `last ${Math.round(hoursBack/24)} days`;
        console.log(`\nSearching for: "${query}" (${timeLabel})`);

        try {
            // Start the Apify actor run
            const response = await fetch(`${APIFY_ACTOR_URL}?token=${APIFY_TOKEN}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    searchTerms: [searchQuery],
                    maxItems: config.scraper.maxTweetsPerQuery,
                    sort: 'Latest',
                    tweetLanguage: 'en',
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`Apify API error: ${response.status} - ${errorText}`);
                return [];
            }

            const runData = await response.json();
            const runId = runData.data?.id;

            if (!runId) {
                console.error('No run ID returned from Apify');
                return [];
            }

            console.log(`Apify run started: ${runId}`);

            // Wait for the run to complete
            const results = await this.waitForResults(runId);
            return this.processResults(results, query, hoursBack);

        } catch (error) {
            console.error(`Error scraping "${query}":`, error.message);
            return [];
        }
    }

    async waitForResults(runId, maxWaitTime = 120000) {
        const startTime = Date.now();
        const pollInterval = 3000;

        while (Date.now() - startTime < maxWaitTime) {
            try {
                // Check run status
                const statusResponse = await fetch(
                    `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`
                );
                const statusData = await statusResponse.json();
                const status = statusData.data?.status;

                if (status === 'SUCCEEDED') {
                    // Get the results
                    const datasetId = statusData.data?.defaultDatasetId;
                    const resultsResponse = await fetch(
                        `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}`
                    );
                    const results = await resultsResponse.json();
                    console.log(`Got ${results.length} results from Apify`);
                    return results;
                } else if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
                    console.error(`Apify run ${status}`);
                    return [];
                }

                // Still running, wait and poll again
                await new Promise(r => setTimeout(r, pollInterval));

            } catch (error) {
                console.error('Error polling Apify:', error.message);
                await new Promise(r => setTimeout(r, pollInterval));
            }
        }

        console.error('Apify run timed out');
        return [];
    }

    processResults(results, matchedQuery, hoursBack = 168) {
        const tweets = [];
        const cutoffMs = Date.now() - (hoursBack * 60 * 60 * 1000);
        let droppedByAge = 0;

        for (const item of results) {
            try {
                // Skip if we've already seen this tweet in this session
                const tweetId = item.id || item.tweetId || item.id_str;
                if (!tweetId || this.seenInSession.has(tweetId)) {
                    continue;
                }

                const username = item.author?.userName || item.user?.screen_name || item.username;
                const displayName = item.author?.name || item.user?.name || item.name;
                const content = item.text || item.full_text || item.content;
                const timestamp = item.createdAt || item.created_at;

                // Skip invalid/junk results
                if (!username || username === 'undefined' || !content) {
                    continue;
                }

                // Skip Apify API notices
                if (content.includes('KaitoEasyAPI') || content.includes('API pricing')) {
                    continue;
                }

                // Client-side time filter (replaces the broken since: operator)
                if (timestamp) {
                    const tweetMs = new Date(timestamp).getTime();
                    // Log first few for debugging
                    if (tweets.length === 0 && droppedByAge < 2) {
                        console.log(`[debug] Tweet timestamp: "${timestamp}" parsed as ${new Date(timestamp).toISOString()}, cutoff: ${new Date(cutoffMs).toISOString()}`);
                    }
                    if (!isNaN(tweetMs) && tweetMs < cutoffMs) {
                        droppedByAge++;
                        continue;
                    }
                }

                // Skip tweets from @apptics or @ZohoApptics
                if (username?.toLowerCase() === 'apptics' || username?.toLowerCase() === 'zohoapptics') {
                    continue;
                }

                // Skip tweets mentioning @apptics (likely replies to us)
                if (content?.toLowerCase().includes('@apptics')) {
                    continue;
                }

                // NOTE: previously we skipped every tweet starting with "@" as
                // a reply. That dropped merchant leads like "@Shopify
                // @ShopifySupport my store got banned...". The 30-char minimum
                // + LLM filter below handle short conversational noise.

                // Skip retweets
                if (content?.startsWith('RT @')) {
                    continue;
                }

                // Skip non-Latin scripts (Arabic, Chinese, etc.) - keep only Latin-based text
                const latinChars = (content.match(/[a-zA-Z]/g) || []).length;
                const totalAlphaChars = (content.match(/\p{L}/gu) || []).length;
                if (totalAlphaChars > 10 && latinChars / totalAlphaChars < 0.5) {
                    continue;
                }

                // Skip non-English tweets by detecting common foreign words/patterns
                const lowerContent = content.toLowerCase();
                const foreignPatterns = [
                    // Portuguese
                    /\b(não|você|muito|também|fazer|está|isso|para|como|mais|esse|essa|meu|minha|seu|sua|kkk|pqp|mano|cara|nunca|sempre|agora|aqui|vocês|obrigado|obrigada|shopee)\b/,
                    // Spanish
                    /\b(está|qué|cómo|también|pero|para|porque|tiene|hace|este|esta|más|muy|siempre|nunca|ahora|aquí|ustedes|gracias|hola|tienda)\b/,
                    // French
                    /\b(vous|nous|est|sont|mais|pour|avec|dans|cette|votre|notre|très|aussi|toujours|jamais|maintenant|merci|bonjour)\b/,
                    // German
                    /\b(nicht|aber|für|mit|sind|haben|werden|diese|dieser|sehr|auch|immer|wieder|heute|danke|bitte)\b/,
                    // Turkish
                    /\b(bir|için|değil|var|olan|gibi|daha|çok|şey|benim|senin|nasıl|neden|şimdi|bugün|teşekkür)\b/,
                    // Italian
                    /\b(sono|essere|questo|quella|molto|anche|sempre|adesso|grazie|ciao|perché|ancora)\b/,
                ];

                if (foreignPatterns.some(pattern => pattern.test(lowerContent))) {
                    continue;
                }

                // Skip Shopee complaints (common confusion with Shopify)
                if (lowerContent.includes('shopee') && !lowerContent.includes('shopify')) {
                    continue;
                }

                // Skip very short tweets (likely junk)
                if (content.length < 30) {
                    continue;
                }

                // Skip tweets that are just links with no context
                const textWithoutLinks = content.replace(/https?:\/\/\S+/g, '').trim();
                if (textWithoutLinks.length < 20) {
                    continue;
                }

                // Extract profile info if available
                const followers = item.author?.followers || item.user?.followers_count;
                const following = item.author?.following || item.user?.friends_count;
                const bio = item.author?.description || item.user?.description;

                const tweet = {
                    id: tweetId,
                    username,
                    displayName,
                    content,
                    url: `https://x.com/${username}/status/${tweetId}`,
                    timestamp,
                    matchedQuery,
                    followers: followers ? this.formatCount(followers) : null,
                    following: following ? this.formatCount(following) : null,
                    bio,
                };

                tweets.push(tweet);
                this.seenInSession.add(tweetId);

            } catch (e) {
                // Skip malformed results
            }
        }

        console.log(`Extracted ${tweets.length} valid tweets (dropped ${droppedByAge} older than window)`);
        return tweets;
    }

    formatCount(count) {
        if (typeof count === 'string') return count;
        if (count >= 1000000) return (count / 1000000).toFixed(1) + 'M';
        if (count >= 1000) return (count / 1000).toFixed(1) + 'K';
        return count.toString();
    }

    async scrapeAllQueries(hoursBack = 168) {
        const allTweets = [];
        this.seenInSession.clear();

        for (const query of config.searchQueries) {
            try {
                const tweets = await this.scrapeForQuery(query, hoursBack);
                allTweets.push(...tweets);

                // Small delay between queries
                await new Promise(r => setTimeout(r, 1000));
            } catch (error) {
                console.error(`Error scraping query "${query}":`, error.message);
            }
        }

        // Deduplicate tweets by ID
        const uniqueTweets = Array.from(
            new Map(allTweets.map(t => [t.id, t])).values()
        );

        console.log(`\nTotal unique tweets found: ${uniqueTweets.length}`);
        return uniqueTweets;
    }
}

export const scraper = new XScraper();
