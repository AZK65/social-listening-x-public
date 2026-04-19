import 'dotenv/config';

export const config = {
    // Telegram Configuration
    telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        chatId: process.env.TELEGRAM_CHAT_ID,
    },

    // Search Queries - payment issues + subscription pain (running every 3 hours to save costs)
    searchQueries: [
        // Brand mentions
        'Apptics',
        '@apptics',

        // SHOPIFY PAYMENT ISSUES - proven to find leads
        'Shopify payments disabled',
        'Shopify payments banned',
        'Shopify Payments account disabled',
        'money stuck Shopify payments',
        'Shopify payments under review',
        'Shopify payments terminated',

        // LOOKING FOR ALTERNATIVES
        'best payment processor Shopify',
        'payment processor recommendations Shopify',
        'alternative to Shopify payments',

        // SUBSCRIPTION PAIN - keeping in case they find leads
        'subscription churn Shopify',
        'Recharge app churn',
        'subscription box struggling',
        'recurring revenue Shopify problem',
        'Shopify subscriptions not working',
        'subscribers keep canceling',

        // MENTIONS OF SHOPIFY SUPPORT ACCOUNTS - merchants complaining directly
        '@ShopifySupport banned',
        '@ShopifySupport payments disabled',
        '@ShopifySupport payouts',
        '@Shopify store banned',
    ],

    // Scraper Settings
    scraper: {
        // Maximum tweets to fetch per query per run
        maxTweetsPerQuery: 50,

        // Scroll attempts to load more tweets (each scroll loads ~10-20 tweets)
        maxScrolls: 2,

        // Delay between actions (ms) - helps avoid rate limiting
        actionDelay: 1000,

        // Headless mode - set to false to see the browser (useful for debugging)
        headless: true,

        // User agent to use
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },

    // Scheduling
    schedule: {
        // Cron expression - every 3 hours (8 runs/day instead of 24)
        // '0 */3 * * *' = at minute 0 every 3rd hour
        cronExpression: '0 */3 * * *',

        // Run immediately on startup (before first scheduled run)
        runOnStartup: true,
    },

    // Storage paths
    paths: {
        seenTweets: './data/seen_tweets.json',
        cookies: './data/cookies.json',
    },

    // LLM Configuration (for smart filtering)
    llm: {
        enabled: true,
        model: 'moonshotai/kimi-k2-thinking', // Back to Kimi K2 Thinking - better quality
    },
};
