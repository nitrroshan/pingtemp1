#!/usr/bin/env node
/**
 * Quick screenshot script using Playwright
 * Run: npx playwright test scripts/screenshot.mjs --headed
 * Or:  node scripts/screenshot.mjs
 */
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3000';
const OUT_DIR = 'docs/features/screenshots';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Screenshot 1: Landing / Login
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT_DIR}/01-landing.png`, fullPage: false });
  console.log('✓ 01-landing.png');

  // Screenshot 2: Try to navigate to a team
  await page.goto(`${BASE_URL}/teams`, { waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT_DIR}/02-teams.png`, fullPage: false });
  console.log('✓ 02-teams.png');

  // Screenshot 3: Chat view (if accessible)
  const teamLinks = await page.locator('a[href*="/teams/"]').all();
  if (teamLinks.length > 0) {
    await teamLinks[0].click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${OUT_DIR}/03-chat.png`, fullPage: false });
    console.log('✓ 03-chat.png');
  }

  // Screenshot 4: Tasks view
  const tasksLink = page.locator('text=Tasks').first();
  if (await tasksLink.isVisible().catch(() => false)) {
    await tasksLink.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUT_DIR}/04-tasks.png`, fullPage: false });
    console.log('✓ 04-tasks.png');
  }

  // Screenshot 5: Discussions view
  const discussLink = page.locator('text=Discussions').first();
  if (await discussLink.isVisible().catch(() => false)) {
    await discussLink.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUT_DIR}/05-discussions.png`, fullPage: false });
    console.log('✓ 05-discussions.png');
  }

  await browser.close();
  console.log(`\nDone. Screenshots saved to ${OUT_DIR}/`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
