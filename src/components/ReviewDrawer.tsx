// 锁定路径复核抽屉：独立于筛选的复核清单。每条锁定路径记录完整节点链、链上义务与冲突，
// 可下"确认合规 / 风险接受 / 驳回"结论并备注；刷新后恢复。链与当前数据集不符时标记失效。
import {BookmarkCheck, Lock, Trash2, TriangleAlert, X} from 'lucide-react';
import {useMemo, useState} from 'react';
import {summarizeScope} from '../lib/license';
import {useStore} from '../lib/store';
import {KIND_BADGE, KIND_LABEL} from '../lib/ui';

export default function ReviewDrawer({open, onClose}: {open: boolean; onClose: () => void}) {
  const {locked, graph, datasetId, unlockPath, updateReview, setSelectedNode, filters} = useStore();
  const mine = locked.filter((l) => l.datasetId === datasetId);
  const [active, setActive] = useState<string | null>(null);

  const validity = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const l of mine) {
      map.set(l.id, l.chain.every((id) => graph.nodes.has(id)));
    }
    return map;
  }, [mine, graph]);

  if (!open) return null;
  const current = mine.find((l) => l.id === (active ?? mine[0]?.id)) || null;

  let summary: ReturnType<typeof summarizeScope> | null = null;
  if (current && validity.get(current.id)) {
    const ids = new Set(current.chain.slice(1));
    const chains = new Map(current.chain.slice(1).map((id, i) => [id, current.chain.slice(0, i + 2)]));
    summary = summarizeScope(graph, ids, filters.policy, chains);
  }

  return (
    <div className="drawer-mask" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2><Lock size={16} /> 锁定路径复核</h2>
          <button onClick={onClose}><X size={17} /></button>
        </div>

        {mine.length === 0 ? (
          <div className="drawer-empty">
            <BookmarkCheck size={26} />
            <p>还没有锁定路径。在路径树中点击书签图标，或在节点详情里锁定来源链。</p>
          </div>
        ) : (
          <div className="drawer-body">
            <div className="lock-list">
              {mine.map((l) => {
                const ok = validity.get(l.id);
                return (
                  <button key={l.id}
                    className={current?.id === l.id ? 'lock-item on' : 'lock-item'}
                    onClick={() => setActive(l.id)}>
                    <span className="li-chain">{l.chain.slice(0, 2).join(' → ')}{l.chain.length > 2 ? ' → …' : ''}</span>
                    <span className="li-leaf">{l.chain[l.chain.length - 1]}</span>
                    <span className={`verdict v-${l.review.verdict}`}>{verdictLabel(l.review.verdict)}</span>
                    {!ok && <span className="stale">数据集已变更</span>}
                  </button>
                );
              })}
            </div>

            {current && (
              <div className="lock-detail">
                <div className="ld-path">
                  {current.chain.map((id, i) => (
                    <span key={i} className="ld-node">
                      {i > 0 && <i className={`lk ${KIND_BADGE[current.kinds[i - 1] || 'prod']}`}>{KIND_LABEL[current.kinds[i - 1] || 'prod']}</i>}
                      <button onClick={() => graph.nodes.has(id) && setSelectedNode(id)}
                        className={graph.nodes.has(id) ? '' : 'gone'}>{id}</button>
                    </span>
                  ))}
                </div>

                {summary && <>
                  <div className="ld-sec">
                    <div className="ld-cap">链上义务（AND 汇总）</div>
                    <div className="ld-obls">
                      {summary.obligations.map((o) => (
                        <span key={o.obligation} className={o.status === 'unavoidable' ? 'do must' : 'do cond'}>
                          {o.obligation}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="ld-sec">
                    <div className="ld-cap">链上冲突（{summary.conflicts.length}）</div>
                    {summary.conflicts.length === 0
                      ? <small className="ld-ok">无冲突</small>
                      : summary.conflicts.map((c, i) => (
                        <div key={i} className={`mini-conf sev-${c.severity}`}>
                          <TriangleAlert size={12} />
                          <button onClick={() => setSelectedNode(c.nodeId)}>{c.nodeId}</button>
                          <span>{c.expression}</span>
                          {c.avoidable && <i>可规避</i>}
                        </div>
                      ))}
                  </div>
                </>}

                <div className="ld-sec">
                  <div className="ld-cap">复核结论</div>
                  <div className="verdict-row">
                    {(['ok', 'accepted', 'reject'] as const).map((v) => (
                      <button key={v}
                        className={current.review.verdict === v ? `vbtn v-${v} on` : `vbtn v-${v}`}
                        onClick={() => updateReview(current.id, {verdict: v, reviewer: current.review.reviewer || '审计员'})}>
                        {verdictLabel(v)}
                      </button>
                    ))}
                  </div>
                  <textarea placeholder="复核备注：选证决定、分发条件、替换计划……"
                    value={current.review.note}
                    onChange={(e) => updateReview(current.id, {note: e.target.value})} />
                  <div className="ld-meta">
                    <input placeholder="复核人" value={current.review.reviewer}
                      onChange={(e) => updateReview(current.id, {reviewer: e.target.value})} />
                    <small>{current.review.updatedAt ? new Date(current.review.updatedAt).toLocaleString() : '尚未复核'}</small>
                    <button className="del" title="移除锁定" onClick={() => { unlockPath(current.id); setActive(null); }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function verdictLabel(v: string): string {
  return v === 'ok' ? '确认合规' : v === 'accepted' ? '风险接受' : v === 'reject' ? '驳回' : '待复核';
}
