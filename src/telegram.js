import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs/promises';
import { config } from './config.js';

class TelegramNotifier {
    constructor() {
        this.bot = null;
        this.chatId = config.telegram.chatId;
        this.initialized = false;
        this.feedbackFile = './data/feedback.json';
    }

    init() {
        if (!config.telegram.botToken) {
            console.error('TELEGRAM_BOT_TOKEN not set in environment variables');
            return false;
        }

        if (!config.telegram.chatId) {
            console.error('TELEGRAM_CHAT_ID not set in environment variables');
            return false;
        }

        try {
            // Enable polling to receive button callbacks
            this.bot = new TelegramBot(config.telegram.botToken, { polling: true });
            this.initialized = true;
            console.log('Telegram bot initialized with polling');

            // Set up callback handler for thumbs up/down
            this.bot.on('callback_query', async (query) => {
                await this.handleFeedback(query);
            });

            // Set up message handler for manual tweet submissions
            this.bot.on('message', async (msg) => {
                await this.handleManualTweet(msg);
            });

            return true;
        } catch (error) {
            console.error('Failed to initialize Telegram bot:', error.message);
            return false;
        }
    }

    async handleFeedback(query) {
        const data = query.data; // Format: "good:tweetId" or "bad:tweetId"
        const [rating, tweetId] = data.split(':');

        try {
            // Extract tweet content from the message
            const messageText = query.message.text || '';
            const usernameMatch = messageText.match(/@(\w+)/);
            const contentMatch = messageText.match(/📝 ([\s\S]*?)(?=\n\n🔗)/);

            const tweetData = {
                id: tweetId,
                username: usernameMatch ? usernameMatch[1] : 'unknown',
                content: contentMatch ? contentMatch[1].trim() : '',
                timestamp: new Date().toISOString(),
            };

            // Load existing feedback
            let feedback = { good: [], bad: [] };
            try {
                const existing = await fs.readFile(this.feedbackFile, 'utf-8');
                feedback = JSON.parse(existing);
            } catch (e) {
                // File doesn't exist yet
            }

            // Add feedback with full tweet data
            if (rating === 'good') {
                // Remove if already exists (by ID)
                feedback.good = feedback.good.filter(t => t.id !== tweetId);
                feedback.good.push(tweetData);
                // Remove from bad if it was there
                feedback.bad = feedback.bad.filter(t => t.id !== tweetId);
            } else if (rating === 'bad') {
                // Remove if already exists (by ID)
                feedback.bad = feedback.bad.filter(t => t.id !== tweetId);
                feedback.bad.push(tweetData);
                // Remove from good if it was there
                feedback.good = feedback.good.filter(t => t.id !== tweetId);
            }

            // Keep only last 50 examples of each type
            feedback.good = feedback.good.slice(-50);
            feedback.bad = feedback.bad.slice(-50);

            // Save feedback
            await fs.writeFile(this.feedbackFile, JSON.stringify(feedback, null, 2));

            // Acknowledge the button press
            const emoji = rating === 'good' ? '👍' : '👎';
            await this.bot.answerCallbackQuery(query.id, {
                text: rating === 'good' ? '👍 Saved as good lead!' : '👎 Removed!',
            });

            if (rating === 'bad') {
                // Delete the message entirely
                try {
                    await this.bot.deleteMessage(query.message.chat.id, query.message.message_id);
                } catch (e) {
                    // If delete fails, just edit it
                    try {
                        await this.bot.editMessageText('❌ Removed - not relevant', {
                            chat_id: query.message.chat.id,
                            message_id: query.message.message_id,
                        });
                    } catch (e2) {
                        // Message might be too old
                    }
                }
            } else {
                // Good lead - update message to show feedback
                try {
                    const originalText = query.message.text;
                    const updatedText = originalText + `\n\n✅ Good Lead`;
                    await this.bot.editMessageText(updatedText, {
                        chat_id: query.message.chat.id,
                        message_id: query.message.message_id,
                    });
                } catch (e) {
                    // Message might be too old to edit
                }
            }

            console.log(`Feedback recorded: ${rating} for tweet ${tweetId} - will improve LLM filtering`);
        } catch (error) {
            console.error('Error handling feedback:', error.message);
            await this.bot.answerCallbackQuery(query.id, {
                text: 'Error saving feedback',
            });
        }
    }

    formatTweetWithProfile(tweet) {
        const timestamp = tweet.timestamp
            ? new Date(tweet.timestamp).toLocaleString()
            : 'Unknown time';

        // Build profile section
        let profileInfo = '';
        if (tweet.followers || tweet.bio) {
            profileInfo = '\n📊 Profile:';
            if (tweet.followers) {
                profileInfo += `\n   • Followers: ${tweet.followers}`;
            }
            if (tweet.following) {
                profileInfo += `\n   • Following: ${tweet.following}`;
            }
            if (tweet.bio) {
                const shortBio = tweet.bio.length > 100 ? tweet.bio.substring(0, 100) + '...' : tweet.bio;
                profileInfo += `\n   • Bio: ${shortBio}`;
            }
        }

        const message = `
🔔 New Lead Alert

👤 @${tweet.username} ${tweet.displayName ? `(${tweet.displayName})` : ''}
${profileInfo}

📝 ${tweet.content}

🔗 ${tweet.url}
⏰ ${timestamp}
🔍 Query: "${tweet.matchedQuery}"
        `.trim();

        return message;
    }

    async sendTweetAlert(tweet) {
        if (!this.initialized) {
            console.error('Telegram bot not initialized');
            return false;
        }

        try {
            const message = this.formatTweetWithProfile(tweet);

            // Create inline keyboard with thumbs up/down buttons
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '👍 Good Lead', callback_data: `good:${tweet.id}` },
                        { text: '👎 Not Relevant', callback_data: `bad:${tweet.id}` },
                    ],
                ],
            };

            await this.bot.sendMessage(this.chatId, message, {
                reply_markup: keyboard,
                disable_web_page_preview: false,
            });

            console.log(`Sent alert for tweet from @${tweet.username}`);
            return true;
        } catch (error) {
            console.error('Failed to send Telegram message:', error.message);
            return false;
        }
    }

    async sendBatchAlert(tweets) {
        if (!this.initialized || tweets.length === 0) return;

        const summaryMessage = `📊 Found ${tweets.length} new lead(s) matching your queries`;

        try {
            await this.bot.sendMessage(this.chatId, summaryMessage);
        } catch (error) {
            console.error('Failed to send summary message:', error.message);
        }

        for (const tweet of tweets) {
            await this.sendTweetAlert(tweet);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    async sendStatusMessage(message) {
        if (!this.initialized) return;

        try {
            await this.bot.sendMessage(this.chatId, `ℹ️ ${message}`);
        } catch (error) {
            console.error('Failed to send status message:', error.message);
        }
    }

    async sendErrorMessage(error) {
        if (!this.initialized) return;

        try {
            await this.bot.sendMessage(this.chatId, `⚠️ Error: ${error}`);
        } catch (error) {
            console.error('Failed to send error message:', error.message);
        }
    }

    async getFeedbackStats() {
        try {
            const data = await fs.readFile(this.feedbackFile, 'utf-8');
            const feedback = JSON.parse(data);
            return {
                goodCount: feedback.good?.length || 0,
                badCount: feedback.bad?.length || 0,
                good: feedback.good || [],
                bad: feedback.bad || [],
            };
        } catch (e) {
            return { goodCount: 0, badCount: 0, good: [], bad: [] };
        }
    }

    async handleManualTweet(msg) {
        const text = msg.text || '';

        // Check if it's a tweet URL
        const tweetUrlMatch = text.match(/(?:twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/);
        if (!tweetUrlMatch) return; // Not a tweet URL, ignore

        const username = tweetUrlMatch[1];
        const tweetId = tweetUrlMatch[2];

        try {
            // Load existing feedback
            let feedback = { good: [], bad: [] };
            try {
                const existing = await fs.readFile(this.feedbackFile, 'utf-8');
                feedback = JSON.parse(existing);
            } catch (e) {
                // File doesn't exist yet
            }

            // Check if already exists
            const alreadyExists = feedback.good.some(t => t.id === tweetId);
            if (alreadyExists) {
                await this.bot.sendMessage(msg.chat.id, `Already have this tweet from @${username} as a good example.`);
                return;
            }

            // Add as good example (we'll fetch content if possible, otherwise just store the URL)
            const tweetData = {
                id: tweetId,
                username: username,
                content: `[Manual submission - tweet URL: x.com/${username}/status/${tweetId}]`,
                timestamp: new Date().toISOString(),
                manual: true,
            };

            feedback.good.push(tweetData);
            feedback.good = feedback.good.slice(-50); // Keep last 50

            await fs.writeFile(this.feedbackFile, JSON.stringify(feedback, null, 2));

            await this.bot.sendMessage(msg.chat.id,
                `✅ Added @${username}'s tweet as a good lead example!\n\n` +
                `Total good examples: ${feedback.good.length}\n` +
                `Total bad examples: ${feedback.bad.length}\n\n` +
                `This will improve future LLM filtering.`
            );

            console.log(`Manual tweet added as good example: @${username} - ${tweetId}`);
        } catch (error) {
            console.error('Error handling manual tweet:', error.message);
            await this.bot.sendMessage(msg.chat.id, `Error saving tweet: ${error.message}`);
        }
    }

    async getFeedbackExamples(maxGood = 5, maxBad = 5) {
        try {
            const data = await fs.readFile(this.feedbackFile, 'utf-8');
            const feedback = JSON.parse(data);

            // Get recent examples with content
            const goodExamples = (feedback.good || [])
                .filter(t => t.content) // Only ones with content
                .slice(-maxGood);

            const badExamples = (feedback.bad || [])
                .filter(t => t.content)
                .slice(-maxBad);

            return { good: goodExamples, bad: badExamples };
        } catch (e) {
            return { good: [], bad: [] };
        }
    }

    stopPolling() {
        if (this.bot) {
            this.bot.stopPolling();
        }
    }
}

export const telegram = new TelegramNotifier();
