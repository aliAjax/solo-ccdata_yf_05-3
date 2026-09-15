// 端到端验证：真实浏览器加载审计台，验证渲染、筛选、展开折叠结果不变、锁定复核、刷新恢复。
// 自包含：自动准备浏览器运行库（无 root 亦可），自行启动 vite preview，结束后清理。
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {prepareBrowserEnv, ROOT} from './e2e-env.mjs';

// 监听与探测统一走显式 IPv4 回环，避免 localhost 解析到 ::1 而 vite 只绑 127.0.0.1
const HOST = '127.0.0.1';
const PORT = process.env.E2E_PORT || '5199';
const BASE = `http://${HOST}:${PORT}`;
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? (pass++, console.log(`  \x1b[32m✓\x1b[0m ${n}`)) : (fail++, console.log(`  \x1b[31m✗ ${n}\x1b[0m ${d}`)); };
const group = (t) => console.log(`\n■ ${t}`);

let browser, page, server, serverPid, serverStartedHere = false;

async function waitReady(url, ms = 20000) {
  const t0 = Date.now();
  let lastErr = '';
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch (e) { lastErr = String(e?.message || e); }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.error(`[e2e] 等待 ${url} 就绪超时：${lastErr}`);
  return false;
}

// 检测端口上是否已有服务（允许复用外部已启动的预览）
async function serviceUp() {
  try { const r = await fetch(BASE); return r.ok; } catch { return false; }
}

function startPreview() {
  const viteBin = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  // 直接用 node 启动 vite 入口（不经 npx 包装），并独立进程组，便于退出时整组回收
  const child = spawn(process.execPath, [viteBin, 'preview', '--host', HOST, '--port', PORT, '--strictPort'], {
    cwd: ROOT,
    detached: true, // 新进程组
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d) => process.stdout.write(`[vite] ${d}`));
  child.stderr?.on('data', (d) => process.stderr.write(`[vite] ${d}`));
  serverPid = child.pid;
  return child;
}

function killPreview() {
  if (!serverPid) return;
  try {
    // 杀掉整个独立进程组（npx/包装层 + 真正的 vite 都会被回收）
    try { process.kill(-serverPid, 'SIGTERM'); } catch { /* 组已退出 */ }
    // 兜底：按 PID 终止并强制清理
    setTimeout(() => {
      try { process.kill(-serverPid, 'SIGKILL'); } catch { /* noop */ }
      try { process.kill(serverPid, 'SIGKILL'); } catch { /* noop */ }
    }, 1500).unref();
  } finally {
    serverPid = null;
  }
}

async function main() {
// 自举浏览器环境（自动安装浏览器 / 本地补齐运行库）
const browserEnv = await prepareBrowserEnv();
browser = await chromium.launch({env: browserEnv, args: ['--no-sandbox']});

// 预览服务器：已在该地址运行则复用，否则自启
const distIndex = join(ROOT, 'dist', 'index.html');
if (!existsSync(distIndex)) {
  console.error('缺少 dist/，请先执行 npm run build（npm run e2e 会自动构建）');
  process.exit(2);
}
if (await serviceUp()) {
  console.log(`[e2e] 复用已在 ${BASE} 运行的预览服务`);
} else {
  server = startPreview();
  serverStartedHere = true;
  server.on('exit', (code) => {
    if (code && code !== 0) console.error(`[e2e] vite preview 退出，code=${code}`);
  });
  if (!(await waitReady(BASE))) {
    throw new Error('预览服务器启动失败');
  }
}

page = await browser.newPage({viewport: {width: 1500, height: 950}});
await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
await page.route('https://fonts.gstatic.com/**', (r) => r.abort());
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !t.includes('fonts.') && !t.includes('Failed to load resource')) errors.push(t);
});

// 工具栏按钮按当前文字决定动作，循环最多 3 次把树调到目标状态
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

group('渲染：生态数据集默认加载（折叠态显示根直连）');
await page.waitForSelector('.tree-row');
const collapsedRoots = await page.locator('.tree-row').count();
check('折叠态显示 9 个根直连依赖', collapsedRoots >= 9, String(collapsedRoots));
check('问题面板渲染异常条目', (await page.locator('.issue').count()) >= 8, String(await page.locator('.issue').count()));
check('能看到环路条目', (await page.getByText('依赖环路', {exact: false}).count()) >= 1);
check('能看到自引用条目', (await page.getByText('自引用', {exact: false}).count()) >= 1);
check('能看到缺失目标条目', (await page.getByText('缺失目标', {exact: false}).count()) >= 1);
check('能看到缺失父节点条目', (await page.getByText('缺失父节点', {exact: false}).count()) >= 1);
check('GPL 硬冲突在义务面板', (await page.locator('.conflict.sev-high').count()) >= 1);
check('jszip (MIT OR GPL) 显示 OR 可规避', (await page.getByText('OR 可规避').count()) >= 1);

await setTreeAll('expand');
check('展开后出现共享占位标记', (await page.locator('.marker.shared').count()) >= 2,
  String(await page.locator('.marker.shared').count()));
check('展开后环上节点被标记', (await page.locator('.marker.in-cycle').count()) >= 1);
check('展开后环路回边被截断标记', (await page.locator('.marker.cycle').count()) >= 1,
  String(await page.locator('.marker.cycle').count()));
check('展开后可见两个 debug 版本', (await page.getByText('debug@2.6.9', {exact: false}).count()) >= 1
  && (await page.getByText('debug@4.3.4', {exact: false}).count()) >= 1);
check('缺失目标行在展开树中可见（8 个平台包 + @types/node 等）',
  (await page.locator('.tree-row.missing').count()) >= 8, String(await page.locator('.tree-row.missing').count()));

group('展开/折叠不改变结果');
const statBefore = await page.locator('.stat-card b').allInnerTexts();
const obligBefore = await page.locator('.oblig').count();
const conflictBefore = await page.locator('.conflict').count();
await setTreeAll('collapse');
const rowsCollapsed = await page.locator('.tree-row').count();
await setTreeAll('expand');
const rowsExpanded = await page.locator('.tree-row').count();
const statAfter = await page.locator('.stat-card b').allInnerTexts();
check('统计卡在展开/折叠后完全不变', JSON.stringify(statBefore) === JSON.stringify(statAfter), `${statBefore} vs ${statAfter}`);
check('义务汇总在展开/折叠后完全不变', obligBefore === await page.locator('.oblig').count());
check('冲突列表在展开/折叠后完全不变', conflictBefore === await page.locator('.conflict').count());
check('展开后行数明显多于折叠', rowsExpanded > rowsCollapsed, `${rowsExpanded} vs ${rowsCollapsed}`);

group('筛选：根包 / 深度 / 边类型 / 义务');
await setTreeAll('collapse');
await page.locator('.field').first().locator('select').selectOption('rimraf@3.0.2');
await page.waitForTimeout(100);
check('聚焦 rimraf 后 ffmpeg 行消失', (await page.locator('.tree-row', {hasText: 'ffmpeg'}).count()) === 0);
await setTreeAll('expand');
check('rimraf 子树可见 balanced-match（深路径深度4）', (await page.getByText('balanced-match', {exact: false}).count()) >= 1);
const rimrafRows = await page.locator('.tree-row').count();
await page.locator('.field').nth(1).locator('select').selectOption('2');
await page.waitForTimeout(100);
check('深度截断后可见行数减少', (await page.locator('.tree-row').count()) < rimrafRows);
check('深度截断后 balanced-match 不出现', (await page.getByText('balanced-match', {exact: false}).count()) === 0);
await page.locator('.field').nth(1).locator('select').selectOption('0');
await page.locator('.field').first().locator('select').selectOption('__all');
await setTreeAll('collapse');

await page.locator('button.seg-optional').click();
await page.waitForTimeout(100);
check('只看可选：可见 ffmpeg-static', (await page.locator('.tree-row', {hasText: 'ffmpeg-static'}).count()) >= 1);
check('只看可选：普通包 finalhandler 不出现', (await page.locator('.tree-row', {hasText: 'finalhandler'}).count()) === 0);
await page.locator('.seg button', {hasText: '全部'}).first().click();

await page.locator('.obl-chip', {hasText: '公开衍生源码'}).click();
await page.waitForTimeout(100);
check('义务筛选后树中保留 ffmpeg-static 路径', (await page.getByText('ffmpeg-static', {exact: false}).count()) >= 1);
check('义务筛选后纯 MIT 叶子 ee-first 不出现', (await page.locator('.tree-row', {hasText: 'ee-first'}).count()) === 0);
await page.locator('.obl-chip', {hasText: '公开衍生源码'}).click();

group('节点详情：OR / AND 选项、Apache-2.0 标准义务、多版本、来源链定位');
await setTreeAll('expand');
await page.locator('.tn-name', {hasText: 'JSONStream'}).first().click();
check('JSONStream 详情显示 2 个 OR 选证组合', (await page.locator('.detail-panel .opt').count()) === 2,
  String(await page.locator('.detail-panel .opt').count()));
const detailOblText = await page.locator('.detail-panel .d-obligs').innerText();
check('JSONStream 单证义务含 Apache 的修改声明与专利授权（OR 可规避）',
  detailOblText.includes('专利授权') && detailOblText.includes('声明修改'),
  detailOblText.replace(/\n/g, ' '));
check('JSONStream 版权声明为必然义务（不带可规避标记）',
  await page.locator('.detail-panel .d-obligs .do.must', {hasText: '版权声明'}).count() === 1);
// 义务面板：Apache-2.0（caseless）的专利授权不能被漏掉
check('义务汇总含专利授权（Apache-2.0）', (await page.locator('.oblig', {hasText: '专利授权'}).count()) === 1);
check('专利授权来源包含 Apache-2.0 的 caseless',
  (await page.locator('.oblig', {hasText: '专利授权'}).locator('.src', {hasText: 'caseless'}).count()) === 1);
await page.locator('.tn-name', {hasText: 'pako'}).first().click();
check('pako (MIT AND Zlib) 只有 1 个组合且两证并列',
  (await page.locator('.detail-panel .opt').count()) === 1 &&
  (await page.locator('.detail-panel .opt .lic-badge').count()) === 2);
await page.locator('.tn-name', {hasText: 'ms@2.1.3'}).first().click();
check('ms 详情显示 2 个版本切换芯片', (await page.locator('.ver-chip').count()) === 2,
  String(await page.locator('.ver-chip').count()));
await page.locator('.ver-chip', {hasText: '2.0.0'}).click();
check('可切换到嵌套安装的 ms@2.0.0', (await page.locator('.detail-id b').innerText()).includes('ms@2.0.0'));
await page.locator('.conflict.sev-high .chain-seg button').first().click();
check('点击 GPL 冲突来源链节点可定位详情', (await page.locator('.detail-id b').count()) === 1);

group('锁定路径与复核结论（经节点详情锁定，验证可选边类型不丢失）');
await page.locator('.tn-name', {hasText: 'ffmpeg-static'}).first().click();
await page.waitForTimeout(80);
await page.locator('.lock-path-btn').click();
await page.waitForTimeout(100);
check('详情锁定按钮变为已锁定态',
  (await page.locator('.lock-path-btn.done').count()) === 1 &&
  (await page.locator('.lock-path-btn').isDisabled()) === true);
await page.locator('.review-entry').click();
await page.waitForSelector('.drawer');
check('锁定路径出现在复核抽屉', (await page.locator('.lock-item').count()) >= 1);
check('默认状态为待复核', (await page.locator('.lock-item .v-unreviewed').count()) >= 1);
// 根→ffmpeg-static 的边必须显示"可选"，不能退化成"普通"
const firstEdgeBadge = page.locator('.ld-node').nth(1).locator('.lk');
check('复核抽屉中 ffmpeg-static 的入边是可选类型（不是普通）',
  (await firstEdgeBadge.count()) === 1 && (await firstEdgeBadge.innerText()) === '可选',
  await firstEdgeBadge.innerText().catch(() => '(missing)'));
check('抽屉内显示该链义务', (await page.locator('.ld-obls .do').count()) >= 1);
check('抽屉内显示该链 GPL 冲突', (await page.locator('.mini-conf').count()) >= 1);
await page.locator('.vbtn.v-reject').click();
check('可下"驳回"结论', (await page.locator('.vbtn.v-reject.on').count()) === 1);
await page.locator('.lock-detail textarea').fill('GPL 与闭源分发冲突，替换为 LGPL 构建。');
await page.locator('.ld-meta input').fill('审计员 Zen');
await page.waitForTimeout(200);
await page.locator('.drawer-head button').click();

group('刷新恢复');
await page.goto(BASE, {waitUntil: 'load'});
await page.waitForSelector('.tree-row');
await page.locator('.review-entry').click();
await page.waitForSelector('.lock-item');
check('刷新后锁定路径仍在', (await page.locator('.lock-item').count()) >= 1);
check('刷新后驳回结论恢复', (await page.locator('.vbtn.v-reject.on').count()) === 1);
check('刷新后备注恢复', await page.locator('.lock-detail textarea').inputValue() === 'GPL 与闭源分发冲突，替换为 LGPL 构建。');
check('刷新后复核人恢复', await page.locator('.ld-meta input').inputValue() === '审计员 Zen');
await page.locator('.drawer-head button').click();

group('切换到真实工作区锁文件');
await page.locator('.ds', {hasText: '当前工作区'}).click();
await page.waitForTimeout(200);
check('工作区根包名显示', (await page.getByText('ccdata-yf-05-license-lens@1.0.0').count()) >= 1);
check('工作区无环路/自引用异常',
  (await page.locator('.issue-tag', {hasText: '环路'}).count()) === 0 &&
  (await page.locator('.issue-tag', {hasText: '自引用'}).count()) === 0);
check('工作区可见 MPL 弱著佐权提示', (await page.getByText('弱著佐权', {exact: false}).count()) >= 1);
await setTreeAll('expand');
check('工作区树含 60+ 节点行', (await page.locator('.tree-row').count()) > 60, String(await page.locator('.tree-row').count()));
check('工作区锁定列表独立（生态的锁定不带入）', (await page.locator('.review-entry .pending').count()) === 0);
await page.screenshot({path: '/tmp/audit-workspace.png'});
await page.locator('.ds', {hasText: '真实生态示例'}).click();
await page.waitForTimeout(200);
await setTreeAll('expand');
await page.screenshot({path: '/tmp/audit-ecosystem.png'});

check('无 JS 运行时错误', errors.length === 0, errors.slice(0, 4).join(' | '));

console.log(`\n${fail === 0 ? '\x1b[32m端到端全部通过\x1b[0m' : '\x1b[31m存在失败\x1b[0m'}：${pass} passed, ${fail} failed`);
return fail ? 1 : 0;
}

// 统一回收：浏览器 + 自启的预览进程组（无论成功、断言失败还是异常）
let exitCode = 1;
try {
  exitCode = await main();
} catch (e) {
  console.error('\x1b[31m[e2e] 中断：\x1b[0m', e?.stack || e);
  exitCode = 2;
} finally {
  try { await page?.close(); } catch { /* noop */ }
  try { await browser?.close(); } catch { /* noop */ }
  if (serverStartedHere) killPreview();
}
process.exit(exitCode);
