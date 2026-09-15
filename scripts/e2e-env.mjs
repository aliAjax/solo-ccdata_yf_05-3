// 端到端运行环境自举：干净容器里没有 root 也能跑通 Chromium。
//  1) playwright 浏览器缺失时执行 `npx playwright install chromium`；
//  2) 浏览器因系统库缺失启动失败时，用 apt-get（空 dpkg status + 临时缓存，无需 root）
//     下载完整依赖闭包并解包到本地目录，再以 LD_LIBRARY_PATH 重启；
//  3) 顺带解包 Noto CJK 字体（截图中文用，失败不阻断）。
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'node_modules', '.cache', 'pw-env');

function osRelease() {
  const info = {};
  try {
    for (const line of readFileSync('/etc/os-release', 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
      if (m) info[m[1]] = m[2];
    }
  } catch { /* 非 Linux 容器 */ }
  return info;
}

// Debian/Ubuntu t64 过渡的包名差异
function runtimePackages() {
  const info = osRelease();
  const t64 = info.VERSION_CODENAME === 'noble' ||
    (info.ID === 'ubuntu' && /^2[4-9]\./.test(info.VERSION_ID || ''));
  return [
    'libnspr4', 'libnss3', 'libdrm2', 'libxkbcommon0', 'libxcomposite1', 'libxdamage1',
    'libxfixes3', 'libxrandr2', 'libgbm1', 'libwayland-client0', 'libwayland-server0',
    'libpangocairo-1.0-0', 'libxcursor1', 'libxss1', 'libdbus-1-3', 'libfontconfig1',
    t64 ? 'libatk1.0-0t64' : 'libatk1.0-0',
    t64 ? 'libatk-bridge2.0-0t64' : 'libatk-bridge2.0-0',
    t64 ? 'libcups2t64' : 'libcups2',
    t64 ? 'libasound2t64' : 'libasound2',
    t64 ? 'libatspi2.0-0t64' : 'libatspi2.0-0',
    'libgtk-3-0',
  ];
}

function downloadClosure(packages) {
  const lists = join(CACHE, 'apt-lists');
  const aptCache = join(CACHE, 'apt-cache');
  const status = join(CACHE, 'dpkg-status');
  mkdirSync(join(lists, 'partial'), {recursive: true});
  mkdirSync(join(aptCache, 'archives', 'partial'), {recursive: true});
  writeFileSync(status, '');

  // 干净镜像的包索引可能为空：用临时索引目录 update（无需 root）
  let hasIndex = false;
  try {
    hasIndex = readdirSync(lists).some((f) => f.endsWith('_Packages') || f.includes('_Packages_'));
  } catch { /* ignore */ }
  if (!hasIndex) {
    console.log('[e2e-env] 更新 apt 包索引（临时目录，无需 root）…');
    execSync(`apt-get -o Dir::State::Lists=${lists} -o Dir::Cache=${aptCache} update`, {stdio: 'inherit'});
  }

  console.log(`[e2e-env] 下载 ${packages.length} 个运行库及其完整依赖闭包（apt，无需 root）…`);
  execSync(
    `apt-get -o Dir::State::status=${status} -o Dir::State::Lists=${lists} ` +
    `-o Dir::Cache=${aptCache} install --download-only --no-install-recommends -y ${packages.join(' ')}`,
    {stdio: 'inherit'},
  );
  const root = join(CACHE, 'sysroot');
  mkdirSync(root, {recursive: true});
  for (const deb of readdirSync(join(aptCache, 'archives')).filter((f) => f.endsWith('.deb'))) {
    execSync(`dpkg-deb -x ${join(aptCache, 'archives', deb)} ${root}`, {stdio: 'ignore'});
  }
  return root;
}

function collectLibDirs(root) {
  const dirs = new Set();
  const walk = (d) => {
    let entries = [];
    try { entries = readdirSync(d, {withFileTypes: true}); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.so') || e.name.includes('.so.')) dirs.add(d);
    }
  };
  for (const base of [join(root, 'usr', 'lib'), join(root, 'lib'), join(root, 'usr', 'libexec')]) walk(base);
  return [...dirs];
}

function registerFonts(root) {
  try {
    const fontDir = join(process.env.HOME || '/tmp', '.fonts');
    mkdirSync(fontDir, {recursive: true});
    const fonts = [];
    const walk = (d) => {
      for (const e of readdirSync(d, {withFileTypes: true})) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ttc|otf|ttf)$/.test(e.name) && /noto/i.test(e.name)) fonts.push(p);
      }
    };
    walk(join(root, 'usr', 'share', 'fonts'));
    for (const f of fonts) {
      try { symlinkSync(f, join(fontDir, f.split('/').pop())); } catch { /* 已存在 */ }
    }
    if (fonts.length) execSync(`fc-cache -f ${fontDir}`, {stdio: 'ignore'});
  } catch { /* 没有 fc-cache 也能跑，只是中文截图为方框 */ }
}

/** 返回应传给 chromium.launch({env}) 的环境变量；必要时自动完成环境准备 */
export async function prepareBrowserEnv() {
  // 1) 浏览器二进制
  if (!existsSync(chromium.executablePath())) {
    console.log('[e2e-env] 安装 Playwright Chromium…');
    execSync('npx playwright install chromium', {stdio: 'inherit', cwd: ROOT});
  }

  // 2) 直接试启动
  try {
    const b = await chromium.launch();
    await b.close();
    return process.env;
  } catch (firstErr) {
    const reason = String(firstErr?.message || firstErr);
    const isMissingLib = /shared object|cannot open shared object|error while loading|libnspr|libnss/i.test(reason);
    if (!isMissingLib) throw firstErr;
  }

  // 3) 本地准备运行库闭包（含中文字体）
  console.log('[e2e-env] 系统库缺失，开始本地准备 Chromium 运行库…');
  const root = downloadClosure([...runtimePackages(), 'fonts-noto-cjk']);
  registerFonts(root);
  const env = {
    ...process.env,
    LD_LIBRARY_PATH: [...collectLibDirs(root), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
  };

  // 4) 带本地库再试一次
  try {
    const b = await chromium.launch({env});
    await b.close();
    return env;
  } catch (e) {
    console.error('[e2e-env] 补齐运行库后仍无法启动 Chromium:', e.message);
    throw e;
  }
}
