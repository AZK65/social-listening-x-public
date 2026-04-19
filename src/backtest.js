import { config } from './config.js';
import { storage } from './storage.js';
import { telegram } from './telegram.js';
import { scraper } from './scraper.js';
import { llmFilter } from './llm-filter.js';

/**
 * Backtest Script
 *
 * Searches for tweets from the last 24 hours (or specified time range)
 * to test how well the queries and LLM filtering work.
 *
 * Usage: node src/backtest.js
 */

async function runBacktest() {
    console.log('\n' + '='.repeat(60));
    console.log('BACKTEST MODE - Checking last 24 hours of tweets');
    console.log('='.repeat(60));
    console.log(`Started at: ${new Date().toISOString()}\n`);

    // Don't load previous seen tweets - we want to see everything
    console.log('Skipping seen tweets filter for backtest...\n');

    try {
        // Scrape all configured queries
        const allTweets = await scraper.scrapeAllQueries();

        console.log('\n' + '='.repeat(60));
        console.log('BACKTEST RESULTS');
        console.log('='.repeat(60));

        if (allTweets.length === 0) {
            console.log('No tweets found for any query.');
            return;
        }

        console.log(`\nTotal tweets found: ${allTweets.length}`);

        // Show all tweets before filtering
        console.log('\n--- ALL TWEETS FOUND ---\n');
        allTweets.forEach((tweet, i) => {
            console.log(`${i + 1}. @${tweet.username}`);
            console.log(`   Query: "${tweet.matchedQuery}"`);
            console.log(`   Content: ${tweet.content?.substring(0, 100)}...`);
            console.log(`   URL: ${tweet.url}`);
            console.log('');
        });

        // Run LLM filter
        if (config.llm?.enabled) {
            console.log('\n--- LLM FILTERING ---\n');
            const relevantTweets = await llmFilter.filterTweets(allTweets);

            console.log('\n--- RELEVANT TWEETS (passed LLM filter) ---\n');

            if (relevantTweets.length === 0) {
                console.log('No tweets passed the LLM filter.');
            } else {
                relevantTweets.forEach((tweet, i) => {
                    console.log(`${i + 1}. @${tweet.username}`);
                    console.log(`   Query: "${tweet.matchedQuery}"`);
                    console.log(`   Content: ${tweet.content}`);
                    console.log(`   URL: ${tweet.url}`);
                    console.log(`   Time: ${tweet.timestamp}`);
                    console.log('');
                });

                // Ask if user wants to send to Telegram
                console.log('\n--- SUMMARY ---');
                console.log(`Total found: ${allTweets.length}`);
                console.log(`Passed LLM filter: ${relevantTweets.length}`);
                console.log(`Filter rate: ${((relevantTweets.length / allTweets.length) * 100).toFixed(1)}%`);

                // Send to Telegram if configured
                if (telegram.init()) {
                    console.log('\nSending relevant tweets to Telegram...');
                    await telegram.sendStatusMessage(`Backtest complete: Found ${relevantTweets.length} relevant tweets from ${allTweets.length} total`);
                    await telegram.sendBatchAlert(relevantTweets);
                    console.log('Sent to Telegram!');
                }
            }
        } else {
            console.log('\nLLM filtering disabled. All tweets would be sent.');
        }

    } catch (error) {
        console.error('Error during backtest:', error);
    }

    console.log('\nBacktest complete!');
}

runBacktest().catch(console.error);
