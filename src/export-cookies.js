/**
 * Manual Cookie Export Helper
 *
 * Since automated login is being blocked by X, you can manually export cookies:
 *
 * 1. Open Chrome and go to x.com
 * 2. Make sure you're logged in
 * 3. Open DevTools (F12 or Cmd+Option+I)
 * 4. Go to Application tab > Cookies > https://x.com
 * 5. Copy the following cookies and paste them below:
 *    - auth_token
 *    - ct0
 *    - twid (if present)
 *
 * Then run: node src/export-cookies.js
 */

import fs from 'fs/promises';

// PASTE YOUR COOKIES HERE
const manualCookies = [
    {
        name: 'auth_token',
        value: 'PASTE_YOUR_AUTH_TOKEN_HERE',
        domain: '.x.com',
        path: '/',
        secure: true,
        httpOnly: true,
    },
    {
        name: 'ct0',
        value: 'PASTE_YOUR_CT0_HERE',
        domain: '.x.com',
        path: '/',
        secure: true,
        httpOnly: false,
    },
];

async function saveCookies() {
    if (manualCookies[0].value === 'PASTE_YOUR_AUTH_TOKEN_HERE') {
        console.log(`
===========================================
MANUAL COOKIE EXPORT INSTRUCTIONS
===========================================

1. Open Chrome and go to https://x.com
2. Make sure you're logged in
3. Open DevTools (Cmd+Option+I on Mac, F12 on Windows)
4. Go to: Application tab > Storage > Cookies > https://x.com
5. Find these cookies and copy their values:
   - auth_token
   - ct0

6. Edit this file (src/export-cookies.js) and paste the values

7. Run again: node src/export-cookies.js
===========================================
        `);
        return;
    }

    await fs.writeFile('./data/cookies.json', JSON.stringify(manualCookies, null, 2));
    console.log('Cookies saved to data/cookies.json');
    console.log('You can now run: npm run backtest');
}

saveCookies().catch(console.error);
