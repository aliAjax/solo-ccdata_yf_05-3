// 传递依赖图引擎：lockfile v3 解析、三类边、异常检测（重复边/自引用/环路/缺失父节点/缺失目标）、
// 根到叶子路径展开、共享节点去重计数。纯函数、无副作用——展开折叠只是 UI 状态，不改变任何结果。

export type EdgeKind = 'prod' | 'dev' | 'optional';

export interface PackageNode {
  id: string;            // name@version（同名不同版本天然是不同节点）
  name: string;
  version: string;
  license: string;
  installPaths: string[]; // 实际安装路径（同一 name@version 被去重到一个节点）
  extraneous: boolean;    // 锁文件标记 extraneous
  isRoot?: boolean;
}

export interface DepEdge {
  id: string;
  from: string;           // 父节点 id；缺失父节点时为合成 id "missing-parent:<installPath>"
  fromInstallPath: string;
  to: string | null;      // 目标节点 id；缺失目标时为 null
  name: string;           // 被依赖包名
  range: string;
  kind: EdgeKind;
  missingTarget?: boolean;
  /** 同一份依赖在不同类型区块重复声明（如同时出现在 dependencies 与 devDependencies） */
  typeConflict?: boolean;
  /** auditInject 注入边（真实脏数据形态演示） */
  injected?: boolean;
  /** 注入的完全重复边（第二次声明） */
  duplicateDecl?: boolean;
}

export type IssueKind =
  | 'duplicate-edge'
  | 'self-edge'
  | 'cycle'
  | 'missing-parent'
  | 'missing-target';

export type Severity = 'high' | 'medium' | 'low';

export interface Issue {
  kind: IssueKind;
  severity: Severity;
  title: string;
  detail: string;
  /** 涉及的边 id */
  edgeIds: string[];
  /** 涉及的节点 id */
  nodeIds: string[];
  /** 环路场景：构成环的节点有序链 */
  cycleNodes?: string[];
}

export interface MissingRef {
  edgeId: string;
  name: string;
  range: string;
  kind: EdgeKind;
}

export interface Occurrence {
  key: string;            // 路径上的唯一标识 = 出现链
  nodeId: string;
  edgeId: string | null;  // 从父节点进入的边
  kind: EdgeKind;         // 该出现点的边类型（沿链收紧）
  depth: number;          // 相对当前根，根=0
  chain: string[];        // nodeId 出现链，用于溯源
  kindChain: EdgeKind[];  // 与 chain 对应的边类型链（长度 = chain.length - 1）
  parentKey: string | null;
  children: Occurrence[];
  /** 缺失目标边：作为虚拟叶子挂在展开树中，即使该节点没有真实子节点 */
  missing: MissingRef[];
  leaf: boolean;
  /** 被环路截断（再走会重复自身） */
  cycleCut?: boolean;
  /** 共享：该节点在本根树内已有另一次出现 */
  shared?: boolean;
  /** 第一次出现的 key（shared 时指向它） */
  firstKey?: string;
}

export interface RootTree {
  rootNodeId: string;     // 根包（项目）节点 id
  edges: DepEdge[];       // 根包直连边
  occurrences: Occurrence[]; // 每个根直连依赖一棵树
  /** 根直连的缺失目标边（无展开出现节点，单独作为虚拟根行） */
  missingRoots: MissingRef[];
  /** 展开到叶子的全部路径（每条路径一条 nodeId 链） */
  paths: string[][];
  uniqueNodeIds: Set<string>;
  sharedNodeIds: Set<string>;
  cycleNodes: Set<string>;
  maxDepth: number;
  stats: { occurrences: number; unique: number; shared: number };
}

export interface DepGraph {
  rootNode: PackageNode;
  nodes: Map<string, PackageNode>;
  edges: DepEdge[];
  outgoing: Map<string, DepEdge[]>;   // nodeId|missing-parent -> edges
  incoming: Map<string, DepEdge[]>;
  issues: Issue[];
  /** 强连通分量中 size>1（含自环）的节点分组 */
  cycles: string[][];
  cycleNodeIds: Set<string>;
  /** 仅含真实边（不含缺失目标）的邻接，供 SCC 使用 */
  allRoots: RootTree;                  // 根包视角的完整展开
  nodeRoots: Map<string, RootTree>;    // 每个根直连依赖作为"根包"的展开
  sharedAcrossRoots: Set<string>;
  versionGroups: Map<string, string[]>; // name -> nodeIds（多版本）
}

interface LockPackage {
  version?: string;
  license?: string | string[] | { type?: string; licenses?: { type?: string }[] };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  optional?: boolean;
  dev?: boolean;
  extraneous?: boolean;
}

export interface Lockfile {
  name?: string;
  version?: string;
  packages?: Record<string, LockPackage>;
  auditInject?: { from: string; name: string; range: string; kind: EdgeKind; duplicate?: boolean }[];
}

function normalizeLicense(raw: LockPackage['license']): string {
  if (!raw) return 'UNKNOWN';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw.map(normalizeLicense).join(' OR ');
  if (typeof raw === 'object') {
    if (raw.type) return raw.type;
    if (raw.licenses) return raw.licenses.map((l) => l.type || 'UNKNOWN').join(' OR ');
  }
  return 'UNKNOWN';
}

function pkgNameFromPath(installPath: string): string {
  const base = installPath.split('node_modules/').pop() as string;
  return base.startsWith('@') ? base.split('/').slice(0, 2).join('/') : base.split('/')[0];
}

/** npm v3 嵌套解析：从父安装目录逐级向上，在祖先 node_modules 中找最近安装 */
function resolveInstall(installerPath: string, name: string, packages: Record<string, LockPackage>): string | null {
  const candidate = `${installerPath === '' ? '' : installerPath + '/'}node_modules/${name}`;
  if (packages[candidate]) return candidate;
  const parts = installerPath.split('/');
  while (parts.length) {
    parts.pop();
    const ancestor = `${parts.join('/')}${parts.length ? '/' : ''}node_modules/${name}`;
    if (packages[ancestor]) return ancestor;
  }
  return null;
}

export function parseLockfile(lock: Lockfile): DepGraph {
  const packages = lock.packages || {};
  const rootEntry = packages[''] || {};
  const rootNode: PackageNode = {
    id: `${lock.name || 'root'}@${rootEntry.version || lock.version || '0.0.0'}`,
    name: lock.name || 'root',
    version: rootEntry.version || lock.version || '0.0.0',
    license: normalizeLicense(rootEntry.license) === 'UNKNOWN' ? 'UNLICENSED' : normalizeLicense(rootEntry.license),
    installPaths: [''],
    extraneous: false,
    isRoot: true,
  };

  const nodes = new Map<string, PackageNode>([[rootNode.id, rootNode]]);
  const idByPath = new Map<string, string>();

  // 1) 建节点：name@version 去重，多版本天然分离
  for (const [path, entry] of Object.entries(packages)) {
    if (path === '') continue;
    const name = pkgNameFromPath(path);
    const version = entry.version || '0.0.0';
    const id = `${name}@${version}`;
    let node = nodes.get(id);
    if (!node) {
      node = {
        id, name, version,
        license: normalizeLicense(entry.license),
        installPaths: [],
        extraneous: !!entry.extraneous,
      };
      nodes.set(id, node);
    }
    node.installPaths.push(path);
    idByPath.set(path, id);
  }

  const edges: DepEdge[] = [];
  const edgeKey = new Map<string, number[]>(); // (fromInstallPath, name, kind) -> edge indexes
  const pairKey = new Map<string, number[]>(); // (fromId,toId) 任意类型
  let edgeSeq = 0;

  const remember = (edge: DepEdge) => {
    const idx = edges.length;
    edges.push(edge);
    const k = `${edge.fromInstallPath}|${edge.name}|${edge.kind}`;
    (edgeKey.get(k) || edgeKey.set(k, []).get(k)!).push(idx);
    if (edge.to) {
      const p = `${edge.from}=>${edge.to}`;
      (pairKey.get(p) || pairKey.set(p, []).get(p)!).push(idx);
    }
  };

  // 2) 建边
  for (const [path, entry] of Object.entries(packages)) {
    const sections: {deps?: Record<string, string>; kind: EdgeKind}[] = [
      {deps: entry.dependencies, kind: 'prod'},
      {deps: entry.devDependencies, kind: 'dev'},
      {deps: entry.optionalDependencies, kind: 'optional'},
    ];
    for (const {deps, kind} of sections) {
      if (!deps) continue;
      for (const [name, range] of Object.entries(deps)) {
        const resolved = resolveInstall(path, name, packages);
        const fromId = path === '' ? rootNode.id : idByPath.get(path)!;
        const toId = resolved ? idByPath.get(resolved) ?? null : null;
        remember({
          id: `e${++edgeSeq}`,
          from: fromId,
          fromInstallPath: path,
          to: toId,
          name, range, kind,
          missingTarget: !toId,
        });
      }
    }
  }

  // 3) 审计注入边（演示自引用 / 完全重复边等真实脏数据）
  for (const inj of lock.auditInject || []) {
    const installerPath = inj.from === rootNode.name ? '' : `node_modules/${inj.from}`;
    const fromId = idByPath.get(installerPath) || (inj.from === rootNode.name ? rootNode.id : '');
    if (!fromId) continue;
    const resolved = resolveInstall(installerPath, inj.name, packages);
    const toId = resolved ? idByPath.get(resolved) ?? null : null;
    remember({
      id: `e${++edgeSeq}`,
      from: fromId,
      fromInstallPath: installerPath,
      to: toId,
      name: inj.name, range: inj.range, kind: inj.kind,
      missingTarget: !toId,
      injected: true,
      duplicateDecl: inj.duplicate,
    });
  }

  // 4) 邻接表
  const outgoing = new Map<string, DepEdge[]>();
  const incoming = new Map<string, DepEdge[]>();
  const add = (map: Map<string, DepEdge[]>, key: string, e: DepEdge) => {
    const arr = map.get(key);
    if (arr) arr.push(e); else map.set(key, [e]);
  };
  for (const e of edges) {
    add(outgoing, e.from, e);
    if (e.to) add(incoming, e.to, e);
  }

  // 5) 重复边 / 跨区块重复声明标记
  for (const idxs of edgeKey.values()) {
    if (idxs.length > 1) {
      // 同一 (父安装路径, 依赖名, 类型) 出现多次：完全重复
      idxs.slice(1).forEach((i) => (edges[i].duplicateDecl = true));
    }
  }
  for (const idxs of pairKey.values()) {
    if (idxs.length > 1) {
      const kinds = new Set(idxs.map((i) => edges[i].kind));
      if (kinds.size > 1) idxs.forEach((i) => (edges[i].typeConflict = true));
    }
  }

  // 6) 异常：缺失父节点（存在但无人引用）、缺失目标
  const issues: Issue[] = [];
  const referenced = new Set<string>();
  for (const e of edges) if (e.to) referenced.add(e.to);
  for (const node of nodes.values()) {
    if (node.isRoot) continue;
    if (!referenced.has(node.id)) {
      issues.push({
        kind: 'missing-parent',
        severity: 'medium',
        title: `缺失父节点：${node.id}`,
        detail: `包已安装（${node.installPaths.join('、')}），但锁文件中没有任何依赖声明指向它，可能是残留安装或手工放入。`,
        edgeIds: [],
        nodeIds: [node.id],
      });
    }
  }
  for (const e of edges) {
    if (e.missingTarget) {
      const parent = e.from === rootNode.id ? '根包' : e.from;
      issues.push({
        kind: 'missing-target',
        severity: 'high',
        title: `缺失目标：${parent} → ${e.name}@${e.range}`,
        detail: `依赖声明存在，但锁文件中没有可解析的安装节点（可选平台包未安装或依赖未随锁文件提供）。`,
        edgeIds: [e.id],
        nodeIds: [e.from],
      });
    }
  }
  // 重复边
  for (const idxs of edgeKey.values()) {
    if (idxs.length > 1) {
      const e = edges[idxs[0]];
      issues.push({
        kind: 'duplicate-edge',
        severity: 'low',
        title: `重复依赖边：${e.from === rootNode.id ? '根包' : e.from} → ${e.name}`,
        detail: `同一份依赖在 ${e.fromInstallPath || '根包'} 的 ${e.kind} 依赖区块中声明了 ${idxs.length} 次。`,
        edgeIds: idxs.map((i) => edges[i].id),
        nodeIds: [e.from, ...(e.to ? [e.to] : [])],
      });
    }
  }
  // 跨区块类型冲突也算重复声明
  for (const idxs of pairKey.values()) {
    if (idxs.length > 1 && new Set(idxs.map((i) => edges[i].kind)).size > 1) {
      const e = edges[idxs[0]];
      const kinds = [...new Set(idxs.map((i) => edges[i].kind))].join(' / ');
      issues.push({
        kind: 'duplicate-edge',
        severity: 'low',
        title: `跨区块重复声明：${e.from === rootNode.id ? '根包' : e.from} → ${e.name}`,
        detail: `同一对父子关系同时声明为 ${kinds}，依赖类型存在歧义。`,
        edgeIds: idxs.map((i) => edges[i].id),
        nodeIds: [e.from, e.to!],
      });
    }
  }

  // 7) 自引用
  for (const e of edges) {
    if (e.to && e.from === e.to) {
      issues.push({
        kind: 'self-edge',
        severity: 'high',
        title: `自引用：${e.from}`,
        detail: `包在自身的 ${e.kind} 依赖中声明了自己（${e.name}@${e.range}），递归解析会立即成环。`,
        edgeIds: [e.id],
        nodeIds: [e.from],
      });
    }
  }

  // 8) 环路：Tarjan 强连通分量（只走真实边）
  const realAdj = new Map<string, string[]>();
  for (const e of edges) {
    if (!e.to || e.from === e.to) continue;
    const arr = realAdj.get(e.from);
    if (arr) arr.push(e.to); else realAdj.set(e.from, [e.to]);
  }
  const cycles = tarjan([...nodes.keys()], (id) => realAdj.get(id) || []);
  const cycleNodeIds = new Set<string>();
  for (const cyc of cycles) {
    cyc.forEach((id) => cycleNodeIds.add(id));
    const names = cyc.map((id) => id);
    issues.push({
      kind: 'cycle',
      severity: 'high',
      title: `依赖环路（${cyc.length} 个包）`,
      detail: `强连通环路：${names.join(' → ')} → ${names[0]}。版本解析与安装顺序存在死锁风险。`,
      edgeIds: [],
      nodeIds: cyc,
      cycleNodes: names,
    });
  }

  // 9) 版本分组（同名多版本）
  const versionGroups = new Map<string, string[]>();
  for (const node of nodes.values()) {
    if (node.isRoot) continue;
    const arr = versionGroups.get(node.name);
    if (arr) arr.push(node.id); else versionGroups.set(node.name, [node.id]);
  }

  const graph: DepGraph = {
    rootNode, nodes, edges, outgoing, incoming, issues,
    cycles, cycleNodeIds, allRoots: null as unknown as RootTree,
    nodeRoots: new Map(), sharedAcrossRoots: new Set(), versionGroups,
  };

  // 10) 路径展开。缺失目标边挂为出现节点的虚拟叶子（missing），根直连缺失边单列 missingRoots。
  const expand = (startEdges: DepEdge[]): {occurrences: Occurrence[]; missingRoots: MissingRef[]; paths: string[][]; uniqueNodeIds: Set<string>; sharedNodeIds: Set<string>; cycleNodes: Set<string>; maxDepth: number; stats: {occurrences: number; unique: number; shared: number}} => {
    const occurrences: Occurrence[] = [];
    const missingRoots: MissingRef[] = [];
    const paths: string[][] = [];
    const uniqueNodeIds = new Set<string>();
    const cycleNodes = new Set<string>();
    const seenFirst = new Map<string, string>(); // nodeId -> first occurrence key（树内共享判定）
    let maxDepth = 0;
    let occCount = 0;

    const toMissing = (e: DepEdge): MissingRef => ({edgeId: e.id, name: e.name, range: e.range, kind: e.kind});

    const walk = (edge: DepEdge, depth: number, chain: string[], kindChain: EdgeKind[], parentKey: string | null): Occurrence | null => {
      if (!edge.to) return null;
      const nodeId = edge.to;
      const kind = edge.kind; // 出现节点的类型 = 进入它的边类型
      const occKey = `${parentKey ?? 'ROOT'}>${edge.id}:${nodeId}`;
      const occ: Occurrence = {
        key: occKey, nodeId, edgeId: edge.id, kind, depth,
        chain: [...chain, nodeId], kindChain: [...kindChain, kind],
        parentKey, children: [], missing: [], leaf: true,
      };
      occCount++;
      maxDepth = Math.max(maxDepth, depth);
      uniqueNodeIds.add(nodeId);

      const allOut = outgoing.get(nodeId) || [];
      occ.missing = allOut.filter((e) => e.missingTarget).map(toMissing);

      // 环路截断：当前链上已出现过该节点
      if (chain.includes(nodeId)) {
        occ.cycleCut = true;
        occ.leaf = occ.children.length === 0 && occ.missing.length === 0;
        cycleNodes.add(nodeId);
        paths.push([...chain, nodeId]);
        return occ;
      }

      // 共享截断：树内另一处已展开过同节点 —— 子路径不重复计数
      const first = seenFirst.get(nodeId);
      if (first !== undefined && first !== occKey) {
        occ.shared = true;
        occ.firstKey = first;
        occ.leaf = occ.children.length === 0 && occ.missing.length === 0;
        paths.push([...chain, nodeId]);
        return occ;
      }
      seenFirst.set(nodeId, occKey);

      const childEdges = allOut.filter((ce) => ce.to);
      const kids = childEdges
        .map((ce) => walk(ce, depth + 1, [...chain, nodeId], occ.kindChain, occKey))
        .filter((o): o is Occurrence => !!o);
      occ.children = kids;
      occ.leaf = kids.length === 0 && occ.missing.length === 0;
      if (kids.length === 0) paths.push([...chain, nodeId]);
      return occ;
    };

    for (const edge of startEdges) {
      if (edge.to) {
        const occ = walk(edge, 0, [rootNode.id], [], null);
        if (occ) occurrences.push(occ);
      } else {
        missingRoots.push(toMissing(edge));
      }
    }
    const sharedNodeIds = new Set<string>();
    const collectShared = (o: Occurrence) => { if (o.shared) sharedNodeIds.add(o.nodeId); o.children.forEach(collectShared); };
    occurrences.forEach(collectShared);

    return {
      occurrences, missingRoots, paths, uniqueNodeIds, sharedNodeIds, cycleNodes, maxDepth,
      stats: {occurrences: occCount, unique: uniqueNodeIds.size, shared: sharedNodeIds.size},
    };
  };

  // 根包完整展开（去重跨区块重复边，避免根直连出现两条相同边）
  const rootEdges = dedupeEdges(outgoing.get(rootNode.id) || []);
  graph.allRoots = {rootNodeId: rootNode.id, edges: rootEdges, ...expand(rootEdges)};

  // 每个根直连依赖作为独立根包展开
  for (const edge of rootEdges) {
    if (!edge.to) continue;
    const sub = expand([edge]);
    graph.nodeRoots.set(edge.to, {rootNodeId: edge.to, edges: [edge], ...sub});
  }

  // 跨根共享：出现在多个根子树中的节点
  const rootMembership = new Map<string, number>();
  for (const tree of graph.nodeRoots.values()) {
    for (const id of tree.uniqueNodeIds) rootMembership.set(id, (rootMembership.get(id) || 0) + 1);
  }
  for (const [id, n] of rootMembership) if (n > 1) graph.sharedAcrossRoots.add(id);

  return graph;
}

function dedupeEdges(edges: DepEdge[]): DepEdge[] {
  const seen = new Set<string>();
  const out: DepEdge[] = [];
  for (const e of edges) {
    const k = `${e.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

// Tarjan SCC（迭代化不必要：包图规模有限，环路簇深度浅；封装递归便于审计）
function tarjan(vertices: string[], neighbors: (id: string) => string[]): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  let counter = 0;

  const strong = (v: string) => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of neighbors(v)) {
      if (!index.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      // 自环（自引用边）单独由 self-edge 问题报告；这里保留 size>=2 的分量
      if (comp.length >= 2) result.push(comp);
    }
  };
  for (const v of vertices) if (!index.has(v)) strong(v);
  return result;
}
