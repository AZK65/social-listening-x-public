import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';

class Storage {
    constructor() {
        this.seenTweets = new Set();
        this.filePath = config.paths.seenTweets;
    }

    async init() {
        try {
            // Ensure data directory exists
            const dir = path.dirname(this.filePath);
            await fs.mkdir(dir, { recursive: true });

            // Load existing seen tweets
            const data = await fs.readFile(this.filePath, 'utf-8');
            const parsed = JSON.parse(data);
            this.seenTweets = new Set(parsed.tweetIds || []);
            console.log(`Loaded ${this.seenTweets.size} previously seen tweets`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log('No existing seen tweets file, starting fresh');
                this.seenTweets = new Set();
            } else {
                console.error('Error loading seen tweets:', error.message);
                this.seenTweets = new Set();
            }
        }
    }

    hasSeen(tweetId) {
        return this.seenTweets.has(tweetId);
    }

    markAsSeen(tweetId) {
        this.seenTweets.add(tweetId);
    }

    filterNewTweets(tweets) {
        return tweets.filter(tweet => !this.hasSeen(tweet.id));
    }

    async save() {
        try {
            const dir = path.dirname(this.filePath);
            await fs.mkdir(dir, { recursive: true });

            const data = {
                tweetIds: Array.from(this.seenTweets),
                lastUpdated: new Date().toISOString(),
                count: this.seenTweets.size,
            };

            await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
            console.log(`Saved ${this.seenTweets.size} seen tweets`);
        } catch (error) {
            console.error('Error saving seen tweets:', error.message);
        }
    }

    // Clean up old tweet IDs to prevent unbounded growth
    // Keeps the most recent entries based on insertion order
    async cleanup(maxEntries = 10000) {
        if (this.seenTweets.size > maxEntries) {
            const entries = Array.from(this.seenTweets);
            const toKeep = entries.slice(-maxEntries);
            this.seenTweets = new Set(toKeep);
            console.log(`Cleaned up storage, kept ${this.seenTweets.size} recent entries`);
            await this.save();
        }
    }
}

// Cookies storage for maintaining X session
class CookieStorage {
    constructor() {
        this.filePath = config.paths.cookies;
    }

    async load() {
        try {
            const data = await fs.readFile(this.filePath, 'utf-8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error('Error loading cookies:', error.message);
            }
            return null;
        }
    }

    async save(cookies) {
        try {
            const dir = path.dirname(this.filePath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(this.filePath, JSON.stringify(cookies, null, 2));
            console.log('Cookies saved successfully');
        } catch (error) {
            console.error('Error saving cookies:', error.message);
        }
    }
}

export const storage = new Storage();
export const cookieStorage = new CookieStorage();
