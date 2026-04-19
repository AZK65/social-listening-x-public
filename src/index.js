import cron from 'node-cron';
import { config } from './config.js';
import { storage } from './storage.js';
import { telegram } from './telegram.js';
import { scraper } from './scraper.js';
import { llmFilter } from './llm-filter.js';
import { dashboard } from './dashboard-reporter.js';

async function runMonitoring(hoursBack = 168) {
    const timeLabel = hoursBack < 24 ? `${hoursBack} hours` : `${Math.round(hoursBack/24)} days`;
    console.log('\n' + '='.repeat(60));
    console.log(`Starting monitoring run at ${new Date().toISOString()}`);
    console.log(`Looking back: ${timeLabel}`);
    console.log('='.repeat(60));

    try {
        // Scrape all configured queries
        const allTweets = await scraper.scrapeAllQueries(hoursBack);

        if (allTweets.length === 0) {
            console.log('No tweets found in this run');
            return;
        }

        // Filter out already seen tweets
        const newTweets = storage.filterNewTweets(allTweets);
        console.log(`New tweets (not seen before): ${newTweets.length}`);

        if (newTweets.length === 0) {
            console.log('No new tweets to report');
            return;
        }

        // Use LLM to filter for relevant leads
        const relevantTweets = config.llm?.enabled
            ? await llmFilter.filterTweets(newTweets)
            : newTweets;

        console.log(`Relevant tweets after LLM filter: ${relevantTweets.length}`);

        // Mark all as seen
        newTweets.forEach(tweet => storage.markAsSeen(tweet.id));
        await storage.save();

        // Report ALL tweets (relevant + rejected) to dashboard
        const allResults = newTweets.map(tweet => {
            const isRelevant = relevantTweets.some(r => r.id === tweet.id);
            return {
                post: {
                    ...tweet,
                    source: 'twitter',
                    subreddit: '',
                    title: '',
                    content: tweet.content,
                    numComments: 0,
                    score: 0,
                },
                verdict: { decision: isRelevant ? 'RELEVANT' : 'REJECT' },
            };
        });
        await dashboard.reportRun('twitter', allResults, {
            found: allTweets.length,
            new: newTweets.length,
            qualified: relevantTweets.length,
        });

        if (relevantTweets.length === 0) {
            console.log('No relevant tweets after LLM filtering');
            return;
        }

        // Send Telegram notifications only for relevant tweets
        await telegram.sendBatchAlert(relevantTweets);

        console.log(`Successfully processed ${relevantTweets.length} relevant tweets`);

        // Periodic cleanup of old entries
        await storage.cleanup();

    } catch (error) {
        console.error('Error during monitoring run:', error);
        await telegram.sendErrorMessage(error.message);
    }
}

async function main() {
    console.log('Social Listening Tool for X (Twitter)');
    console.log('=====================================\n');

    // Validate configuration
    if (config.searchQueries.length === 0) {
        console.error('No search queries configured. Please add queries to src/config.js');
        process.exit(1);
    }

    console.log(`Configured queries: ${config.searchQueries.length}`);
    config.searchQueries.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));

    // Initialize storage
    await storage.init();

    // Initialize Telegram
    const telegramReady = telegram.init();
    if (!telegramReady) {
        console.warn('\nTelegram notifications disabled. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env');
    } else {
        await telegram.sendStatusMessage('Social listening bot started');
    }

    // Show LLM status
    if (config.llm?.enabled && process.env.OPENROUTER_API_KEY) {
        console.log(`\nLLM filtering enabled: ${config.llm.model}`);
    } else {
        console.log('\nLLM filtering disabled (no OPENROUTER_API_KEY)');
    }

    // Run immediately on startup with 30-day lookback to catch up
    if (config.schedule.runOnStartup) {
        console.log('\nRunning initial catch-up check (30-day lookback)...');
        await runMonitoring(720);
        // Disable so next deploy doesn't repeat
        config.schedule.runOnStartup = false;
    }

    // Schedule recurring runs every 3 hours with 24-hour lookback.
    // Wider lookback is effectively free: seen-tweet dedup (storage.filterNewTweets)
    // runs before the LLM, so re-fetched tweets don't incur LLM cost, and Apify
    // cost is capped per-query by scraper.maxTweetsPerQuery.
    console.log(`\nScheduling monitoring runs: ${config.schedule.cronExpression}`);
    console.log('(Runs every 3 hours, checking last 24 hours for new tweets)');

    cron.schedule(config.schedule.cronExpression, async () => {
        await runMonitoring(24);
    });

    console.log('\nMonitoring active. Press Ctrl+C to stop.');
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await storage.save();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\nShutting down...');
    await storage.save();
    process.exit(0);
});

main().catch(console.error);
