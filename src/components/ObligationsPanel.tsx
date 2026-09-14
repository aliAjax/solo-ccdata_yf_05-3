// 义务面板：按 AND（所有节点义务叠加）汇总，OR 标注"可选择规避"；
// 冲突给出冲突节点与完整来源链（根 → … → 节点），点击链上任意节点可定位。
import {ArrowRight, GitFork, Scale, ShieldQuestion, TriangleAlert} from 'lucide-react';
import {OBLIGATIONS} from '../lib/license';
import {useStore} from '../lib/store';

export default function ObligationsPanel() {
  const {scopeSummary, graph, setSelectedNode, selectedNode} = useStore();
  const {obligations, conflicts} = scopeSummary;
  const high = conflicts.filter((c) => c.severity === 'high').length;

  return (
    <div className="panel oblig-panel">
      <div className="panel-head">
        <h2><Scale size={15} /> 许可证义务汇总</h2>
        {high > 0 && <span className="panel-count bad">{high}</span>}
      </div>
      <div className="logic-hint">
        路径上各包义务为 <b>AND</b> 叠加；同一包的 <b>OR</b> 选证只须满足其一。
      </div>

      <div className="sub-cap">义务清单（{obligations.length}）</div>
      <div className="oblig-list">
        {obligations.length === 0 && <div className="panel-empty">可见范围内没有节点。</div>}
        {obligations.map((a) => {
          const meta = OBLIGATIONS[a.obligation];
          return (
            <div key={a.obligation} className={`oblig ${a.status}`}>
              <div className="oblig-main">
                <b>{meta.label}</b>
                {a.status === 'conditional'
                  ? <span className="cond-tag" title="该义务只在某些 OR 选证组合下出现"><GitFork size={11} /> 视选证而定</span>
                  : <span className="must-tag">必然</span>}
              </div>
              <small>{meta.desc}</small>
              <div className="oblig-sources">
                {a.sources.slice(0, 6).map((id) => (
                  <button key={id} onClick={() => setSelectedNode(id)}
                    className={selectedNode === id ? 'src on' : 'src'}>{id}</button>
                ))}
                {a.sources.length > 6 && <i className="more">+{a.sources.length - 6}</i>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="sub-cap">冲突与提示（{conflicts.length}）</div>
      <div className="conflict-list">
        {conflicts.length === 0 && (
          <div className="panel-empty good">
            <ShieldQuestion size={14} /> 当前策略与可见许可证兼容，无硬冲突。
          </div>
        )}
        {conflicts.map((c, i) => (
          <div key={i} className={`conflict sev-${c.severity}`}>
            <div className="conf-head">
              <TriangleAlert size={13} />
              <button className="conf-node" onClick={() => setSelectedNode(c.nodeId)}>{c.nodeId}</button>
              <span className="conf-lic">{c.expression}</span>
              {c.avoidable && <span className="avoid">OR 可规避</span>}
            </div>
            <p>{c.message}</p>
            <div className="chain">
              <span className="chain-cap">来源链</span>
              {c.chain.map((id, j) => (
                <span key={j} className="chain-seg">
                  <button onClick={() => setSelectedNode(id)}
                    className={selectedNode === id ? 'on' : ''}>{id}</button>
                  {j < c.chain.length - 1 && <ArrowRight size={10} />}
                </span>
              ))}
              {graph.rootNode.id === c.chain[0] && <i className="chain-note">（自项目根包）</i>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
