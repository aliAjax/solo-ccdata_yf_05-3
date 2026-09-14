import {chromium} from 'playwright';
const BASE = 'http://localhost:5199';
const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1500, height: 1000}});
await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
await page.route('https://fonts.gstatic.com/**', (r) => r.abort());

const setTreeAll = async (want) => {
  const btn = page.locator('.tree-toolbar button');
  for (let i = 0; i < 3; i++) {
    const label = await btn.innerText();
    if ((want === 'expand' && label === '全部展开') || (want === 'collapse' && label === '全部折叠')) {
      await btn.click(); await page.waitForTimeout(150); return;
    }
    await btn.click(); await page.waitForTimeout(150);
  }
};

await page.goto(BASE, {waitUntil: 'load'});
await page.waitForSelector('.tree-row');
await setTreeAll('expand');
await page.waitForTimeout(300);
await page.screenshot({path: '/tmp/audit-ecosystem.png'});

await page.locator('.ds', {hasText: '当前工作区'}).click();
await page.waitForTimeout(300);
await setTreeAll('collapse');
await page.waitForTimeout(200);
// 截工作区折叠态
await page.screenshot({path: '/tmp/audit-workspace.png'});

// 打开锁定复核抽屉截图
await page.locator('.ds', {hasText: '真实生态示例'}).click();
await page.waitForTimeout(200);
await page.locator('.tree-row', {hasText: 'ffmpeg-static'}).first().locator('.lock-btn').click();
await page.locator('.review-entry').click();
await page.waitForTimeout(300);
await page.screenshot({path: '/tmp/audit-review.png'});

await browser.close();
console.log('shots done');
