import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Empty, Progress, Space, Table, Tag, Typography, Upload, message } from "antd";
import { CheckCircleOutlined, CloudUploadOutlined, FileExcelOutlined, ReloadOutlined } from "@ant-design/icons";
import type { UploadFile } from "antd/es/upload/interface";
import dayjs from "dayjs";
import { api, errorMessage } from "../api";

interface PreviewFile {
  id: string; originalName: string; status: string; sheetName: string | null;
  weekStart: string | null; weekEnd: string | null; categoryName: string | null;
  rowCount: number; validRows: number; errorCount: number; parseError: string | null;
  errors?: Array<{ row: number; productId?: string; message: string }>;
}
interface PreviewRow { productId: string; productName: string; categoryName: string; categoryLevel1: string; categoryLevel2: string | null; weekStart: string; weekEnd: string; rank: number | null; visitor: { raw: string | null; min: number | null; max: number | null; median: number | null }; buyer: { raw: string | null; min: number | null; max: number | null; median: number | null } }
interface PreviewResult { batchId: string; status: string; totalFiles: number; totalRows: number; validRows: number; errorRows: number; duplicateFiles: number; files: PreviewFile[]; previewRows: PreviewRow[] }
interface ImportBatch { id: string; status: string; totalFiles: number; totalRows: number; importedRows: number; duplicateRows: number; errorRows: number; newProducts: number; createdHistories: number; updatedHistories: number; createdAt: string; completedAt: string | null; files: Array<{ id: string; originalName: string; status: string; rowCount: number; importedCount: number; errorCount: number; errorsJson?: string | null }> }

const statusMap: Record<string, { label: string; color: string }> = {
  PREVIEW: { label: "待确认", color: "blue" }, QUEUED: { label: "排队中", color: "processing" },
  PROCESSING: { label: "导入中", color: "processing" }, COMPLETED: { label: "已完成", color: "success" },
  FAILED: { label: "失败", color: "error" }, DUPLICATE: { label: "重复文件", color: "default" },
};

function StatusTag({ status }: { status: string }) { const item = statusMap[status] ?? { label: status, color: "default" }; return <Tag color={item.color}>{item.label}</Tag>; }
function previewMetric(metric: PreviewRow["buyer"]) {
  const format = (value: number | null) => value === null ? "—" : value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
  return <div className="metric-summary" title={metric.raw ?? undefined}><span>最小：{format(metric.min)}</span><span>最大：{format(metric.max)}</span><strong>中值：{format(metric.median)}</strong></div>;
}

export function ImportPage() {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [batchId, setBatchId] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();

  const batchesQuery = useQuery({ queryKey: ["imports"], queryFn: async () => (await api.get<ImportBatch[]>("/imports")).data });
  const batchQuery = useQuery({
    queryKey: ["importBatch", batchId],
    queryFn: async () => (await api.get<ImportBatch>(`/imports/${batchId}`)).data,
    enabled: Boolean(batchId),
    refetchInterval: (query) => ["QUEUED", "PROCESSING"].includes(query.state.data?.status ?? "") ? 1500 : false,
  });

  useEffect(() => {
    if (batchQuery.data?.status === "COMPLETED" || batchQuery.data?.status === "FAILED") {
      void queryClient.invalidateQueries({ queryKey: ["imports"] });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    }
  }, [batchQuery.data?.status, queryClient]);

  async function createPreview() {
    const files = fileList.map((file) => file.originFileObj).filter(Boolean) as File[];
    if (!files.length) { message.warning("请先选择 Excel 文件。"); return; }
    setUploading(true);
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    try {
      const result = (await api.post<PreviewResult>("/imports/preview", formData)).data;
      setPreview(result); setBatchId(result.batchId);
      message.success(`解析完成：${result.validRows.toLocaleString()} 行有效数据`);
    } catch (error) { message.error(errorMessage(error)); }
    finally { setUploading(false); }
  }

  async function confirmImport() {
    if (!preview) return;
    setConfirming(true);
    try {
      await api.post(`/imports/${preview.batchId}/confirm`);
      message.success("导入任务已提交，正在后台处理。");
      void batchQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["imports"] });
    } catch (error) { message.error(errorMessage(error)); }
    finally { setConfirming(false); }
  }

  const currentBatch = batchQuery.data;
  const previewErrors = preview?.files.flatMap((file) => (file.errors ?? []).map((error) => ({ ...error, fileName: file.originalName }))) ?? [];
  const batchErrors = (currentBatch?.files ?? []).flatMap((file) => {
    try {
      const parsed = file.errorsJson ? JSON.parse(file.errorsJson) : null;
      return (parsed?.errors ?? []).map((error: { row: number; productId?: string; message: string }) => ({ ...error, fileName: file.originalName }));
    } catch { return []; }
  });
  const fileColumns = [
    { title: "文件名", dataIndex: "originalName", key: "name", ellipsis: true },
    { title: "开始日期", dataIndex: "weekStart", key: "weekStart", width: 112 },
    { title: "结束日期", dataIndex: "weekEnd", key: "weekEnd", width: 112 },
    { title: "类目", dataIndex: "categoryName", key: "category", ellipsis: true },
    { title: "读取行数", dataIndex: "rowCount", key: "rows", width: 100 },
    { title: "有效行", dataIndex: "validRows", key: "valid", width: 90 },
    { title: "异常行", dataIndex: "errorCount", key: "errors", width: 90, render: (value: number) => value ? <Typography.Text type="danger">{value}</Typography.Text> : 0 },
    { title: "状态", dataIndex: "status", key: "status", width: 110, render: (value: string) => <StatusTag status={value} /> },
  ];
  const previewColumns = [
    { title: "商品ID", dataIndex: "productId", key: "id", width: 140 },
    { title: "商品名称", dataIndex: "productName", key: "name", ellipsis: true },
    { title: "开始日期", dataIndex: "weekStart", key: "weekStart", width: 112 },
    { title: "结束日期", dataIndex: "weekEnd", key: "weekEnd", width: 112 },
    { title: "一级类目", dataIndex: "categoryLevel1", key: "categoryLevel1", width: 130 },
    { title: "二级类目", dataIndex: "categoryLevel2", key: "categoryLevel2", width: 150, render: (value: string | null) => value || "—" },
    { title: "支付买家数（最小/最大/中值）", key: "buyer", width: 165, render: (_: unknown, row: PreviewRow) => previewMetric(row.buyer) },
    { title: "访客数（最小/最大/中值）", key: "visitor", width: 165, render: (_: unknown, row: PreviewRow) => previewMetric(row.visitor) },
  ];

  return (
    <div className="page-stack">
      <div className="page-heading-row"><div><div className="eyebrow">DATA INGESTION</div><Typography.Title level={2}>数据导入</Typography.Title><Typography.Text type="secondary">支持批量导入生意参谋原始明细或合并结果工作簿，导入前先预览和校验。</Typography.Text></div><Button icon={<ReloadOutlined />} onClick={() => void batchesQuery.refetch()}>刷新记录</Button></div>

      <Card className="upload-card" bordered={false}>
        <div className="section-heading"><div><Typography.Title level={4}>上传榜单文件</Typography.Title><Typography.Text type="secondary">支持同时选择多份 .xlsx 文件，单文件最大 50 MB，最多 100 份。</Typography.Text></div><Tag color="blue">Excel .xlsx</Tag></div>
        <Upload.Dragger accept=".xlsx" multiple directory fileList={fileList} beforeUpload={() => false} onChange={({ fileList: next }) => setFileList(next.filter((file) => !file.name.startsWith("~$")))} onRemove={(file) => { setFileList((current) => current.filter((item) => item.uid !== file.uid)); return true; }}>
          <p className="upload-drag-icon"><CloudUploadOutlined /></p><p className="ant-upload-text">点击选择文件，或将 Excel 文件拖拽到这里</p><p className="ant-upload-hint">可以多选 Excel 文件或直接选择整个文件夹；也可以上传合并结果工作簿。</p>
        </Upload.Dragger>
        <div className="upload-actions"><Typography.Text type="secondary">已选择 {fileList.length} 个文件</Typography.Text><Space><Button onClick={() => { setFileList([]); setPreview(null); setBatchId(undefined); }}>清空</Button><Button type="primary" icon={<FileExcelOutlined />} loading={uploading} disabled={!fileList.length} onClick={() => void createPreview()}>解析并预览</Button></Space></div>
      </Card>

      {preview && <Card className="table-card" bordered={false}>
        <div className="section-heading"><div><Typography.Title level={4}>导入预览</Typography.Title><Typography.Text type="secondary">批次编号：{preview.batchId}</Typography.Text></div><StatusTag status={currentBatch?.status ?? preview.status} /></div>
        <div className="import-summary-grid"><div><span>文件数</span><strong>{preview.totalFiles}</strong></div><div><span>读取数据行</span><strong>{preview.totalRows.toLocaleString()}</strong></div><div><span>有效数据行</span><strong>{preview.validRows.toLocaleString()}</strong></div><div><span>异常行</span><strong className={preview.errorRows ? "text-danger" : ""}>{preview.errorRows.toLocaleString()}</strong></div><div><span>重复文件</span><strong>{preview.duplicateFiles}</strong></div></div>
        <Table rowKey="id" columns={fileColumns} dataSource={preview.files} pagination={false} size="small" scroll={{ x: 900 }} />
        {preview.files.some((file) => file.parseError) && <Alert type="error" showIcon message="部分文件无法解析" description={preview.files.filter((file) => file.parseError).map((file) => `${file.originalName}：${file.parseError}`).join("；")} className="section-alert" />}
        {preview.errorRows > 0 && <Alert type="warning" showIcon message={`发现 ${preview.errorRows} 行异常数据`} description="异常行不会写入数据库；其他通过校验的数据仍可正常导入。导入完成后可在批次详情中查看错误行号。" className="section-alert" />}
        {previewErrors.length > 0 && <Table rowKey={(row) => `${row.fileName}-${row.row}`} size="small" pagination={{ pageSize: 5 }} dataSource={previewErrors} columns={[{ title: "文件", dataIndex: "fileName", key: "file", ellipsis: true }, { title: "行号", dataIndex: "row", key: "row", width: 70 }, { title: "商品ID", dataIndex: "productId", key: "id", width: 130 }, { title: "错误原因", dataIndex: "message", key: "message" }]} />}
        {preview.previewRows.length > 0 && <><div className="subsection-heading">数据样例（最多展示 20 行）</div><Table rowKey={(row) => `${row.productId}-${row.weekStart}`} columns={previewColumns} dataSource={preview.previewRows} pagination={false} size="small" scroll={{ x: 900 }} /></>}
        <div className="upload-actions"><div>{currentBatch?.status === "QUEUED" || currentBatch?.status === "PROCESSING" ? <Space><Progress type="circle" percent={currentBatch.status === "QUEUED" ? 10 : 65} size={28} showInfo={false} /><Typography.Text>正在后台导入，请勿关闭页面</Typography.Text></Space> : currentBatch?.status === "COMPLETED" ? <Typography.Text type="success"><CheckCircleOutlined /> 导入完成</Typography.Text> : <Typography.Text type="secondary">确认后才会写入商品和历史数据。</Typography.Text>}</div><Button type="primary" loading={confirming} disabled={!preview.validRows || Boolean(currentBatch && currentBatch.status !== "PREVIEW")} onClick={() => void confirmImport()}>确认导入 {preview.validRows.toLocaleString()} 行</Button></div>
        {currentBatch?.status === "COMPLETED" && <Alert type="success" showIcon message="本批次处理完成" description={`新增商品 ${currentBatch.newProducts} 件，新增历史 ${currentBatch.createdHistories} 条，更新历史 ${currentBatch.updatedHistories} 条，重复 ${currentBatch.duplicateRows} 条，异常 ${currentBatch.errorRows} 行。`} />}
        {currentBatch?.status === "FAILED" && <Alert type="error" showIcon message="导入失败" description="请查看批次详情或重新上传文件。" />}
      </Card>}

      {!preview && currentBatch && <Card className="table-card" bordered={false}>
        <div className="section-heading"><div><Typography.Title level={4}>批次详情</Typography.Title><Typography.Text type="secondary">批次编号：{currentBatch.id}</Typography.Text></div><StatusTag status={currentBatch.status} /></div>
        <div className="import-summary-grid"><div><span>文件数</span><strong>{currentBatch.totalFiles}</strong></div><div><span>读取数据行</span><strong>{currentBatch.totalRows.toLocaleString()}</strong></div><div><span>成功入库</span><strong>{currentBatch.importedRows.toLocaleString()}</strong></div><div><span>重复记录</span><strong>{currentBatch.duplicateRows.toLocaleString()}</strong></div><div><span>异常行</span><strong>{currentBatch.errorRows.toLocaleString()}</strong></div></div>
        <Table rowKey="id" size="small" dataSource={currentBatch.files} pagination={false} columns={[{ title: "文件名", dataIndex: "originalName", key: "name", ellipsis: true }, { title: "读取行数", dataIndex: "rowCount", key: "rows", width: 100 }, { title: "导入行数", dataIndex: "importedCount", key: "imported", width: 100 }, { title: "异常行", dataIndex: "errorCount", key: "errors", width: 90 }, { title: "状态", dataIndex: "status", key: "status", width: 110, render: (value: string) => <StatusTag status={value} /> }]} />
        {batchErrors.length > 0 && <><div className="subsection-heading">错误行明细（最多显示每个文件前 200 行）</div><Table rowKey={(row) => `${row.fileName}-${row.row}`} size="small" pagination={{ pageSize: 10 }} dataSource={batchErrors} columns={[{ title: "文件", dataIndex: "fileName", key: "file", ellipsis: true }, { title: "行号", dataIndex: "row", key: "row", width: 70 }, { title: "商品ID", dataIndex: "productId", key: "id", width: 130 }, { title: "错误原因", dataIndex: "message", key: "message" }]} /></>}
      </Card>}

      <Card className="table-card" bordered={false}>
        <div className="table-heading"><div><Typography.Title level={4}>最近导入批次</Typography.Title><Typography.Text type="secondary">查看历史导入状态和数据处理结果。</Typography.Text></div></div>
        <Table<ImportBatch> rowKey="id" loading={batchesQuery.isLoading} dataSource={batchesQuery.data ?? []} pagination={{ pageSize: 8, showSizeChanger: false }} scroll={{ x: 1000 }} columns={[
          { title: "批次", dataIndex: "id", key: "id", width: 210, ellipsis: true },
          { title: "上传时间", dataIndex: "createdAt", key: "time", width: 170, render: (value: string) => dayjs(value).format("YYYY-MM-DD HH:mm") },
          { title: "文件数", dataIndex: "totalFiles", key: "files", width: 80 },
          { title: "数据行", dataIndex: "totalRows", key: "rows", width: 100, render: (value: number) => value.toLocaleString() },
          { title: "入库行", dataIndex: "importedRows", key: "imported", width: 100, render: (value: number) => value.toLocaleString() },
          { title: "重复", dataIndex: "duplicateRows", key: "duplicate", width: 80 },
          { title: "异常", dataIndex: "errorRows", key: "errors", width: 80 },
          { title: "状态", dataIndex: "status", key: "status", width: 100, render: (value: string) => <StatusTag status={value} /> },
          { title: "操作", key: "action", width: 90, render: (_: unknown, row: ImportBatch) => <Button size="small" onClick={() => { setBatchId(row.id); setPreview(null); }}>查看批次</Button> },
        ]} />
      </Card>
    </div>
  );
}
