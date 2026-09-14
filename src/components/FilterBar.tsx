// 筛选工具栏：根包、深度、边类型（普通/开发/可选）、义务类型、分发策略、搜索
import {ChevronDown, RotateCcw, Search} from 'lucide-react';
import {OBLIGATIONS, type ObligationId} from '../lib/license';
import {useStore, type KindFilter} from '../lib/store';
import {KIND_LABEL} from '../lib/ui';

const OBL_ORDER: ObligationId[] = [
  'notice', 'license-copy', 'state-changes', 'patent-grant',
  'weak-copyleft', 'source-disclosure', 'network-disclosure', 'same-license', 'unknown',
];

export default function FilterBar() {
  const {filters, setFilters, resetFilters, rootOptions} = useStore();

  const toggleKind = (k: KindFilter) => {
    const cur = new Set(filters.kinds);
    if (k === 'all') {
      setFilters({kinds: ['all']});
      return;
    }
    cur.delete('all');
    cur.has(k) ? cur.delete(k) : cur.add(k);
    setFilters({kinds: cur.size ? [...cur] : ['all']});
  };

  const toggleObl = (o: ObligationId) => {
    const cur = new Set(filters.obligations);
    cur.has(o) ? cur.delete(o) : cur.add(o);
    setFilters({obligations: [...cur]});
  };

  return (
    <div className="filters">
      <div className="filter-row">
        <div className="field">
          <label>根包</label>
          <div className="select-wrap">
            <select value={filters.root} onChange={(e) => setFilters({root: e.target.value})}>
              <option value="__all">全部根（根包完整展开）</option>
              {rootOptions.map((r) => (
                <option key={r.id} value={r.id}>{r.id}（{r.count}）</option>
              ))}
            </select>
            <ChevronDown size={13} />
          </div>
        </div>

        <div className="field">
          <label>最大深度</label>
          <div className="select-wrap">
            <select value={filters.maxDepth} onChange={(e) => setFilters({maxDepth: Number(e.target.value)})}>
              <option value={0}>不限</option>
              {[1, 2, 3, 4, 5, 6, 8].map((d) => <option key={d} value={d}>≤ {d} 层</option>)}
            </select>
            <ChevronDown size={13} />
          </div>
        </div>

        <div className="field grow">
          <label>依赖边类型</label>
          <div className="seg">
            <button className={filters.kinds.includes('all') ? 'on' : ''} onClick={() => toggleKind('all')}>全部</button>
            {(['prod', 'dev', 'optional'] as const).map((k) => (
              <button key={k} className={`${filters.kinds.includes(k) ? 'on' : ''} seg-${k}`}
                onClick={() => toggleKind(k)}>{KIND_LABEL[k]}</button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>分发策略</label>
          <div className="seg">
            <button className={filters.policy === 'closed' ? 'on' : ''}
              onClick={() => setFilters({policy: 'closed'})}>闭源分发</button>
            <button className={filters.policy === 'open' ? 'on' : ''}
              onClick={() => setFilters({policy: 'open'})}>开源分发</button>
          </div>
        </div>

        <div className="field search-field">
          <label>节点搜索</label>
          <div className="search-box">
            <Search size={14} />
            <input value={filters.query} placeholder="name@version"
              onChange={(e) => setFilters({query: e.target.value})} />
          </div>
        </div>

        <button className="reset-btn" title="重置筛选" onClick={resetFilters}>
          <RotateCcw size={14} />
        </button>
      </div>

      <div className="filter-row obl-row">
        <span className="obl-cap">义务类型</span>
        {OBL_ORDER.map((o) => (
          <button key={o}
            className={filters.obligations.includes(o) ? 'obl-chip on' : 'obl-chip'}
            title={OBLIGATIONS[o].desc}
            onClick={() => toggleObl(o)}>
            {OBLIGATIONS[o].label}
          </button>
        ))}
      </div>
    </div>
  );
}
