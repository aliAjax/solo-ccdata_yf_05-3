// 审计台状态层：数据集 / 筛选 / 展开 / 选中 / 锁定路径复核，全部持久化到 localStorage。
// 派生分析结果（图、路径、义务、冲突）只由"数据集 + 筛选"通过纯函数计算 ——
// 展开/折叠只是 UI 偏好，刷新或折叠都不会改变任何统计结果。

import {createContext, useContext, useEffect, useMemo, useState, type ReactNode} from 'react';
import datasetsJson from '../data/datasets.json';
import {parseLockfile, type DepGraph, type EdgeKind, type Occurrence} from './graph';
import {summarizeScope, type DistributionPolicy, type ScopeSummary} from './license';

export type DatasetId = 'workspace' | 'ecosystem';
export type KindFilter = 'all' | EdgeKind;

export interface Filters {
  root: string;        // '__all' | 根直连节点 id
  maxDepth: number;    // 0 = 不限
  kinds: KindFilter[]; // 边类型
  obligations: string[]; // 义务 id，空=全部
  policy: DistributionPolicy;
  query: string;
}

export interface ReviewState {
  verdict: 'unreviewed' | 'ok' | 'accepted' | 'reject';
  note: string;
  reviewer: string;
  updatedAt: number | null;
}

export interface LockedPath {
  id: string;
  datasetId: DatasetId;
  root: string;
  chain: string[];            // nodeId 链（根→叶），用于失效校验
  kinds: EdgeKind[];          // 路径各边类型（长度 = chain.length - 1）
  createdAt: number;
  review: ReviewState;
}

interface PersistShape {
  datasetId: DatasetId;
  filters: Record<DatasetId, Filters>;
  expanded: Record<DatasetId, string[]>;
  selectedNode: Record<DatasetId, string | null>;
  locked: LockedPath[];
}

const KEY = 'dep-audit-console-v1';

const defaultFilters: Filters = {
  root: '__all', maxDepth: 0,
  kinds: ['all'], obligations: [], policy: 'closed', query: '',
};

function load(): PersistShape {
  const fallback: PersistShape = {
    datasetId: 'ecosystem',
    filters: {workspace: {...defaultFilters}, ecosystem: {...defaultFilters}},
    expanded: {workspace: [], ecosystem: []},
    selectedNode: {workspace: null, ecosystem: null},
    locked: [],
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      ...fallback,
      ...parsed,
      filters: {
        workspace: {...defaultFilters, ...(parsed.filters?.workspace || {})},
        ecosystem: {...defaultFilters, ...(parsed.filters?.ecosystem || {})},
      },
    };
  } catch {
    return fallback;
  }
}

export const DATASETS: Record<DatasetId, {label: string; note: string; lock: unknown}> = {
  ecosystem: {
    label: datasetsJson.ecosystem.label, note: datasetsJson.ecosystem.note, lock: datasetsJson.ecosystem,
  },
  workspace: {
    label: datasetsJson.workspace.label, note: datasetsJson.workspace.note, lock: datasetsJson.workspace,
  },
};

/** 过滤后的出现树（边类型裁剪、深度截断、节点名搜索），纯函数 */
export function filterOccurrences(
  occs: Occurrence[],
  opts: {kinds: Set<EdgeKind>; maxDepth: number; query: string},
): Occurrence[] {
  const q = opts.query.trim().toLowerCase();
  const walk = (o: Occurrence): Occurrence | null => {
    if (opts.maxDepth > 0 && o.depth > opts.maxDepth) return null;
    if (!opts.kinds.has(o.kind)) return null;
    const kids = o.children.map(walk).filter((x): x is Occurrence => !!x);
    const missing = o.missing.filter(
      (m) => opts.kinds.has(m.kind) && (opts.maxDepth === 0 || o.depth + 1 <= opts.maxDepth),
    );
    const selfMatch = !q || o.nodeId.toLowerCase().includes(q)
      || missing.some((m) => m.name.toLowerCase().includes(q));
    if (!selfMatch && kids.length === 0 && missing.length === 0) return null;
    return {...o, children: kids, missing};
  };
  return occs.map(walk).filter((x): x is Occurrence => !!x);
}

function collectIds(occs: Occurrence[], out: Set<string>): void {
  for (const o of occs) {
    out.add(o.nodeId); // 含共享/环截断占位
    collectIds(o.children, out);
  }
}

/** 出现树内节点 -> 从根开始的来源链（取首次展开出现） */
export function buildChainMap(occs: Occurrence[], rootNodeId: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const walk = (o: Occurrence, chain: string[]) => {
    const next = [...chain, o.nodeId];
    if (!map.has(o.nodeId) && !o.shared && !o.cycleCut) map.set(o.nodeId, next);
    o.children.forEach((c) => walk(c, next));
  };
  occs.forEach((o) => walk(o, [rootNodeId]));
  return map;
}

export function flattenVisible(occs: Occurrence[], expanded: Set<string>): Occurrence[] {
  const rows: {o: Occurrence; depth: number}[] = [];
  const walk = (o: Occurrence, depth: number) => {
    rows.push({o, depth});
    if (expanded.has(o.key)) o.children.forEach((c) => walk(c, depth + 1));
  };
  occs.forEach((o) => walk(o, 0));
  return rows.map((r) => r.o);
}

interface Store {
  datasetId: DatasetId;
  setDatasetId: (id: DatasetId) => void;
  graph: DepGraph;
  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
  resetFilters: () => void;
  expanded: Set<string>;
  toggleExpand: (key: string) => void;
  expandAll: (keys: string[]) => void;
  collapseAll: () => void;
  selectedNode: string | null;
  setSelectedNode: (id: string | null) => void;
  locked: LockedPath[];
  lockPath: (chain: string[], kinds: EdgeKind[]) => void;
  unlockPath: (id: string) => void;
  updateReview: (id: string, review: Partial<ReviewState>) => void;
  clearLocks: () => void;
  // 派生
  visibleOccs: Occurrence[];
  visibleMissingRoots: import('./graph').MissingRef[];
  visibleKeys: string[];
  scopeSummary: ScopeSummary;
  rootOptions: {id: string; label: string; count: number; kind: EdgeKind}[];
  obligationFilterActive: boolean;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({children}: {children: ReactNode}) {
  const [persist, setPersist] = useState<PersistShape>(load);
  const {datasetId} = persist;
  const filters = persist.filters[datasetId];

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(persist)); } catch { /* 配额满时忽略 */ }
  }, [persist]);

  const graph = useMemo(
    () => parseLockfile(DATASETS[datasetId].lock as never),
    [datasetId],
  );

  const patch = (p: Partial<PersistShape>) => setPersist((s) => ({...s, ...p}));
  const setDatasetId = (id: DatasetId) => patch({datasetId: id});
  const setFilters = (p: Partial<Filters>) =>
    setPersist((s) => ({...s, filters: {...s.filters, [datasetId]: {...s.filters[datasetId], ...p}}}));
  const resetFilters = () =>
    setPersist((s) => ({...s, filters: {...s.filters, [datasetId]: {...defaultFilters}}}));

  const expanded = useMemo(() => new Set(persist.expanded[datasetId]), [persist.expanded, datasetId]);
  const toggleExpand = (key: string) =>
    setPersist((s) => {
      const cur = new Set(s.expanded[datasetId]);
      cur.has(key) ? cur.delete(key) : cur.add(key);
      return {...s, expanded: {...s.expanded, [datasetId]: [...cur]}};
    });
  const expandAll = (keys: string[]) =>
    setPersist((s) => ({...s, expanded: {...s.expanded, [datasetId]: keys}}));
  const collapseAll = () =>
    setPersist((s) => ({...s, expanded: {...s.expanded, [datasetId]: []}}));

  const setSelectedNode = (id: string | null) =>
    setPersist((s) => ({...s, selectedNode: {...s.selectedNode, [datasetId]: id}}));

  const lockPath: Store['lockPath'] = (chain, kinds) =>
    setPersist((s) => {
      const sig = chain.join('>');
      const existing = s.locked.filter((l) => !(l.datasetId === datasetId && l.chain.join('>') === sig));
      return {
        ...s,
        locked: [...existing, {
          id: `lp-${Date.now()}-${chain.length}`,
          datasetId, root: chain.length > 1 ? chain[1] : chain[0],
          chain, kinds, createdAt: Date.now(),
          review: {verdict: 'unreviewed', note: '', reviewer: '', updatedAt: null},
        }],
      };
    });
  const unlockPath = (id: string) =>
    setPersist((s) => ({...s, locked: s.locked.filter((l) => l.id !== id)}));
  const updateReview = (id: string, review: Partial<ReviewState>) =>
    setPersist((s) => ({
      ...s,
      locked: s.locked.map((l) =>
        l.id === id ? {...l, review: {...l.review, ...review, updatedAt: Date.now()}} : l),
    }));
  const clearLocks = () =>
    setPersist((s) => ({...s, locked: s.locked.filter((l) => l.datasetId !== datasetId)}));

  // 选择根包后的源出现树
  const sourceOccs = useMemo<Occurrence[]>(() => {
    if (filters.root === '__all') return graph.allRoots.occurrences;
    const tree = graph.nodeRoots.get(filters.root);
    return tree ? tree.occurrences : [];
  }, [graph, filters.root]);

  const kindSet = useMemo<Set<EdgeKind>>(() => {
    if (filters.kinds.includes('all')) return new Set<EdgeKind>(['prod', 'dev', 'optional']);
    return new Set(filters.kinds.filter((k): k is EdgeKind => k !== 'all'));
  }, [filters.kinds]);

  // 先做边类型/深度/搜索过滤
  const kindFiltered = useMemo(
    () => filterOccurrences(sourceOccs, {kinds: kindSet, maxDepth: filters.maxDepth, query: filters.query}),
    [sourceOccs, kindSet, filters.maxDepth, filters.query],
  );

  // 义务筛选：在过滤后的可见范围内评估义务，保留命中节点及其祖先
  const visibleOccs = useMemo<Occurrence[]>(() => {
    if (filters.obligations.length === 0) return kindFiltered;
    const ids = new Set<string>();
    collectIds(kindFiltered, ids);
    const tmp = summarizeScope(graph, ids, filters.policy);
    const hit = new Set<string>();
    for (const ob of tmp.obligations) {
      if (filters.obligations.includes(ob.obligation)) ob.sources.forEach((n) => hit.add(n));
    }
    const prune = (o: Occurrence): Occurrence | null => {
      const kids = o.children.map(prune).filter((x): x is Occurrence => !!x);
      if (!hit.has(o.nodeId) && kids.length === 0) return null;
      return {...o, children: kids};
    };
    return kindFiltered.map(prune).filter((x): x is Occurrence => !!x);
  }, [kindFiltered, filters.obligations, filters.policy, graph]);

  const visibleKeys = useMemo(() => {
    const ks: string[] = [];
    const walk = (o: Occurrence) => { ks.push(o.key); o.children.forEach(walk); };
    visibleOccs.forEach(walk);
    return ks;
  }, [visibleOccs]);

  const visibleMissingRoots = useMemo(() => {
    if (filters.root !== '__all') return [];
    const q = filters.query.trim().toLowerCase();
    return graph.allRoots.missingRoots.filter(
      (m) => kindSet.has(m.kind) && (!q || m.name.toLowerCase().includes(q)),
    );
  }, [filters.root, filters.query, graph, kindSet]);

  const scopeSummary = useMemo(() => {
    const ids = new Set<string>();
    collectIds(visibleOccs, ids);
    const chains = buildChainMap(visibleOccs, graph.rootNode.id);
    return summarizeScope(graph, ids, filters.policy, chains);
  }, [visibleOccs, graph, filters.policy]);

  const rootOptions = useMemo(
    () => [...graph.nodeRoots.entries()].map(([id, tree]) => {
      const firstEdge = graph.edges.find((e) => e.to === id);
      return {id, label: id, count: tree.stats.unique, kind: firstEdge?.kind ?? 'prod' as EdgeKind};
    }),
    [graph],
  );

  // 义务筛选：只保留含触发节点的子树
  const obligationFilterActive = filters.obligations.length > 0;

  const store: Store = {
    datasetId, setDatasetId, graph, filters, setFilters, resetFilters,
    expanded, toggleExpand, expandAll, collapseAll,
    selectedNode: persist.selectedNode[datasetId], setSelectedNode,
    locked: persist.locked, lockPath, unlockPath, updateReview, clearLocks,
    visibleOccs, visibleMissingRoots, visibleKeys, scopeSummary, rootOptions, obligationFilterActive,
  };
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore must be used within StoreProvider');
  return v;
}
