import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Collapse, Empty, Modal, Progress, Space, Tag, Typography, message } from "antd";
import { ReloadOutlined, SyncOutlined, RedoOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { api, errorMessage } from "../api";

interface DmpCollectionBatch {
  id: string;
  batchNumber: number;
  productIds: string[];
  status: string;
  attempts: number;
  recoveryCount: number;
  savedProducts: number;
  lastError: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  canRetry: boolean;
  canRecover: boolean;
}

interface DmpCollectionTask {
  id: string;
  title: string;
  status: string;
  totalProducts: number;
  totalBatches: number;
  completedBatches: number;
  failedBatches: number;
  savedProducts: number;
  lastError: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: { id: string; name: string; username: string };
  batches: DmpCollectionBatch[];
}

function statusMeta(status: string) {
  const values: Record<string, { label: string; color: string }> = {
    QUEUED: { label: "排队中", color: "default" },
    RUNNING: { label: "执行中", color: "processing" },
    RECOVERING: { label: "查询原会话", color: "processing" },
    COMPLETED: { label: "已完成", color: "success" },
    PARTIAL: { label: "部分完成", color: "warning" },
    FAILED: { label: "失败", color: "error" },
    NEEDS_REVIEW: { label: "待人工处理", color: "warning" },
  };
  return values[status] ?? { label: status, color: "default" };
}

export function DmpTasksPanel() {
  const queryClient = useQueryClient();
  const tasksQuery = useQuery({
    queryKey: ["dmpTasks"],
    queryFn: async () => (await api.get<{ items: DmpCollectionTask[] }>("/dmp/tasks")).data,
    refetchInterval: 4000,
  });

  async function refresh() {
    await tasksQuery.refetch();
  }

  async function recover(task: DmpCollectionTask, batch: DmpCollectionBatch) {
    try {
      await api.post(`/dmp/tasks/${encodeURIComponent(task.id)}/batches/${batch.batchNumber}/recover`);
      message.success(`第 ${batch.batchNumber} 批已加入原会话查询队列。`);
      await queryClient.invalidateQueries({ queryKey: ["dmpTasks"] });
    } catch (error) {
      message.error(errorMessage(error));
    }
  }

  function retry(task: DmpCollectionTask, batch: DmpCollectionBatch) {
    Modal.confirm({
      title: `重新执行第 ${batch.batchNumber} 批？`,
      okText: "确认重试",
      cancelText: "取消",
      content: `本批包含 ${batch.productIds.length} 个商品。重试会创建新的 AI 会话，可能再次消耗 AI 豆；系统会保留旧会话记录。`,
      onOk: async () => {
        try {
          await api.post(`/dmp/tasks/${encodeURIComponent(task.id)}/batches/${batch.batchNumber}/retry`);
          message.success(`第 ${batch.batchNumber} 批已重新加入后台队列。`);
          await queryClient.invalidateQueries({ queryKey: ["dmpTasks"] });
        } catch (error) {
          message.error(errorMessage(error));
          throw error;
        }
      },
    });
  }

  const tasks = tasksQuery.data?.items ?? [];
  return (
    <Card
      bordered={false}
      className="table-card dmp-tasks-panel"
      title={<div><Typography.Title level={4} style={{ margin: 0 }}>后台数据获取任务</Typography.Title><Typography.Text type="secondary">任务由服务器持续执行，离开页面或关闭浏览器不会中断。</Typography.Text></div>}
      extra={<Button icon={<ReloadOutlined />} loading={tasksQuery.isFetching} onClick={() => void refresh()}>刷新任务</Button>}
    >
      {tasksQuery.isLoading ? <div className="loading-inline">加载后台任务…</div> : !tasks.length ? <Empty description="暂无后台获取任务" /> : (
        <div className="dmp-task-list">
          {tasks.map((task) => {
            const finished = task.completedBatches + task.failedBatches;
            const percent = task.totalBatches ? Math.round((finished / task.totalBatches) * 100) : 0;
            const meta = statusMeta(task.status);
            return (
              <Card key={task.id} size="small" className="dmp-task-card">
                <div className="section-heading">
                  <div>
                    <Typography.Text strong>{task.title}</Typography.Text>
                    <div><Typography.Text type="secondary">提交人：{task.createdBy?.name ?? "管理员"} · {dayjs(task.createdAt).format("YYYY-MM-DD HH:mm:ss")}</Typography.Text></div>
                  </div>
                  <Tag color={meta.color}>{meta.label}</Tag>
                </div>
                <Progress percent={percent} size="small" status={task.status === "FAILED" ? "exception" : task.status === "COMPLETED" ? "success" : "normal"} />
                <Space wrap size={[12, 6]} className="dmp-task-summary">
                  <Typography.Text>商品 {task.totalProducts} 件</Typography.Text>
                  <Typography.Text>批次 {task.completedBatches}/{task.totalBatches} 完成</Typography.Text>
                  <Typography.Text>失败/待处理 {task.failedBatches} 批</Typography.Text>
                  <Typography.Text>已入库 {task.savedProducts} 件</Typography.Text>
                </Space>
                {task.lastError && <Typography.Text type="warning" className="dmp-task-error">{task.lastError}</Typography.Text>}
                <Collapse
                  size="small"
                  className="dmp-task-batches"
                  items={task.batches.map((batch) => {
                    const batchMeta = statusMeta(batch.status);
                    return {
                      key: String(batch.batchNumber),
                      label: <Space wrap><Typography.Text strong>第 {batch.batchNumber} 批</Typography.Text><Tag color={batchMeta.color}>{batchMeta.label}</Tag><Typography.Text type="secondary">{batch.productIds.length} 件商品 · 已入库 {batch.savedProducts} 件 · 执行 {batch.attempts} 次</Typography.Text></Space>,
                      children: (
                        <div className="dmp-task-batch-detail">
                          <Typography.Text type="secondary">商品ID：{batch.productIds.slice(0, 8).join("、")}{batch.productIds.length > 8 ? ` 等 ${batch.productIds.length} 件` : ""}</Typography.Text>
                          {batch.lastError && <Typography.Paragraph type="danger" className="dmp-task-error">{batch.lastError}</Typography.Paragraph>}
                          <Space wrap>
                            {batch.canRecover && <Button size="small" icon={<SyncOutlined />} onClick={() => void recover(task, batch)}>重新查询原会话</Button>}
                            {batch.canRetry && <Button size="small" danger icon={<RedoOutlined />} onClick={() => retry(task, batch)}>重试本批</Button>}
                            {batch.status === "RECOVERING" && <Typography.Text type="secondary">后台正在只读查询原会话，不会重新发送收费请求。</Typography.Text>}
                          </Space>
                        </div>
                      ),
                    };
                  })}
                />
              </Card>
            );
          })}
        </div>
      )}
    </Card>
  );
}
