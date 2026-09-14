// 顶部统计条：节点/边/唯一包/共享/异常，以及打开锁定复核抽屉入口
import {Boxes, GitMerge, GitPullRequestArrow, Lock, Network, TriangleAlert} from 'lucide-react';
import {useStore} from '../lib/store';

export default function StatsHeader({onOpenReview}: {onOpenReview: () => void}) {
  const {graph, visibleOccs, locked, datasetId} = useStore();

  const visibleNodes = new Set<string>();
  const visibleShared = new Set<string>();
  const collect = (o: typeof visibleOccs[number]) => {
    visibleNodes.add(o.nodeId);
    if (o.shared) visibleShared.add(o.nodeId);
    o.children.forEach(collect);
  };
  visibleOccs.forEach(collect);

  const stats = [
    {icon: Boxes, label: '包节点（名称+版本）', value: graph.nodes.size - 1, tone: ''},
    {icon: GitPullRequestArrow, label: '依赖边', value: graph.edges.length, tone: ''},
    {icon: Network, label: '可见唯一包（不重复计数）', value: visibleNodes.size, tone: 'teal'},
    {icon: GitMerge, label: '可见共享占位', value: visibleShared.size, tone: 'blue'},
    {icon: TriangleAlert, label: '结构异常', value: graph.issues.length, tone: graph.issues.length ? 'red' : ''},
  ];
  const pendingLocks = locked.filter((l) => l.datasetId === datasetId && l.review.verdict === 'unreviewed').length;

  return (
    <div className="stats-header">
      {stats.map((s) => (
        <div key={s.label} className="stat-card">
          <div className={`stat-ico ${s.tone}`}><s.icon size={16} /></div>
          <div>
            <b>{s.value}</b>
            <small>{s.label}</small>
          </div>
        </div>
      ))}
      <button className="review-entry" onClick={onOpenReview}>
        <Lock size={15} />
        <span>锁定复核</span>
        {pendingLocks > 0 && <i className="pending">{pendingLocks}</i>}
      </button>
    </div>
  );
}
