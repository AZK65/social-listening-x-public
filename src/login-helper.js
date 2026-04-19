import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { cookieStorage } from './storage.js';
import readline from 'readline';

// Add stealth plugin to evade detection
puppeteer.use(StealthPlugin());

async function captureLoginSession() {
    console.log('Opening browser for X login (with stealth mode)...\n');

    const browser = await puppeteer.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-infobars',
            '--window-size=1280,800',
        ],
        defaultViewport: { width: 1280, height: 800 },
    });

    const page = await browser.newPage();

    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    console.log('Navigating to x.com...');
    await page.goto('https://x.com', { waitUntil: 'networkidle2', timeout: 60000 });

    console.log('\n===========================================');
    console.log('Browser is open!');
    console.log('');
    console.log('1. Click "Sign in" on the page');
    console.log('2. Log in with your credentials');
    console.log('3. Wait until you see your home feed');
    console.log('4. Come back here and press ENTER');
    console.log('===========================================\n');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    await new Promise(resolve => {
        rl.question('Press ENTER after you are logged in: ', () => {
            rl.close();
            resolve();
        });
    });

    console.log('\nSaving cookies...');

    const cookies = await page.cookies();

    if (cookies.length === 0) {
        console.log('Warning: No cookies found.');
    } else {
        // Convert Puppeteer cookies to Playwright format
        const playwrightCookies = cookies.map(c => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            expires: c.expires,
            httpOnly: c.httpOnly,
            secure: c.secure,
            sameSite: c.sameSite === 'Lax' ? 'Lax' : c.sameSite === 'Strict' ? 'Strict' : 'None',
        }));

        await cookieStorage.save(playwrightCookies);
        console.log(`Saved ${cookies.length} cookies`);

        const authCookies = cookies.filter(c =>
            c.name.includes('auth') ||
            c.name.includes('ct0') ||
            c.name.includes('twid')
        );
        console.log(`Auth-related cookies: ${authCookies.length}`);
    }

    console.log('\nSession saved! You can now run: npm run backtest');

    await browser.close();
    process.exit(0);
}

captureLoginSession().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
