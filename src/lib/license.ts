// 许可证义务模型：SPDX 复合表达式（AND/OR/WITH）解析、单证义务目录、
// 沿依赖路径的与/或汇总、分发策略下的冲突识别与来源链溯源。

import type {DepGraph} from './graph';

// ---------------- SPDX 表达式解析 ----------------
export type LicAst =
  | {op: 'lic'; value: string}
  | {op: 'AND'; items: LicAst[]}
  | {op: 'OR'; items: LicAst[]};

type Token = '(' | ')' | 'AND' | 'OR' | string;

function tokenize(input: string): Token[] {
  const out: Token[] = [];
  const s = input.trim();
  let i = 0;
  while (i < s.length) {
    if (s[i] === ' ') { i++; continue; }
    if (s[i] === '(' || s[i] === ')') { out.push(s[i]); i++; continue; }
    let t = '';
    while (i < s.length && s[i] !== ' ' && s[i] !== '(' && s[i] !== ')') t += s[i++];
    if (t === 'WITH') { // WITH 例外：跳过例外标识符，义务归入主许可证
      i++;
      while (i < s.length && s[i] !== ' ' && s[i] !== '(' && s[i] !== ')') i++;
      continue;
    }
    out.push(t);
  }
  return out;
}

export function parseLicenseExpression(input: string): LicAst {
  if (!input || input === 'UNKNOWN') return {op: 'lic', value: 'UNKNOWN'};
  const tokens = tokenize(input);
  let p = 0;

  const parseAtom = (): LicAst => {
    const t = tokens[p++];
    if (t === '(') {
      const node = parseOr();
      if (tokens[p] === ')') p++;
      return node;
    }
    return {op: 'lic', value: t as string};
  };
  const parseAnd = (): LicAst => {
    let left = parseAtom();
    while (tokens[p] === 'AND') {
      p++;
      const right = parseAtom();
      left = left.op === 'AND'
        ? {op: 'AND', items: [...left.items, right]}
        : {op: 'AND', items: [left, right]};
    }
    return left;
  };
  function parseOr(): LicAst {
    let left = parseAnd();
    while (tokens[p] === 'OR') {
      p++;
      const right = parseAnd();
      left = left.op === 'OR'
        ? {op: 'OR', items: [...left.items, right]}
        : {op: 'OR', items: [left, right]};
    }
    return left;
  }
  return parseOr();
}

/** 展开成 DNF：options[i] 是一种选证组合（AND 集合）。OR 给出多个可选组合。 */
export function licenseOptions(ast: LicAst): string[][] {
  switch (ast.op) {
    case 'lic':
      return [[ast.value]];
    case 'AND': {
      let combos: string[][] = [[]];
      for (const sub of ast.items) {
        const subOpts = licenseOptions(sub);
        const next: string[][] = [];
        for (const c of combos) for (const o of subOpts) next.push([...c, ...o]);
        combos = next;
      }
      return combos.map((c) => [...new Set(c)]);
    }
    case 'OR':
      return ast.items.flatMap(licenseOptions);
  }
}

// ---------------- 许可证目录 ----------------
export type ObligationId =
  | 'notice'           // 保留版权与许可声明
  | 'license-copy'     // 随附许可证全文
  | 'state-changes'    // 声明对源码的修改
  | 'patent-grant'     // 明确专利授权
  | 'weak-copyleft'    // 弱著佐权：修改的库文件需开源
  | 'source-disclosure'// 强著佐权：衍生作品整体需提供源码
  | 'network-disclosure' // AGPL：网络服务也需提供源码
  | 'same-license'     // 衍生作品须以相同/兼容许可证发布
  | 'unknown';         // 许可证缺失/无法识别

export interface ObligationMeta {
  id: ObligationId;
  label: string;
  desc: string;
  copyleft?: 'weak' | 'strong' | 'network';
}

export const OBLIGATIONS: Record<ObligationId, ObligationMeta> = {
  notice: {id: 'notice', label: '保留版权声明', desc: '分发时保留版权、许可与免责声明'},
  'license-copy': {id: 'license-copy', label: '随附许可证', desc: '随分发物提供许可证全文'},
  'state-changes': {id: 'state-changes', label: '声明修改', desc: '对源码的修改需要明确标注'},
  'patent-grant': {id: 'patent-grant', label: '专利授权', desc: '含明确的专利授权与诉讼终止条款'},
  'weak-copyleft': {id: 'weak-copyleft', label: '弱著佐权', desc: '修改过的库本身须开源，可动态链接隔离', copyleft: 'weak'},
  'source-disclosure': {id: 'source-disclosure', label: '公开衍生源码', desc: '衍生作品整体分发时须提供完整源码', copyleft: 'strong'},
  'network-disclosure': {id: 'network-disclosure', label: '网络服务开源', desc: '通过网络提供服务也须向用户开放源码', copyleft: 'network'},
  'same-license': {id: 'same-license', label: '衍生作品同许可', desc: '衍生作品须以相同或兼容许可证发布'},
  unknown: {id: 'unknown', label: '许可证待核实', desc: '元数据未声明或许可证无法识别，须人工确认'},
};

export type Copyleft = 'none' | 'weak' | 'strong' | 'network';

export interface LicenseInfo {
  id: string;
  family: string;
  copyleft: Copyleft;
  obligations: ObligationId[];
  osi: boolean;
}

// 归一化 GPL/LGPL/AGPL 后缀（-or-later、-only、+）；其余标准 SPDX 标识原样保留
function normalizeFamily(id: string): string {
  let x = id.replace(/\+$/, '').replace(/-or-later$|-only$/, '');
  const gpl = x.match(/^(GPL|LGPL|AGPL)-?(\d(?:\.\d)?)?/i);
  if (gpl) {
    const prefix = gpl[1].toUpperCase();
    const ver = gpl[2] || '';
    return ver ? `${prefix}-${ver}` : prefix;
  }
  return x;
}

const PERMISSIVE_TABLE: Record<string, ObligationId[]> = {
  MIT: ['notice', 'license-copy'],
  ISC: ['notice', 'license-copy'],
  'BSD-2-Clause': ['notice', 'license-copy'],
  'BSD-3-Clause': ['notice', 'license-copy'],
  // Apache 2.x：版权声明 + 许可证全文 + 修改声明 + 专利授权
  Apache: ['notice', 'license-copy', 'state-changes', 'patent-grant'],
  'Apache-2.0': ['notice', 'license-copy', 'state-changes', 'patent-grant'],
  'Apache-1.1': ['notice', 'license-copy', 'state-changes'],
  Zlib: ['notice'],
  '0BSD': [],
  Unlicense: [],
};

/** 标准 SPDX 标识 → 归一族（补充常见宽松许可证的版本别名） */
const FAMILY_ALIASES: Record<string, string> = {
  'Apache-1.0': 'Apache-1.1',
  'BSD-2-Clause-Patent': 'BSD-3-Clause',
};

export function licenseInfo(licenseId: string): LicenseInfo {
  if (!licenseId || licenseId === 'UNKNOWN') {
    return {id: 'UNKNOWN', family: 'UNKNOWN', copyleft: 'none', obligations: ['unknown'], osi: false};
  }
  const fam = normalizeFamily(licenseId);
  if (fam.startsWith('AGPL')) {
    return {id: licenseId, family: fam, copyleft: 'network', obligations: ['network-disclosure', 'source-disclosure', 'same-license', 'notice', 'license-copy'], osi: true};
  }
  if (fam.startsWith('GPL')) {
    return {id: licenseId, family: fam, copyleft: 'strong', obligations: ['source-disclosure', 'same-license', 'notice', 'license-copy'], osi: true};
  }
  if (fam.startsWith('LGPL')) {
    return {id: licenseId, family: fam, copyleft: 'weak', obligations: ['weak-copyleft', 'notice', 'license-copy'], osi: true};
  }
  if (fam === 'MPL-2.0' || fam === 'MPL-1.1') {
    return {id: licenseId, family: fam, copyleft: 'weak', obligations: ['weak-copyleft', 'notice', 'license-copy'], osi: true};
  }
  if (fam === 'EPL-2.0' || fam === 'EPL-1.0' || fam === 'EPL') {
    return {id: licenseId, family: fam, copyleft: 'weak', obligations: ['weak-copyleft', 'notice', 'license-copy'], osi: true};
  }
  // 标准 SPDX 标识先查表；查不到再按归族别名（版本变体）处理
  if (PERMISSIVE_TABLE[fam]) {
    return {id: licenseId, family: fam, copyleft: 'none', obligations: PERMISSIVE_TABLE[fam], osi: true};
  }
  const alias = FAMILY_ALIASES[fam];
  if (alias && PERMISSIVE_TABLE[alias]) {
    return {id: licenseId, family: fam, copyleft: 'none', obligations: PERMISSIVE_TABLE[alias], osi: true};
  }
  // 未知 SPDX 标识：按宽松处理但要求人工核实
  return {id: licenseId, family: fam, copyleft: 'none', obligations: ['unknown'], osi: false};
}

// ---------------- 节点选证评估 ----------------
export interface NodeLicenseEval {
  nodeId: string;
  expression: string;
  options: string[][];
  /** 每个选项是否触发策略冲突 */
  optionConflicts: boolean[];
  /** 所有选项都冲突 → 硬冲突；存在不冲突选项 → 可规避 */
  hardConflict: boolean;
  avoidable: boolean;
  copyleft: Copyleft;
  unknown: boolean;
}

export type DistributionPolicy = 'closed' | 'open';

export function evaluateNode(nodeId: string, expression: string, policy: DistributionPolicy): NodeLicenseEval {
  const ast = parseLicenseExpression(expression);
  const options = licenseOptions(ast);
  const optionConflicts = options.map((opt) =>
    opt.some((lic) => {
      const info = licenseInfo(lic);
      if (policy === 'closed') return info.copyleft === 'strong' || info.copyleft === 'network';
      // 开源分发：著佐权彼此/宽松许可证基本兼容，这里不报硬冲突
      return false;
    }),
  );
  const allInfo = options.flat().map(licenseInfo);
  const copyleftRank = {none: 0, weak: 1, strong: 2, network: 3} as const;
  const copyleft = allInfo
    .map((i) => i.copyleft)
    .reduce((a, b) => (copyleftRank[b] > copyleftRank[a] ? b : a), 'none' as Copyleft);
  const unknown = expression === 'UNKNOWN' || allInfo.some((i) => i.family === 'UNKNOWN');
  const hardConflict = optionConflicts.length > 0 && optionConflicts.every(Boolean);
  const avoidable = optionConflicts.some(Boolean) && !hardConflict;
  return {nodeId, expression, options, optionConflicts, hardConflict, avoidable, copyleft, unknown};
}

// ---------------- 范围汇总（路径 / 根 / 全局） ----------------
export interface ObligationAgg {
  obligation: ObligationId;
  /** unavoidable：所有选证组合都无法避免；conditional：仅在某些选证下出现 */
  status: 'unavoidable' | 'conditional';
  /** 触发该义务的节点（去重） */
  sources: string[];
}

export interface LicenseConflict {
  nodeId: string;
  expression: string;
  kind: 'strong-copyleft' | 'network-copyleft' | 'unknown' | 'weak-copyleft';
  severity: 'high' | 'medium';
  message: string;
  /** 来源链：根 → … → 冲突节点 */
  chain: string[];
  /** 是否可通过 OR 选证规避 */
  avoidable: boolean;
}

export interface ScopeSummary {
  nodeEvals: Map<string, NodeLicenseEval>;
  obligations: ObligationAgg[];
  conflicts: LicenseConflict[];
  /** 出现过的许可证族 */
  families: {family: string; nodeIds: string[]}[];
}

/** 在真实边上从根做 BFS，给出到目标的最短来源链 */
export function findChain(graph: DepGraph, target: string): string[] {
  const root = graph.rootNode.id;
  const prev = new Map<string, string | null>([[root, null]]);
  const queue = [root];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === target) break;
    for (const e of graph.outgoing.get(cur) || []) {
      if (!e.to || prev.has(e.to)) continue;
      prev.set(e.to, cur);
      queue.push(e.to);
    }
  }
  if (!prev.has(target)) return [target];
  const chain: string[] = [];
  let cur: string | null = target;
  while (cur) { chain.unshift(cur); cur = prev.get(cur) ?? null; }
  return chain;
}

export function summarizeScope(
  graph: DepGraph,
  nodeIds: Iterable<string>,
  policy: DistributionPolicy,
  chains?: Map<string, string[]>,
): ScopeSummary {
  const nodeEvals = new Map<string, NodeLicenseEval>();
  const obligAll = new Map<ObligationId, Set<string>>();   // 所有选项都带
  const obligSome = new Map<ObligationId, Set<string>>();  // 部分选项带
  const familyMap = new Map<string, Set<string>>();
  const conflicts: LicenseConflict[] = [];
  const addTo = (map: Map<ObligationId, Set<string>>, o: ObligationId, id: string) => {
    let s = map.get(o);
    if (!s) { s = new Set(); map.set(o, s); }
    s.add(id);
  };

  for (const nodeId of nodeIds) {
    const node = graph.nodes.get(nodeId);
    if (!node) continue;
    const ev = evaluateNode(nodeId, node.license, policy);
    nodeEvals.set(nodeId, ev);

    // 义务：在该节点所有选项中都出现 → unavoidable；否则 conditional
    const allOptObls = new Map<ObligationId, number>();
    for (const opt of ev.options) {
      const set = new Set<ObligationId>();
      for (const lic of opt) licenseInfo(lic).obligations.forEach((o) => set.add(o));
      set.forEach((o) => allOptObls.set(o, (allOptObls.get(o) || 0) + 1));
    }
    for (const [o, n] of allOptObls) {
      if (n === ev.options.length) addTo(obligAll, o, nodeId);
      else addTo(obligSome, o, nodeId);
    }
    for (const opt of ev.options) for (const lic of opt) {
      const fam = licenseInfo(lic).family;
      let s = familyMap.get(fam);
      if (!s) { s = new Set(); familyMap.set(fam, s); }
      s.add(nodeId);
    }

    // 冲突
    const chain = chains?.get(nodeId) || findChain(graph, nodeId);
    if (ev.hardConflict) {
      const network = ev.options.every((opt) => opt.some((l) => licenseInfo(l).copyleft === 'network'));
      conflicts.push({
        nodeId, expression: node.license,
        kind: network ? 'network-copyleft' : 'strong-copyleft',
        severity: 'high',
        message: network
          ? `${node.license} 是网络著佐权许可证，即使只通过网络提供服务也须开放全部衍生源码，与${policy === 'closed' ? '闭源' : '当前'}分发冲突。`
          : `${node.license} 是强著佐权许可证，衍生作品整体须按同许可证公开源码，与${policy === 'closed' ? '闭源专有分发' : '专有分发'}冲突。`,
        chain, avoidable: false,
      });
    } else if (ev.avoidable && (ev.copyleft === 'strong' || ev.copyleft === 'network')) {
      conflicts.push({
        nodeId, expression: node.license,
        kind: ev.copyleft === 'network' ? 'network-copyleft' : 'strong-copyleft',
        severity: 'medium',
        message: `${node.license} 含著佐权选项，但可通过选择同一表达式中的宽松许可证规避；请在产品中明确选证并留存记录。`,
        chain, avoidable: true,
      });
    } else if (ev.copyleft === 'weak') {
      conflicts.push({
        nodeId, expression: node.license,
        kind: 'weak-copyleft',
        severity: 'medium',
        message: `${node.license} 为弱著佐权：修改该库本身须开源修改部分；以动态链接/未修改方式使用通常不影响专有代码。`,
        chain, avoidable: false,
      });
    } else if (ev.unknown) {
      conflicts.push({
        nodeId, expression: node.license,
        kind: 'unknown', severity: 'medium',
        message: `许可证为「${node.license}」，元数据缺失或无法识别，分发义务无法自动判定，必须人工核实。`,
        chain, avoidable: false,
      });
    }
  }

  const merged = new Map<ObligationId, ObligationAgg>();
  for (const [o, src] of obligAll) {
    const some = obligSome.get(o);
    merged.set(o, {obligation: o, status: 'unavoidable', sources: [...src, ...(some ? [...some] : [])]});
  }
  for (const [o, src] of obligSome) {
    if (!merged.has(o)) merged.set(o, {obligation: o, status: 'conditional', sources: [...src]});
  }
  const order = Object.keys(OBLIGATIONS) as ObligationId[];
  const obligations = [...merged.values()].sort(
    (a, b) => order.indexOf(a.obligation) - order.indexOf(b.obligation),
  );

  const families = [...familyMap.entries()]
    .map(([family, set]) => ({family, nodeIds: [...set]}))
    .sort((a, b) => b.nodeIds.length - a.nodeIds.length);

  return {nodeEvals, obligations, conflicts, families};
}
