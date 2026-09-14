// 传递路径树：每个根包展开到叶子。共享节点二次出现只渲染占位并截断子路径（不重复计数），
// 环路回边截断标记，缺失目标渲染为虚拟叶子（挂在父节点下）。展开/折叠纯 UI，不影响右侧统计。
import {memo, useMemo} from 'react';
import {Bookmark, BookmarkCheck, ChevronRight, CircleSlash, GitMerge, Repeat, TriangleAlert} from 'lucide-react';
import type {EdgeKind, MissingRef, Occurrence} from '../lib/graph';
import {licenseInfo} from '../lib/license';
import {useStore} from '../lib/store';
import {familyColor, KIND_BADGE, KIND_LABEL, shorten} from '../lib/ui';

type Row =
  | {type: 'occ'; o: Occurrence; depth: number}
  | {type: 'miss'; miss: MissingRef; depth: number};

function PathTreeInner() {
  const {graph, visibleOccs, visibleMissingRoots, expanded, toggleExpand, setSelectedNode,
    selectedNode, lockPath, locked} = useStore();

  const edgeById = useMemo(() => new Map(graph.edges.map((e) => [e.id, e])), [graph]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (o: Occurrence, depth: number) => {
      out.push({type: 'occ', o, depth});
      if (expanded.has(o.key)) {
        o.children.forEach((c) => walk(c, depth + 1));
        for (const m of o.missing) {
          out.push({type: 'miss', miss: m, depth: depth + 1});
        }
      }
    };
    visibleOccs.forEach((o) => walk(o, 0));
    for (const m of visibleMissingRoots) {
      out.push({type: 'miss', miss: m, depth: 0});
    }
    return out;
  }, [visibleOccs, visibleMissingRoots, expanded, edgeById]);

  const isLocked = (chain: string[]) =>
    locked.some((l) => l.chain.join('>') === chain.join('>'));

  const expandableKeys = useMemo(() => {
    const ks: string[] = [];
    const walk = (o: Occurrence) => {
      if (o.children.length || o.missing.length) ks.push(o.key);
      o.children.forEach(walk);
    };
    visibleOccs.forEach(walk);
    return ks;
  }, [visibleOccs]);

  const {expandAll, collapseAll} = useStore();
  const allExpanded = expandableKeys.length > 0 && expandableKeys.every((k) => expanded.has(k));

  if (rows.length === 0) {
    return <div className="tree-empty">当前筛选下没有可见路径。</div>;
  }

  return (
    <div className="tree-pane">
      <div className="tree-toolbar">
        <span>{rows.filter((r) => r.type === 'occ').length} 个可见节点 · {rows.filter((r) => r.type === 'miss').length} 个缺失目标</span>
        <button onClick={() => (allExpanded ? collapseAll() : expandAll(expandableKeys))}>
          {allExpanded ? '全部折叠' : '全部展开'}
        </button>
      </div>
      <div className="tree">
        <div className="tree-row tree-head">
          <span className="th-twisty" />
          <span className="tn-name">依赖路径（根 → 叶子）</span>
          <span className="tn-kind">边</span>
          <span className="tn-lic">许可证</span>
          <span className="tn-depth">深度</span>
          <span className="tn-lock" />
        </div>
        {rows.map((r) => (r.type === 'occ'
          ? <OccRow key={r.o.key} o={r.o} depth={r.depth}
              isOpen={expanded.has(r.o.key)} selected={selectedNode === r.o.nodeId}
              onToggle={() => toggleExpand(r.o.key)} onSelect={() => setSelectedNode(r.o.nodeId)}
              onLock={() => lockPath(r.o.chain, r.o.kindChain)}
              locked={isLocked(r.o.chain)} />
          : <MissRow key={`miss-${r.miss.edgeId}`} miss={r.miss} depth={r.depth} />))}
      </div>
    </div>
  );
}

const OccRow = memo(function OccRow({o, depth, isOpen, selected, onToggle, onSelect, onLock, locked}: {
  o: Occurrence; depth: number; isOpen: boolean; selected: boolean;
  onToggle: () => void; onSelect: () => void; onLock: () => void; locked: boolean;
}) {
  const {graph} = useStore();
  const node = graph.nodes.get(o.nodeId)!;
  const edge = o.edgeId ? graph.edges.find((e) => e.id === o.edgeId) : null;
  const hasKids = o.children.length > 0 || o.missing.length > 0;
  const info = licenseInfo(node.license);
  const color = familyColor(info.family);
  const inCycle = graph.cycleNodeIds.has(o.nodeId);

  return (
    <div className={selected ? 'tree-row sel' : 'tree-row'} style={{paddingLeft: 10 + depth * 18}}>
      <button className="twisty" onClick={hasKids ? onToggle : onSelect} disabled={!hasKids}>
        {hasKids ? <ChevronRight size={13} className={isOpen ? 'rot' : ''} /> : <span className="leaf-dot" />}
      </button>
      <span className="tn-name" onClick={onSelect}>
        <b>{node.name}</b>
        <i className="ver">@{node.version}</i>
        {o.shared && (
          <span className="marker shared" title={`共享节点：子路径已在首次出现处展开，不重复计数`}>
            <GitMerge size={11} /> 共享占位
          </span>
        )}
        {o.cycleCut && (
          <span className="marker cycle" title="再走将回到本路径上已出现的节点（环路回边），在此截断">
            <Repeat size={11} /> 环路截断
          </span>
        )}
        {inCycle && !o.cycleCut && <span className="marker in-cycle"><Repeat size={11} /> 环上</span>}
        {node.installPaths.length > 1 && (
          <span className="marker dup-install" title={`同一版本安装于 ${node.installPaths.length} 个位置（npm 去重）`}>
            ×{node.installPaths.length} 处
          </span>
        )}
      </span>
      <span className="tn-kind">
        {edge
          ? <i className={`kbadge ${KIND_BADGE[edge.kind]}`}>{KIND_LABEL[edge.kind]}</i>
          : <i className="kbadge kind-root">根</i>}
      </span>
      <span className="tn-lic">
        <i className="lic-badge" style={{color, background: color + '1a'}}>{shorten(node.license, 22)}</i>
      </span>
      <span className="tn-depth">{o.depth}</span>
      <span className="tn-lock">
        <button className="lock-btn" title={locked ? '已锁定复核' : '锁定此路径单独复核'} onClick={onLock}>
          {locked ? <BookmarkCheck size={14} className="locked" /> : <Bookmark size={14} />}
        </button>
      </span>
    </div>
  );
});

function MissRow({miss, depth}: {miss: MissingRef; depth: number}) {
  return (
    <div className="tree-row missing" style={{paddingLeft: 10 + depth * 18}}>
      <button className="twisty" disabled><TriangleAlert size={13} /></button>
      <span className="tn-name">
        <b className="miss-name">{miss.name}</b>
        <i className="ver">@{miss.range}</i>
        <span className="marker miss" title="依赖声明存在，但锁文件中没有可解析的安装节点">
          <CircleSlash size={11} /> 缺失目标
        </span>
      </span>
      <span className="tn-kind"><i className={`kbadge ${KIND_BADGE[miss.kind]}`}>{KIND_LABEL[miss.kind]}</i></span>
      <span className="tn-lic"><i className="lic-badge miss-lic">未安装</i></span>
      <span className="tn-depth">—</span>
      <span className="tn-lock" />
    </div>
  );
}

export default memo(PathTreeInner);
