import { config } from './config.js';
import { telegram } from './telegram.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

class LLMFilter {
    constructor() {
        this.apiKey = process.env.OPENROUTER_API_KEY;
        this.model = config.llm?.model || 'moonshotai/kimi-k2';
        this.enabled = !!this.apiKey;
        this.batchSize = 10; // Process 10 tweets per API call
        this.feedbackExamples = null;
    }

    async loadFeedbackExamples() {
        if (!this.feedbackExamples) {
            this.feedbackExamples = await telegram.getFeedbackExamples(5, 5);
        }
        return this.feedbackExamples;
    }

    buildFewShotSection(examples) {
        let section = '';

        if (examples.good.length > 0) {
            section += '\n\n--- EXAMPLES OF GOOD LEADS (based on your feedback) ---\n';
            examples.good.forEach((t, i) => {
                section += `GOOD ${i + 1}. @${t.username}: "${t.content}"\n`;
            });
        }

        if (examples.bad.length > 0) {
            section += '\n\n--- EXAMPLES OF NOT RELEVANT (based on your feedback) ---\n';
            examples.bad.forEach((t, i) => {
                section += `BAD ${i + 1}. @${t.username}: "${t.content}"\n`;
            });
        }

        if (section) {
            section += '\n--- END OF EXAMPLES ---\n';
            section += 'Use these examples to better understand what I consider good vs bad leads.\n';
        }

        return section;
    }

    async filterBatch(tweets) {
        if (tweets.length === 0) return [];

        const tweetList = tweets.map((t, i) =>
            `${i + 1}. @${t.username}: "${t.content}"`
        ).join('\n\n');

        // Load feedback examples for few-shot learning
        const examples = await this.loadFeedbackExamples();
        const fewShotSection = this.buildFewShotSection(examples);

        const prompt = `You are an EXTREMELY STRICT B2B lead-qualification engine for X (Twitter).
You work for Apptics, which helps E-COMMERCE MERCHANTS with:
- Payment processing failures
- Payout holds / account shutdowns
- Subscription billing issues (Shopify Subscriptions or other e-com subscription stacks)

Your goal is to surface ONLY high-intent MERCHANT leads.
False positives are worse than false negatives.
${fewShotSection}
${tweetList}

✅ MARK AS RELEVANT ONLY IF ALL CONDITIONS ARE MET:

1️⃣ Merchant Ownership Signal (REQUIRED)
At least ONE explicit first-person signal proving they run a business:
"my Shopify store", "our store", "my shop", "my e-commerce business", "we sell online", "running a brand", "store owner here", "our subscribers / customers"
Implied ownership is NOT enough. If ownership is unclear → REJECT

2️⃣ Platform Context (REQUIRED)
The merchant must reference:
A. Shopify (Shopify, Shopify Payments, Shopify Subscriptions, Payouts/balance/risk review)
OR
B. Non-Shopify E-commerce with Subscriptions (subscription store, recurring billing, subscribers being charged, failed renewals, billing system breaking revenue)
⚠️ SaaS subscriptions ≠ e-commerce subscriptions. If it's software/SaaS (Notion, Netflix, apps, tools) → REJECT

3️⃣ Business-Impacting Problem (REQUIRED)
They must describe a real operational issue:
Payments disabled/blocked, funds held/payouts frozen, account under review/terminated, subscription renewals failing, customers unable to be charged, processor shutdown affecting cash flow
Generic frustration or "payments are annoying" → REJECT

❌ AUTOMATIC REJECT (NO EXCEPTIONS):
- Buyer/consumer perspective ("I can't pay", "my card failed")
- Complaints about subscriptions they pay for
- No explicit business ownership language
- Third-person commentary or news
- Ads, promotions, growth threads
- Crypto, betting, gambling, NFTs
- Hypothetical or educational posts
- Non-English posts
- Ambiguous context where merchant status is assumed but not stated

🧠 FINAL DECISION: "Would I confidently DM this person offering help with payment processing?"
If not a strong YES → REJECT. When in doubt → REJECT.

For each post:
[number]. RELEVANT or REJECT`;

        try {
            const response = await fetch(OPENROUTER_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://github.com/social-listening-x',
                    'X-Title': 'Social Listening X',
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 1000,
                    temperature: 0.3,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`LLM API error: ${response.status} - ${errorText}`);
                return tweets; // On error, let all tweets through
            }

            const data = await response.json();
            const message = data.choices?.[0]?.message;
            const answer = message?.content?.trim() || '';
            const reasoning = message?.reasoning_content || message?.reasoning || '';

            // Log raw response structure for debugging
            console.log(`\nLLM response keys: ${Object.keys(message || {}).join(', ')}`);

            // Log thinking/reasoning if available (from thinking models)
            if (reasoning) {
                console.log(`\n--- LLM Thinking ---`);
                // Truncate reasoning to avoid log spam, show first 500 chars
                const reasoningPreview = reasoning.length > 500 ? reasoning.substring(0, 500) + '...' : reasoning;
                console.log(reasoningPreview);
                console.log(`--- End Thinking ---\n`);
            }

            // The answer contains the actual RELEVANT/REJECT decisions
            // For thinking models, reasoning is separate and answer has the decisions
            // Try to parse from answer first, fall back to reasoning if answer is empty
            const textToParse = answer || reasoning;

            console.log(`\n--- LLM Decision ---`);
            console.log(textToParse || '(empty response)');
            console.log(`--- End Decision ---\n`);

            if (!textToParse || textToParse.toUpperCase() === 'NONE') {
                console.log('LLM returned empty or NONE - letting all tweets through as fallback');
                return tweets;
            }

            // Parse the response - find lines with RELEVANT
            const lines = textToParse.split('\n').filter(l => l.trim());
            const relevantIndices = [];
            for (const line of lines) {
                // Match lines that have a number followed by RELEVANT (but not REJECT/NOT RELEVANT)
                const numMatch = line.match(/^[\s]*(\d+)/);
                if (numMatch) {
                    const lineUpper = line.toUpperCase();
                    const isRelevant = lineUpper.includes('RELEVANT') && !lineUpper.includes('REJECT') && !lineUpper.includes('NOT RELEVANT');
                    const icon = isRelevant ? '✅' : '❌';
                    console.log(`${icon} ${line.trim()}`);
                    if (isRelevant) {
                        const idx = parseInt(numMatch[1]) - 1;
                        if (idx >= 0 && idx < tweets.length) {
                            relevantIndices.push(idx);
                        }
                    }
                }
            }

            // Log summary with tweet details
            console.log(`\nBatch result: ${relevantIndices.length}/${tweets.length} passed`);
            for (const idx of relevantIndices) {
                const snippet = tweets[idx].content.length > 80 ? tweets[idx].content.substring(0, 80) + '...' : tweets[idx].content;
                console.log(`  ✅ @${tweets[idx].username}: "${snippet}"`);
            }

            return relevantIndices.map(i => tweets[i]);
        } catch (error) {
            console.error('LLM filter error:', error.message);
            return tweets; // On error, let all tweets through
        }
    }

    async filterTweets(tweets) {
        if (!this.enabled) {
            console.log('LLM filtering disabled, passing all tweets');
            return tweets;
        }

        if (tweets.length === 0) return [];

        // Reload feedback examples each run to pick up new feedback
        this.feedbackExamples = null;
        const examples = await this.loadFeedbackExamples();
        const totalExamples = examples.good.length + examples.bad.length;

        console.log(`\nFiltering ${tweets.length} tweets with LLM (${this.model}) in batches of ${this.batchSize}...`);
        if (totalExamples > 0) {
            console.log(`Using ${examples.good.length} good + ${examples.bad.length} bad feedback examples for few-shot learning`);
        }

        const results = [];

        // Process in batches
        for (let i = 0; i < tweets.length; i += this.batchSize) {
            const batch = tweets.slice(i, i + this.batchSize);
            console.log(`Processing batch ${Math.floor(i / this.batchSize) + 1}/${Math.ceil(tweets.length / this.batchSize)} (${batch.length} tweets)`);

            const relevantTweets = await this.filterBatch(batch);
            results.push(...relevantTweets);

            // Small delay between batches
            if (i + this.batchSize < tweets.length) {
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }

        console.log(`LLM filter: ${results.length}/${tweets.length} tweets passed`);
        return results;
    }
}

export const llmFilter = new LLMFilter();
