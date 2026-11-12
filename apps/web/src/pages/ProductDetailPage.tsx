import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, Col, Empty, Image, Modal, Row, Select, Space, Spin, Statistic, Table, Tag, Typography } from "antd";
import { LinkOutlined } from "@ant-design/icons";
import ReactECharts from "echarts-for-react";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import type { ProductHistoryItem, ProductListItem } from "@selection/shared";
import { api } from "../api";

interface DetailResponse { product: Omit<ProductListItem, "buyerTrend" | "isFavorited">; histories: Array<ProductHistoryItem & { sourceFileName?: string | null }> }

function numberText(value: number | null) { return value === null ? "—" : value.toLocaleString("zh-CN", { maximumFractionDigits: 1 }); }
function metricCell(metric: ProductHistoryItem["buyer"]) {
  return <div className="history-metric-cell" title={metric.raw ?? undefined}><span>最小：{numberText(metric.min)}</span><span>最大：{numberText(metric.max)}</span><strong>中值：{numberText(metric.median)}</strong></div>;
}
function chartOption(rows: ProductHistoryItem[], key: "buyer" | "visitor") {
  const values = rows.map((row) => row[key]);
  const lower = values.map((item) => item.min);
  const band = values.map((item) => item.min === null || item.max === null ? null : item.max - item.min);
  const middle = values.map((item) => item.median);
  return {
    animation: true,
    grid: { left: 52, right: 24, top: 36, bottom: 42 },
    legend: { data: ["区间范围", "中值"], top: 0, right: 8, textStyle: { color: "#7a8497" } },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#182238",
      borderWidth: 0,
      textStyle: { color: "#fff" },
      formatter: (params: Array<{ dataIndex: number }>) => {
        const row = rows[params[0]?.dataIndex ?? 0];
        const metric = row[key];
        return `${dayjs(row.weekStart).format("YYYY-MM-DD")} 至 ${dayjs(row.weekEnd).format("MM-DD")}<br/>原始值：${metric.raw ?? "无"}<br/>最小值：${metric.min ?? "—"}<br/>最大值：${metric.max ?? "—"}<br/>中值：${metric.median ?? "—"}`;
      },
    },
    xAxis: { type: "category", boundaryGap: false, data: rows.map((row) => dayjs(row.weekStart).format("MM/DD")), axisLine: { lineStyle: { color: "#e6eaf0" } }, axisLabel: { color: "#8a93a3" } },
    yAxis: { type: "value", splitLine: { lineStyle: { color: "#edf0f5", type: "dashed" } }, axisLabel: { color: "#8a93a3" } },
    series: [
      { name: "区间下限", type: "line", stack: "range", data: lower, symbol: "none", lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, emphasis: { disabled: true } },
      { name: "区间范围", type: "line", stack: "range", data: band, symbol: "none", lineStyle: { opacity: 0 }, areaStyle: { color: "rgba(49,94,251,0.16)" }, emphasis: { disabled: true } },
      { name: "中值", type: "line", data: middle, smooth: 0.25, symbol: "circle", symbolSize: 7, lineStyle: { width: 3 }, itemStyle: { borderWidth: 2, borderColor: "#fff" } },
    ],
  };
}

export function ProductDetailModal({ productId, open, onClose }: { productId: string; open: boolean; onClose: () => void }) {
  const [category, setCategory] = useState<string>();
  const [period, setPeriod] = useState("ALL");
  const query = useQuery({ queryKey: ["product", productId], queryFn: async () => (await api.get<DetailResponse>(`/products/${encodeURIComponent(productId)}`)).data, enabled: Boolean(productId) && open });
  const data = query.data;

  useEffect(() => {
    setCategory(data?.product.latestCategory ?? undefined);
    setPeriod("ALL");
  }, [productId, data?.product.latestCategory]);

  const categories = useMemo(() => [...new Set((data?.histories ?? []).map((row) => row.categoryName))], [data?.histories]);
  const historyRows = useMemo(() => {
    let rows = (data?.histories ?? []).filter((row) => !category || row.categoryName === category);
    if (period !== "ALL") rows = rows.slice(-Number(period));
    return rows;
  }, [data?.histories, category, period]);
  const tableColumns: ColumnsType<ProductHistoryItem> = [
    { title: "开始日期", dataIndex: "weekStart", key: "weekStart", width: 112, render: (value) => dayjs(value).format("YYYY-MM-DD") },
    { title: "结束日期", dataIndex: "weekEnd", key: "weekEnd", width: 112, render: (value) => dayjs(value).format("YYYY-MM-DD") },
    { title: "一级类目", dataIndex: "categoryLevel1", key: "categoryLevel1" },
    { title: "二级类目", dataIndex: "categoryLevel2", key: "categoryLevel2", render: (value) => value || "—" },
    { title: "排名", dataIndex: "rank", key: "rank", align: "center", render: (value) => value ? `#${value}` : "—" },
    { title: "支付买家数（数值）", key: "buyer", width: 150, render: (_value, row) => metricCell(row.buyer) },
    { title: "访客数（数值）", key: "visitor", width: 150, render: (_value, row) => metricCell(row.visitor) },
    { title: "加购人数（数值）", key: "cart", width: 150, render: (_value, row) => metricCell(row.cart) },
    { title: "趋势", dataIndex: "trend", key: "trend", render: (value) => value ? <Tag>{value}</Tag> : "—" },
  ];

  if (!open) return null;
  if (query.isLoading) return <Modal open={open} onCancel={onClose} footer={null} width={1360} title="商品详情"><div className="product-detail-modal-loading"><Spin size="large" /></div></Modal>;
  if (!data) return <Modal open={open} onCancel={onClose} footer={null} width={900} title="商品详情"><Empty description="没有找到这件商品" /></Modal>;
  const product = data.product;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={1360}
      title={<span>{product.productName}<Typography.Text type="secondary" className="product-detail-modal-id">商品 ID：{product.productId}</Typography.Text></span>}
      className="product-detail-modal"
      destroyOnHidden
    >
    <div className="page-stack product-detail-modal-content">
      <Card className="detail-hero" bordered={false}>
        <div className="detail-product-main">
          <Image src={product.imageUrl || undefined} width={116} height={116} className="detail-product-image" fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='116' height='116'%3E%3Crect width='100%25' height='100%25' fill='%23edf1f7'/%3E%3C/svg%3E" />
          <div className="detail-product-copy"><div className="eyebrow">PRODUCT PROFILE</div><Typography.Title level={3}>{product.productName}</Typography.Title><Space wrap><Tag color="blue">{product.latestCategoryLevel1 || "未分类"}</Tag>{product.latestCategoryLevel2 && <Tag>{product.latestCategoryLevel2}</Tag>}<Tag>{product.shopType || "未知店铺类型"}</Tag><Typography.Text type="secondary">商品 ID：{product.productId}</Typography.Text></Space><div className="detail-shopline">店铺：{product.shopName || "—"}{product.productUrl && <a href={product.productUrl} target="_blank" rel="noreferrer"><LinkOutlined /> 打开商品链接</a>}</div></div>
        </div>
        <Row gutter={16} className="detail-stat-row">
          <Col xs={12} md={6}><Statistic title="最新行业排名" value={product.latestRank ?? "—"} prefix={product.latestRank ? "#" : undefined} /></Col>
          <Col xs={12} md={6}><Statistic title="历史上榜周数" value={product.historyWeekCount} suffix="周" /></Col>
          <Col xs={12} md={6}><Statistic title="连续上榜周数" value={product.consecutiveWeekCount} suffix="周" /></Col>
          <Col xs={12} md={6}><Statistic title="最新支付买家数中值" value={numberText(product.buyer.median)} valueStyle={{ fontSize: 19 }} /></Col>
        </Row>
      </Card>

      <Card className="chart-card" bordered={false}>
        <div className="chart-heading"><div><Typography.Title level={4}>商品趋势分析</Typography.Title><Typography.Text type="secondary">折线为支付买家数/访客数区间中值，阴影表示原始区间范围，不代表精确人数。</Typography.Text></div><Space wrap><Select value={category} onChange={setCategory} style={{ minWidth: 230 }} options={categories.map((value) => ({ label: value, value }))} /><Select value={period} onChange={setPeriod} style={{ width: 120 }} options={[{ label: "全部周期", value: "ALL" }, { label: "最近 4 周", value: "4" }, { label: "最近 8 周", value: "8" }, { label: "最近 12 周", value: "12" }]} /></Space></div>
        {historyRows.length ? <Row gutter={[18, 18]}><Col xs={24} xl={12}><div className="chart-panel"><div className="chart-panel-title">支付买家数趋势</div><ReactECharts option={chartOption(historyRows, "buyer")} style={{ height: 310 }} notMerge /></div></Col><Col xs={24} xl={12}><div className="chart-panel"><div className="chart-panel-title">访客数趋势</div><ReactECharts option={chartOption(historyRows, "visitor")} style={{ height: 310 }} notMerge /></div></Col></Row> : <Empty description="当前筛选条件下暂无趋势数据" />}
      </Card>

      <Card className="table-card" bordered={false}>
        <div className="table-heading"><div><Typography.Title level={4}>历史上榜记录</Typography.Title><Typography.Text type="secondary">每个周期、每个类目分别保留原始记录，不跨类目合并指标。</Typography.Text></div><Tag>{historyRows.length} 条</Tag></div>
        <Table<ProductHistoryItem> rowKey="id" columns={tableColumns} dataSource={historyRows} scroll={{ x: 1350 }} pagination={{ pageSize: 10, showSizeChanger: false }} locale={{ emptyText: <Empty description="暂无历史记录" /> }} />
      </Card>
    </div>
    </Modal>
  );
}
