// 节点详情：name@version、安装路径、选证选项（OR/AND）、单证义务、出入边、环/多版本标记
import {Boxes, GitMerge, Package, Repeat, X} from 'lucide-react';
import {useMemo} from 'react';
import type {EdgeKind, Occurrence} from '../lib/graph';
import {licenseInfo, licenseOptions, parseLicenseExpression, OBLIGATIONS} from '../lib/license';
import {useStore} from '../lib/store';
import {familyColor, KIND_BADGE, KIND_LABEL, shorten} from '../lib/ui';

export default function NodeDetail() {
  const {selectedNode, setSelectedNode, graph, scopeSummary, visibleOccs, lockPath, locked, filters} = useStore();

  const occ = useMemo<{chain: string[]; kinds: EdgeKind[]} | null>(() => {
    if (!selectedNode) return null;
    let found: {chain: string[]; kinds: EdgeKind[]} | null = null;
    const walk = (o: Occurrence) => {
      if (found) return;
      if (o.nodeId === selectedNode) { found = {chain: o.chain, kinds: o.kindChain}; return; }
      o.children.forEach(walk);
    };
    visibleOccs.forEach(walk);
    return found;
  }, [selectedNode, visibleOccs]);

  if (!selectedNode) {
    return (
      <div className="panel detail-panel placeholder">
        <Package size={22} />
        <b>选择一个包节点</b>
        <p>点击路径树或冲突来源链中的节点，查看版本、选证选项、义务与出入边。</p>
      </div>
    );
  }

  const node = graph.nodes.get(selectedNode);
  if (!node) {
    return (
      <div className="panel detail-panel placeholder">
        <b>节点不在当前数据集中</b>
        <button onClick={() => setSelectedNode(null)}>关闭</button>
      </div>
    );
  }

  const info = licenseInfo(node.license);
  const color = familyColor(info.family);
  const ast = parseLicenseExpression(node.license);
  const options = licenseOptions(ast);
  const ev = scopeSummary.nodeEvals.get(node.id);
  const inCycle = graph.cycleNodeIds.has(node.id);
  const versions = graph.versionGroups.get(node.name) || [];
  const ins = graph.incoming.get(node.id) || [];
  const outs = graph.outgoing.get(node.id) || [];
  const allObls = new Set(options.flatMap((opt) => opt.flatMap((l) => licenseInfo(l).obligations)));
  const unavoidable = options.length > 1
    ? options[0].flatMap((l) => licenseInfo(l).obligations).filter((o) =>
        options.every((opt) => opt.some((l) => licenseInfo(l).obligations.includes(o))))
    : [...allObls];
  const chainLocked = occ ? locked.some((l) => l.chain.join('>') === occ.chain.join('>')) : false;

  return (
    <div className="panel detail-panel">
      <div className="detail-top">
        <div className="detail-ico" style={{color, background: color + '1a'}}><Boxes size={18} /></div>
        <div className="detail-id">
          <b title={node.id}>{shorten(node.id, 30)}</b>
          <small>{node.installPaths.length} 个安装位置</small>
        </div>
        <button className="x" onClick={() => setSelectedNode(null)}><X size={15} /></button>
      </div>

      {versions.length > 1 && (
        <div className="flag multi">
          <GitMerge size={12} /> 多版本共存：
          {versions.map((v) => (
            <button key={v} className={v === node.id ? 'ver-chip on' : 'ver-chip'}
              onClick={() => setSelectedNode(v)}>{v.split('@').slice(-1)[0]}</button>
          ))}
        </div>
      )}
      {inCycle && (
        <div className="flag cycle"><Repeat size={12} /> 位于依赖环路中，展开时回边已截断</div>
      )}

      <div className="dsec">
        <div className="dsec-cap">许可证表达式</div>
        <i className="lic-badge lg" style={{color, background: color + '1a'}}>{node.license}</i>
        {options.length > 1
          ? <p className="or-note">OR 选证：可在下列 {options.length} 种组合中选择一种遵守（选证后只需履行所选组合的义务）。</p>
          : <p className="or-note">单许可证，义务必须全部履行。</p>}
        <div className="opt-list">
          {options.map((opt, i) => (
            <div key={i} className={ev?.optionConflicts[i] ? 'opt bad' : 'opt'}>
              <span className="opt-n">{i + 1}</span>
              {opt.map((l) => {
                const li = licenseInfo(l);
                return <i key={l} className="lic-badge sm" style={{color: familyColor(li.family), background: familyColor(li.family) + '1a'}}>{l}</i>;
              })}
              {ev?.optionConflicts[i] && <b className="opt-bad">当前策略冲突</b>}
            </div>
          ))}
        </div>
      </div>

      <div className="dsec">
        <div className="dsec-cap">单证义务</div>
        <div className="d-obligs">
          {[...allObls].map((o) => (
            <span key={o} className={unavoidable.includes(o) ? 'do must' : 'do cond'} title={OBLIGATIONS[o].desc}>
              {OBLIGATIONS[o].label}{!unavoidable.includes(o) && <em>·可选证规避</em>}
            </span>
          ))}
        </div>
      </div>

      <div className="dsec two">
        <div>
          <div className="dsec-cap">父节点（{ins.length}）</div>
          <div className="edge-list">
            {ins.length === 0 && <span className="none">无（根包或缺失父节点）</span>}
            {ins.slice(0, 8).map((e) => (
              <button key={e.id} className="edge" onClick={() => setSelectedNode(e.from)}>
                <i className={`kbadge ${KIND_BADGE[e.kind]}`}>{KIND_LABEL[e.kind]}</i>
                {e.from === graph.rootNode.id ? '根包' : shorten(e.from, 26)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="dsec-cap">子依赖（{outs.length}）</div>
          <div className="edge-list">
            {outs.length === 0 && <span className="none">叶子节点</span>}
            {outs.slice(0, 8).map((e) => (
              <button key={e.id} className="edge" disabled={!e.to}
                onClick={() => e.to && setSelectedNode(e.to)}>
                <i className={`kbadge ${KIND_BADGE[e.kind]}`}>{KIND_LABEL[e.kind]}</i>
                {e.to ? shorten(e.to, 26) : `${e.name}（缺失目标）`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="dsec">
        <div className="dsec-cap">安装路径</div>
        <div className="paths-list">
          {node.installPaths.map((p) => <code key={p}>{p || '(root)'}</code>)}
        </div>
      </div>

      {occ && (
        <button className={`lock-path-btn ${chainLocked ? 'done' : ''}`}
          onClick={() => lockPath(occ.chain, [])}
          disabled={chainLocked}>
          {chainLocked ? '此路径已锁定复核' : '锁定当前来源路径单独复核'}
        </button>
      )}
    </div>
  );
}
