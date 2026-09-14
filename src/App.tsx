// 传递依赖关系审计台：左边路径树（筛选 + 展开折叠），右边结构异常 / 义务汇总 / 节点详情，
// 顶部统计；锁定路径在独立抽屉中复核。所有交互状态持久化，分析结果只由数据集 + 筛选推导。
import {useState} from 'react';
import Sidebar from './components/Sidebar';
import FilterBar from './components/FilterBar';
import StatsHeader from './components/StatsHeader';
import PathTree from './components/PathTree';
import IssuesPanel from './components/IssuesPanel';
import ObligationsPanel from './components/ObligationsPanel';
import NodeDetail from './components/NodeDetail';
import ReviewDrawer from './components/ReviewDrawer';
import {StoreProvider, useStore, DATASETS} from './lib/store';

function Workspace() {
  const [reviewOpen, setReviewOpen] = useState(false);
  const {datasetId, graph, filters} = useStore();
  const ds = DATASETS[datasetId];

  return (
    <div className="shell">
      <Sidebar />
      <main>
        <header className="top">
          <div>
            <div className="crumb">DEPENDENCY AUDIT / 传递依赖关系</div>
            <h1>{ds.label}</h1>
            <p className="root-line">
              根包 <code>{graph.rootNode.id}</code> · {ds.note}
              {filters.root !== '__all' && <> · 已聚焦根包 <code>{filters.root}</code></>}
            </p>
          </div>
        </header>

        <StatsHeader onOpenReview={() => setReviewOpen(true)} />
        <FilterBar />

        <div className="workspace-grid">
          <section className="col-tree">
            <PathTree />
          </section>
          <section className="col-side">
            <IssuesPanel />
            <ObligationsPanel />
            <NodeDetail />
          </section>
        </div>
      </main>

      <ReviewDrawer open={reviewOpen} onClose={() => setReviewOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Workspace />
    </StoreProvider>
  );
}
