// 结构异常面板：按严重度列出环路、自引用、重复边、缺失父节点、缺失目标，可点击定位节点
import {ArrowRight, CircleSlash, Copy, GitMerge, Repeat, TriangleAlert, Waypoints} from 'lucide-react';
import {useStore} from '../lib/store';
import {ISSUE_META} from '../lib/ui';
import type {Issue} from '../lib/graph';

const SEV_ORDER = {high: 0, medium: 1, low: 2} as const;
const KIND_ORDER: Issue['kind'][] = ['cycle', 'self-edge', 'missing-target', 'missing-parent', 'duplicate-edge'];

const ICONS: Record<Issue['kind'], typeof Repeat> = {
  cycle: Repeat,
  'self-edge': Waypoints,
  'duplicate-edge': Copy,
  'missing-parent': GitMerge,
  'missing-target': CircleSlash,
};

export default function IssuesPanel() {
  const {graph, setSelectedNode, selectedNode} = useStore();
  const issues = [...graph.issues].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
      || SEV_ORDER[a.severity] - SEV_ORDER[b.severity],
  );

  return (
    <div className="panel issues-panel">
      <div className="panel-head">
        <h2><TriangleAlert size={15} /> 结构异常</h2>
        <span className="panel-count bad">{issues.length}</span>
      </div>
      <div className="issue-list">
        {issues.length === 0 && <div className="panel-empty">未发现结构异常，图完整且无环。</div>}
        {issues.map((iss, i) => {
          const Icon = ICONS[iss.kind];
          const meta = ISSUE_META[iss.kind];
          const active = iss.nodeIds[0] && selectedNode === iss.nodeIds[0];
          return (
            <button key={i} className={`issue sev-${meta.cls} ${active ? 'active' : ''}`}
              onClick={() => iss.nodeIds[0] && setSelectedNode(iss.nodeIds[0])}>
              <div className="issue-top">
                <Icon size={14} />
                <span className="issue-tag">{meta.label}</span>
                <i className={`sev-dot ${meta.cls}`} />
                {iss.cycleNodes && <span className="cycle-n">{iss.cycleNodes.length} 包环</span>}
              </div>
              <div className="issue-title">{iss.title}</div>
              <div className="issue-detail">{iss.detail}</div>
              {iss.cycleNodes && (
                <div className="cycle-chain">
                  {iss.cycleNodes.map((n, j) => (
                    <span key={j} className="cc-seg">
                      <i onClick={(e) => { e.stopPropagation(); setSelectedNode(n); }}>{n}</i>
                      {j < iss.cycleNodes!.length - 1 ? <ArrowRight size={10} /> : <ArrowRight size={10} className="back" />}
                    </span>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
