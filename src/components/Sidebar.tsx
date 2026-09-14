// 左侧导航：数据集切换、审计台入口、问题计数、锁定路径数量
import {AlertTriangle, Boxes, GitBranch, Lock, Network, ShieldCheck} from 'lucide-react';
import {useStore, type DatasetId} from '../lib/store';

export default function Sidebar() {
  const {graph, locked, datasetId, setDatasetId} = useStore();
  const counts = {
    cycle: graph.issues.filter((i) => i.kind === 'cycle').length,
    self: graph.issues.filter((i) => i.kind === 'self-edge').length,
    dup: graph.issues.filter((i) => i.kind === 'duplicate-edge').length,
    orphan: graph.issues.filter((i) => i.kind === 'missing-parent').length,
    miss: graph.issues.filter((i) => i.kind === 'missing-target').length,
  };
  const mine = locked.filter((l) => l.datasetId === datasetId);
  const pending = mine.filter((l) => l.review.verdict === 'unreviewed').length;

  const datasets: {id: DatasetId; name: string}[] = [
    {id: 'ecosystem', name: '真实生态示例'},
    {id: 'workspace', name: '当前工作区锁文件'},
  ];

  return (
    <aside className="side">
      <div className="brand">
        <div className="brand-ico"><Network size={18} /></div>
        <div><b>DepAudit</b><small>传递依赖审计台</small></div>
      </div>

      <div className="side-label">数据集</div>
      <div className="ds-list">
        {datasets.map((d) => (
          <button key={d.id} onClick={() => setDatasetId(d.id)}
            className={datasetId === d.id ? 'ds active' : 'ds'}>
            <Boxes size={15} />
            <span>{d.name}</span>
            {datasetId === d.id && <i className="tick" />}
          </button>
        ))}
      </div>

      <div className="side-label mt">审计视图</div>
      <button className="nav active"><GitBranch size={15} /> 传递路径
        <span className="nav-c">{graph.allRoots.stats.unique}</span>
      </button>
      <button className="nav"><AlertTriangle size={15} /> 结构异常
        <span className="nav-c bad">{graph.issues.length}</span>
      </button>
      <button className="nav"><Lock size={15} /> 锁定复核
        <span className="nav-c">{mine.length}{pending > 0 && <i className="dot" />}</span>
      </button>

      <div className="side-label mt">异常分布</div>
      <div className="issue-chips">
        <Chip label="环路" n={counts.cycle} />
        <Chip label="自引用" n={counts.self} />
        <Chip label="重复边" n={counts.dup} />
        <Chip label="缺失父" n={counts.orphan} />
        <Chip label="缺失目标" n={counts.miss} />
      </div>

      <div className="side-foot">
        <div className="mini">
          <ShieldCheck size={15} />
          <div>
            <b>{graph.nodes.size - 1} 个包节点</b>
            <small>{graph.edges.length} 条依赖边 · 去重计数 {graph.allRoots.stats.unique}</small>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Chip({label, n}: {label: string; n: number}) {
  return <span className={n > 0 ? 'ichip on' : 'ichip'}>{label} <b>{n}</b></span>;
}
