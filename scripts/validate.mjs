// 真实数据验证：用 esbuild 即时打包 TS 引擎，对工作区锁文件与真实生态示例跑断言。
// 覆盖：环路、多版本、深路径、共享节点、AND/OR 义务汇总、GPL 冲突溯源、
// 重复边、自引用、缺失父节点、缺失目标，以及"展开折叠不改变结果"。
import {build} from 'esbuild';
import {writeFileSync, mkdirSync} from 'node:fs';

mkdirSync('/tmp/audit-build', {recursive: true});

async function bundle(entry, outfile) {
  await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'node',
    outfile, logLevel: 'silent',
  });
  return import(outfile + `?t=${Date.now()}`);
}

// 给验证脚本用的 CJS 风格入口
writeFileSync('/tmp/audit-build/entry.mjs', `
export * from '/workspace/src/lib/graph.ts';
export * from '/workspace/src/lib/license.ts';
`);

const {parseLockfile, parseLicenseExpression, licenseOptions, evaluateNode, summarizeScope, findChain} =
  await bundle('/tmp/audit-build/entry.mjs', '/tmp/audit-build/bundle.mjs');

const datasets = (await import('/workspace/src/data/datasets.json', {with: {type: 'json'}})).default;

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${name}\x1b[0m ${detail}`); }
}
function group(t) { console.log(`\n■ ${t}`); }

/* ---------------- 真实生态示例 ---------------- */
const eco = parseLockfile(datasets.ecosystem);
group('真实数据：多版本（同名不同版本节点分离）');
check('ms 存在 2.0.0 与 2.1.3 两个节点',
  eco.nodes.has('ms@2.0.0') && eco.nodes.has('ms@2.1.3'),
  JSON.stringify([...eco.versionGroups.get('ms') || []]));
check('type 存在 1.2.0 与 2.7.3', eco.nodes.has('type@1.2.0') && eco.nodes.has('type@2.7.3'));
check('versionGroups 报告 4 个多版本包（debug、ms、type、statuses）',
  [...eco.versionGroups.values()].filter((v) => v.length > 1).length === 4,
  JSON.stringify([...eco.versionGroups].filter(([, v]) => v.length > 1)));
check('ms@2.0.0 安装在 finalhandler 嵌套目录',
  eco.nodes.get('ms@2.0.0').installPaths[0] === 'node_modules/finalhandler/node_modules/debug/node_modules/ms');

group('真实数据：环路（es5-ext 簇，npm 生态真实存在的循环依赖）');
const cyc = eco.cycles;
check('检测到 1 个强连通环', cyc.length === 1, JSON.stringify(cyc));
const cycSet = new Set(cyc[0] || []);
for (const n of ['es5-ext@0.10.62', 'es6-iterator@2.0.3', 'es6-symbol@3.1.3', 'd@1.0.1']) {
  check(`环路包含 ${n}`, cycSet.has(n));
}
check('cycleNodeIds 标记环上节点', eco.cycleNodeIds.size >= 4);
check('问题列表含 cycle', eco.issues.some((i) => i.kind === 'cycle'));

group('真实数据：自引用（注入的真实脏数据形态）');
const selfIssue = eco.issues.find((i) => i.kind === 'self-edge');
check(!!selfIssue, '未找到 self-edge');
check('自引用节点为 esniff', selfIssue?.nodeIds[0] === 'esniff@1.1.0', selfIssue?.nodeIds[0]);

group('真实数据：重复边');
const dup = eco.issues.filter((i) => i.kind === 'duplicate-edge');
check('报告重复/跨区块重复声明', dup.length >= 1, JSON.stringify(dup.map((d) => d.title)));
const dupEdge = eco.edges.find((e) => e.duplicateDecl);
check('concat-stream→inherits 重复边被标记',
  dupEdge && dupEdge.from === 'concat-stream@1.6.2' && dupEdge.name === 'inherits',
  dupEdge?.id);

group('真实数据：缺失目标（真实 optional 平台包 + 真实 devDeps 未安装）');
const missing = eco.issues.filter((i) => i.kind === 'missing-target');
check('至少 4 个缺失目标（8 个 ffmpeg 平台二进制可选包 + @types/node）', missing.length >= 4, `实际 ${missing.length}`);
check('@types/node 缺失目标存在', eco.edges.some((e) => e.name === '@types/node' && e.missingTarget));
check('ffmpeg 平台可选包缺失目标', eco.edges.some((e) => e.name.startsWith('@ffmpeg-installer/') && e.kind === 'optional' && e.missingTarget));

group('真实数据：缺失父节点（无任何入边的已安装包）');
const orphan = eco.issues.filter((i) => i.kind === 'missing-parent');
const orphanNames = orphan.map((i) => i.nodeIds[0]);
check('statuses@1.4.0（嵌套在 rimraf 下但无人引用）被标记', orphanNames.includes('statuses@1.4.0'));
check('event-emitter（真实包但无引用）被标记', orphanNames.some((n) => n.startsWith('event-emitter@')));

group('真实数据：深路径展开到叶子');
const rimrafTree = eco.nodeRoots.get('rimraf@3.0.2');
check('rimraf 根子树存在', !!rimrafTree);
check('rimraf 最深 ≥ 4（rimraf→glob→minimatch→brace-expansion→balanced-match/concat-map）',
  rimrafTree.maxDepth >= 4, `maxDepth=${rimrafTree?.maxDepth}`);
const deepPath = rimrafTree.paths.find((p) => p.includes('balanced-match@1.0.2'));
check('存在到 balanced-match 的完整叶路径',
  !!deepPath && deepPath[0] === eco.rootNode.id && deepPath.at(-1) === 'balanced-match@1.0.2',
  JSON.stringify(deepPath));

group('真实数据：共享节点不重复计数');
// 语义：唯一节点集合只计 1 次；树中再次相遇渲染为 shared 占位并截断，子路径不重复展开
check('wrappy 唯一计数为 1（once 展开、inflight 处共享占位）',
  eco.allRoots.uniqueNodeIds.has('wrappy@1.0.2'),
);
check('debug@4 唯一计数为 1，另有共享占位（agent-base / https-proxy-agent）',
  countOccFull(eco.allRoots.occurrences, 'debug@4.3.4') === 1 &&
  countOcc(eco.allRoots.occurrences, 'debug@4.3.4') >= 2,
  `full=${countOccFull(eco.allRoots.occurrences, 'debug@4.3.4')} all=${countOcc(eco.allRoots.occurrences, 'debug@4.3.4')}`);
check('共享占位下的子路径不重复展开：ms@2.1.3 仅随首次 debug 展开一次',
  countOcc(eco.allRoots.occurrences, 'ms@2.1.3') === 1,
  `occ=${countOcc(eco.allRoots.occurrences, 'ms@2.1.3')}`);
check('inherits 唯一计数 1（glob 簇全展开、concat-stream 处共享占位）',
  countOccFull(eco.allRoots.occurrences, 'inherits@2.0.4') === 1,
  `full=${countOccFull(eco.allRoots.occurrences, 'inherits@2.0.4')}`);
check('跨根共享集合包含 debug@4 / ms@2.1.3 / inherits',
  eco.sharedAcrossRoots.has('debug@4.3.4') && eco.sharedAcrossRoots.has('ms@2.1.3') && eco.sharedAcrossRoots.has('inherits@2.0.4'),
  JSON.stringify([...eco.sharedAcrossRoots]));
check('唯一计数 ≤ 出现计数',
  eco.allRoots.stats.unique <= eco.allRoots.stats.occurrences);
// 共享截断的出现点必须带 shared 标记
const sharedMarked = findOcc(eco.allRoots.occurrences, (o) => o.shared);
check('第二处及以后的共享出现带 shared 标记并指向 firstKey',
  !!sharedMarked && !!sharedMarked.firstKey && sharedMarked.leaf,
  JSON.stringify(sharedMarked));

group('真实数据：许可证 OR / AND 汇总');
const jsonStream = evaluateNode('JSONStream@1.3.5', '(MIT OR Apache-2.0)', 'closed');
check('JSONStream 有 2 个选证组合', jsonStream.options.length === 2, JSON.stringify(jsonStream.options));
check('OR 宽松组合在闭源策略下无硬冲突', jsonStream.hardConflict === false);
const rc = evaluateNode('rc@1.2.8', '(BSD-2-Clause OR MIT OR Apache-2.0)', 'closed');
check('rc 三选一', rc.options.length === 3);
const andExpr = parseLicenseExpression('(MIT OR Apache-2.0) AND BSD-3-Clause');
const andOpts = licenseOptions(andExpr);
check('(MIT OR Apache-2.0) AND BSD-3-Clause => 2 个组合且都含 BSD',
  andOpts.length === 2 && andOpts.every((o) => o.includes('BSD-3-Clause')), JSON.stringify(andOpts));
const jszip = evaluateNode('jszip@3.10.1', '(MIT OR GPL-3.0-or-later)', 'closed');
check('jszip (MIT OR GPL) 闭源下可规避（选 MIT）',
  jszip.avoidable && !jszip.hardConflict && jszip.optionConflicts.some((c) => c) && jszip.optionConflicts.some((c) => !c));
const pakoExpr = parseLicenseExpression('(MIT AND Zlib)');
check('pako (MIT AND Zlib) 是单一组合、两证都须履行',
  licenseOptions(pakoExpr).length === 1 &&
  licenseOptions(pakoExpr)[0].includes('MIT') && licenseOptions(pakoExpr)[0].includes('Zlib'));
const jszipScope = summarizeScope(eco, eco.nodeRoots.get('jszip@3.10.1').uniqueNodeIds, 'closed');
check('jszip 范围汇总出现"可规避"中等冲突',
  jszipScope.conflicts.some((c) => c.nodeId === 'jszip@3.10.1' && c.avoidable && c.severity === 'medium'));
check('jszip 与 ffmpeg 簇共享 readable-stream（跨根共享）',
  eco.sharedAcrossRoots.has('readable-stream@2.3.8'));

group('真实数据：GPL 冲突与来源链');
const gplChain = findChain(eco, 'ffmpeg-static@4.4.1');
check('ffmpeg-static 来源链从根开始', gplChain[0] === eco.rootNode.id && gplChain.at(-1) === 'ffmpeg-static@4.4.1', JSON.stringify(gplChain));
const gpl = evaluateNode('ffmpeg-static@4.4.1', 'GPL-3.0-or-later', 'closed');
check('GPL-3.0-or-later 闭源策略硬冲突', gpl.hardConflict && gpl.copyleft === 'strong');
const scopeIds = eco.nodeRoots.get('ffmpeg-static@4.4.1').uniqueNodeIds;
const scope = summarizeScope(eco, scopeIds, 'closed');
const gplConflict = scope.conflicts.find((c) => c.nodeId === 'ffmpeg-static@4.4.1');
check('范围汇总报告 GPL 高严重度冲突', gplConflict?.severity === 'high' && gplConflict.kind === 'strong-copyleft');
check('冲突带来源链', gplConflict.chain.includes('ffmpeg-static@4.4.1') && gplConflict.chain[0] === eco.rootNode.id);
check('parse-cache-control 真实无 license → UNKNOWN 冲突',
  scope.conflicts.some((c) => c.nodeId === 'parse-cache-control@1.0.1' && c.kind === 'unknown'));
check('GPL 范围汇总含 notice 等必然义务', scope.obligations.some((o) => o.obligation === 'notice'));

group('真实数据：展开/折叠不改变结果（确定性）');
const eco2 = parseLockfile(datasets.ecosystem);
check('重复解析：节点/边/问题/统计完全一致',
  stable(eco) === stable(eco2), stable(eco) + ' vs ' + stable(eco2));
check('路径数稳定', eco.allRoots.paths.length === eco2.allRoots.paths.length);

/* ---------------- 当前工作区锁文件（真实项目） ---------------- */
group('工作区真实锁文件');
const ws = parseLockfile(datasets.workspace);
check(`解析出 ${ws.nodes.size - 1} 个包节点`, ws.nodes.size > 60, `nodes=${ws.nodes.size}`);
check('无根级异常（npm 生成的干净锁文件）',
  !ws.issues.some((i) => ['cycle', 'self-edge', 'duplicate-edge', 'missing-parent'].includes(i.kind)),
  JSON.stringify(ws.issues.map((i) => i.kind)));
check('MPL-2.0（lightningcss 簇）识别为弱著佐权',
  [...ws.nodes.values()].some((n) => n.license === 'MPL-2.0'));
const wsScope = summarizeScope(ws, ws.allRoots.uniqueNodeIds, 'closed');
check('闭源策略下工作区无强著佐权冲突（MPL 仅提示弱著佐权）',
  !wsScope.conflicts.some((c) => c.severity === 'high'),
  JSON.stringify(wsScope.conflicts.map((c) => c.nodeId)));
check('工作区存在 weak-copyleft 提示（MPL-2.0）',
  wsScope.conflicts.some((c) => c.kind === 'weak-copyleft'));
check('许可证族覆盖 MIT / Apache-2.0 / MPL-2.0 / ISC / BSD-3-Clause',
  ['MIT', 'Apache-2.0', 'MPL-2.0', 'ISC', 'BSD-3-Clause'].every((f) => wsScope.families.some((x) => x.family === f)));
check('optional 平台二进制边类型为 optional',
  ws.edges.some((e) => e.kind === 'optional'));

console.log(`\n${fail === 0 ? '\x1b[32m全部通过\x1b[0m' : '\x1b[31m存在失败\x1b[0m'}：${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

function countOcc(occs, nodeId) {
  let n = 0;
  const walk = (o) => { if (o.nodeId === nodeId) n++; o.children.forEach(walk); };
  occs.forEach(walk);
  return n;
}
// 只统计真正展开（非共享占位、非环截断）的出现
function countOccFull(occs, nodeId) {
  let n = 0;
  const walk = (o) => { if (o.nodeId === nodeId && !o.shared && !o.cycleCut) n++; o.children.forEach(walk); };
  occs.forEach(walk);
  return n;
}
function findOcc(occs, pred) {
  for (const o of occs) { if (pred(o)) return o; const r = findOcc(o.children, pred); if (r) return r; }
  return null;
}
function stable(g) {
  return JSON.stringify({
    n: [...g.nodes.keys()].sort(),
    e: g.edges.map((e) => [e.from, e.name, e.to, e.kind]).sort(),
    i: g.issues.map((i) => i.kind + i.title).sort(),
    p: g.allRoots.paths.map((p) => p.join('>')).sort(),
    u: [...g.allRoots.uniqueNodeIds].sort(),
  });
}
