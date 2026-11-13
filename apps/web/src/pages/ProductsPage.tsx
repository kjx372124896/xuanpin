import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Checkbox, Empty, Image, Input, InputNumber, Pagination, Segmented, Select, Space, Table, Tag, Tooltip, Typography, message } from "antd";
import { CloudDownloadOutlined, FilterOutlined, LinkOutlined, ReloadOutlined, SearchOutlined, StarFilled, StarOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import type { Paginated, ProductListItem } from "@selection/shared";
import { api, errorMessage } from "../api";
import { useAuth } from "../auth/AuthContext";
import { useNavigate } from "react-router-dom";

interface Filters {
  keyword?: string;
  categoryLevel1?: string;
  categoryLevel2?: string;
  shopType?: string;
  latestWeekStarts?: string[];
  latestBuyerMedianGt?: number;
  historyWeekCountMin?: number;
  consecutiveWeekCountMin?: number;
  aiMetricsStatus?: "NOT_FETCHED" | "FETCHED";
  favoritesOnly?: boolean;
}
interface CategoryOptions { level1: string[]; level2: string[] }
interface PeriodOptions { periods: string[] }
interface TeamFavoriteProduct extends ProductListItem {
  favoriteCount: number;
  favoriteUsers: Array<{ userId: string; name: string; username: string; department: string | null; favoritedAt: string }>;
}
interface ProductTableRow extends ProductListItem {
  favoriteCount?: number;
  favoriteUsers?: TeamFavoriteProduct["favoriteUsers"];
}
const ProductDetailModal = lazy(() => import("./ProductDetailPage").then((module) => ({ default: module.ProductDetailModal })));

function dateText(value: string | null) { return value ? dayjs(value).format("YYYY-MM-DD") : "—"; }
function numberText(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

function MetricSummary({ metric }: { metric: ProductListItem["buyer"] }) {
  return <div className="metric-summary" title={metric.raw ?? undefined}><span>最小：{numberText(metric.min)}</span><span>最大：{numberText(metric.max)}</span><strong>中值：{numberText(metric.median)}</strong></div>;
}

function BuyerTrend({ points }: { points: ProductListItem["buyerTrend"] }) {
  const valid = points.map((point, index) => ({ index, median: point.median })).filter((point): point is { index: number; median: number } => point.median !== null && Number.isFinite(point.median));
  if (!valid.length) return <Typography.Text type="secondary">暂无趋势</Typography.Text>;
  const values = valid.map((point) => point.median);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coordinates = valid.map((point) => {
    const x = points.length === 1 ? 145 : 5 + (point.index / (points.length - 1)) * 140;
    const y = 34 - ((point.median - min) / span) * 27;
    return { x, y };
  });
  const polyline = coordinates.map((point) => point.x + "," + point.y).join(" ");
  const last = coordinates[coordinates.length - 1];
  return (
    <div className="buyer-trend-cell">
      <svg viewBox="0 0 150 40" role="img" aria-label={"支付买家数中值趋势：" + numberText(values[0]) + " 到 " + numberText(values[values.length - 1])}>
        <polyline points={polyline} fill="none" stroke="#315efb" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={last.x} cy={last.y} r="3" fill="#315efb" />
      </svg>
      <span>{numberText(valid[0].median)} → {numberText(valid[valid.length - 1].median)}</span>
    </div>
  );
}

function openProductUrl(url: string | null) {
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}

export function ProductsPage() {
  const [draft, setDraft] = useState<Filters>({});
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [favoriteLoadingId, setFavoriteLoadingId] = useState<string | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [teamFavoritesMode, setTeamFavoritesMode] = useState(false);
  const [memberKeyword, setMemberKeyword] = useState("");
  const [creatingTask, setCreatingTask] = useState(false);
  const tableWrapperRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";
  const params = useMemo(() => ({
    page,
    pageSize,
    ...filters,
    latestWeekStarts: filters.latestWeekStarts?.join(",") || undefined,
  }), [page, pageSize, filters]);
  const productsQuery = useQuery({
    queryKey: ["products", params],
    queryFn: async () => (await api.get<Paginated<ProductListItem>>("/products", { params })).data,
  });
  const teamParams = useMemo(() => ({ ...params, favoritesOnly: undefined, memberKeyword: memberKeyword.trim() || undefined }), [params, memberKeyword]);
  const teamFavoritesQuery = useQuery({
    queryKey: ["team-favorites", teamParams],
    queryFn: async () => (await api.get<Paginated<TeamFavoriteProduct>>("/products/team-favorites", { params: teamParams })).data,
    enabled: isAdmin && teamFavoritesMode,
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories", draft.categoryLevel1],
    queryFn: async () => (await api.get<CategoryOptions>("/products/categories", { params: draft.categoryLevel1 ? { level1: draft.categoryLevel1 } : {} })).data,
  });
  const periodsQuery = useQuery({
    queryKey: ["product-periods"],
    queryFn: async () => (await api.get<PeriodOptions>("/products/periods")).data,
  });
  const activeQuery = isAdmin && teamFavoritesMode ? teamFavoritesQuery : productsQuery;
  const data = activeQuery.data;

  useEffect(() => {
    const tableBody = tableWrapperRef.current?.querySelector<HTMLElement>(".ant-table-body");
    if (tableBody) tableBody.scrollTop = 0;
  }, [page, pageSize, teamFavoritesMode]);

  const columns: ColumnsType<ProductTableRow> = [
    {
      title: "商品", dataIndex: "productName", key: "productName", width: 240,
      render: (_value, item) => (
        <div className="product-cell">
          <Image
            src={item.imageUrl || undefined}
            width={72}
            height={72}
            className="product-thumb"
            fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72'%3E%3Crect width='100%25' height='100%25' fill='%23edf1f7'/%3E%3C/svg%3E"
          />
          <div className="product-cell-copy">
            <Button type="link" className="product-name-link" onClick={() => setSelectedProductId(item.productId)}>{item.productName}</Button>
            <div className="product-meta-row">
              <Typography.Text type="secondary" className="product-id">ID：{item.productId}</Typography.Text>
              <Button type="link" size="small" icon={<LinkOutlined />} disabled={!item.productUrl} className="open-product-link" onClick={() => openProductUrl(item.productUrl)}>打开链接</Button>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "收藏",
      key: "favorite",
      width: 58,
      align: "center",
      render: (_value, item) => (
        <Tooltip title={item.isFavorited ? "取消收藏" : "收藏商品"}>
          <Button
            type="text"
            size="small"
            className={item.isFavorited ? "favorite-button is-favorited" : "favorite-button"}
            icon={item.isFavorited ? <StarFilled /> : <StarOutlined />}
            loading={favoriteLoadingId === item.productId}
            aria-label={item.isFavorited ? "取消收藏" : "收藏商品"}
            onClick={() => void toggleFavorite(item)}
          />
        </Tooltip>
      ),
    },
    { title: "一级 / 二级类目", key: "category", width: 145, render: (_value, item) => <div><div>{item.latestCategoryLevel1 || "—"}</div><Typography.Text type="secondary" className="table-subtext">{item.latestCategoryLevel2 || "无二级类目"}</Typography.Text></div> },
    { title: "店铺", dataIndex: "shopName", key: "shop", width: 120, render: (value, item) => <div><div>{value || "—"}</div><Typography.Text type="secondary" className="table-subtext">{item.shopType || ""}</Typography.Text></div> },
    { title: "最新支付买家数", key: "buyer", width: 125, render: (_value, item) => <MetricSummary metric={item.buyer} /> },
    { title: "趋势", key: "buyerTrend", width: 185, render: (_value, item) => <BuyerTrend points={item.buyerTrend} /> },
    { title: "最新访客数", key: "visitor", width: 125, render: (_value, item) => <MetricSummary metric={item.visitor} /> },
    { title: "上榜周数", dataIndex: "historyWeekCount", key: "weeks", width: 80, align: "center" },
    { title: "连续周数", dataIndex: "consecutiveWeekCount", key: "streak", width: 80, align: "center", render: (value) => <span className={value >= 4 ? "streak-strong" : ""}>{value}</span> },
    { title: "最近周期起止日期", key: "latestPeriod", width: 155, render: (_value, item) => <div className="date-range-cell"><span>开始：{dateText(item.latestWeekStart)}</span><span>结束：{dateText(item.latestWeekEnd)}</span></div> },
    { title: "上期销售额", dataIndex: "aiPreviousSales", key: "aiPreviousSales", width: 112, render: (value: string | null) => <span className="ai-metric-cell" title={value || undefined}>{value || "—"}</span> },
    { title: "销售额", dataIndex: "aiSales", key: "aiSales", width: 112, render: (value: string | null) => <span className="ai-metric-cell" title={value || undefined}>{value || "—"}</span> },
    { title: "点击率", dataIndex: "aiClickRate", key: "aiClickRate", width: 105, render: (value: string | null) => <span className="ai-metric-cell" title={value || undefined}>{value || "—"}</span> },
    { title: "转化率", dataIndex: "aiConversionRate", key: "aiConversionRate", width: 105, render: (value: string | null) => <span className="ai-metric-cell" title={value || undefined}>{value || "—"}</span> },
    { title: "加购率", dataIndex: "aiAddToCartRate", key: "aiAddToCartRate", width: 105, render: (value: string | null) => <span className="ai-metric-cell" title={value || undefined}>{value || "—"}</span> },
    { title: "加购成本", dataIndex: "aiAddToCartCost", key: "aiAddToCartCost", width: 112, render: (value: string | null) => <span className="ai-metric-cell" title={value || undefined}>{value || "—"}</span> },
    { title: "投产比", dataIndex: "aiRoi", key: "aiRoi", width: 100, render: (value: string | null) => <span className="ai-metric-cell" title={value || undefined}>{value || "—"}</span> },
    { title: "件单价", dataIndex: "aiUnitPrice", key: "aiUnitPrice", width: 105, render: (value: string | null) => <span className="ai-metric-cell" title={value || undefined}>{value || "—"}</span> },
    { title: "花费", dataIndex: "aiSpend", key: "aiSpend", width: 105, render: (value: string | null) => <span className="ai-metric-cell" title={value || undefined}>{value || "—"}</span> },
    { title: "CPC", dataIndex: "aiCpc", key: "aiCpc", width: 105, render: (value: string | null) => <span className="ai-metric-cell" title={value || undefined}>{value || "—"}</span> },
  ];
  if (isAdmin && teamFavoritesMode) {
    columns.splice(2, 0, {
      title: "收藏成员",
      key: "favoriteMembers",
      width: 190,
      render: (_value, item) => {
        const members = item.favoriteUsers ?? [];
        const names = members.map((member) => member.name).filter(Boolean);
        return <Tooltip title={members.map((member) => `${member.name}（${member.username}）${member.department ? ` · ${member.department}` : ""}`).join("、")}><span>{names.slice(0, 3).join("、")}{names.length > 3 ? ` 等 ${names.length} 人` : ""} <Tag>{item.favoriteCount ?? names.length} 人</Tag></span></Tooltip>;
      },
    });
  }

  function applyFilters() { setPage(1); setFilters({ ...draft }); }
  function resetFilters() { setDraft({}); setFilters({}); setPage(1); }
  async function toggleFavorite(item: ProductListItem) {
    setFavoriteLoadingId(item.productId);
    try {
      const path = `/products/${encodeURIComponent(item.productId)}/favorite`;
      if (item.isFavorited) await api.delete(path);
      else await api.post(path);
      if (filters.favoritesOnly) setPage(1);
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      await queryClient.invalidateQueries({ queryKey: ["team-favorites"] });
    } catch {
      message.error("收藏操作失败，请稍后重试。");
    } finally {
      setFavoriteLoadingId(null);
    }
  }

  async function startAiMetrics() {
    const ids = [...new Set(selectedProductIds)];
    if (!isAdmin || !ids.length || creatingTask) return;
    setCreatingTask(true);
    try {
      const result = (await api.post<{ id: string; totalBatches: number }>("/dmp/tasks", { productIds: ids })).data;
      setSelectedProductIds([]);
      message.success(`后台任务已提交：${ids.length} 件商品，分为 ${result.totalBatches} 批执行。`);
      await queryClient.invalidateQueries({ queryKey: ["dmpTasks"] });
      navigate("/dmp-auth");
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setCreatingTask(false);
    }
  }

  return (
    <div className="page-stack products-page">
      <div className="page-heading-row page-heading-compact">
        <div>
          <div className="eyebrow">PRODUCT OVERVIEW</div>
          <Typography.Title level={2}>商品选品</Typography.Title>
          <Typography.Text type="secondary">按商品 ID 汇总榜单记录，查看支付买家数与访客数变化趋势。</Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void activeQuery.refetch()}>刷新数据</Button>
      </div>

      <Card className="filter-card filter-card-compact" bordered={false}>
        <div className="filter-title"><FilterOutlined /> 筛选商品</div>
        <div className="filter-grid">
          <div className="filter-field filter-field-keyword">
            <label htmlFor="filter-keyword">商品搜索</label>
            <Input id="filter-keyword" allowClear value={draft.keyword} onChange={(event) => setDraft((prev) => ({ ...prev, keyword: event.target.value }))} onPressEnter={applyFilters} prefix={<SearchOutlined />} placeholder="名称 / ID / 店铺" />
          </div>
          <div className="filter-field filter-field-periods">
            <label htmlFor="filter-periods">最新上榜周日期</label>
            <Select
              id="filter-periods"
              mode="multiple"
              allowClear
              showSearch
              optionFilterProp="label"
              maxTagCount="responsive"
              value={draft.latestWeekStarts ?? []}
              onChange={(value) => setDraft((prev) => ({ ...prev, latestWeekStarts: value }))}
              placeholder="不限（可多选）"
              options={(periodsQuery.data?.periods ?? []).map((value) => ({ label: dayjs(value).format("YYYY-MM-DD"), value }))}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="filter-category-level1">一级类目</label>
            <Select id="filter-category-level1" allowClear showSearch optionFilterProp="label" value={draft.categoryLevel1} onChange={(value) => setDraft((prev) => ({ ...prev, categoryLevel1: value, categoryLevel2: undefined }))} placeholder="全部" options={(categoriesQuery.data?.level1 ?? []).map((value) => ({ label: value, value }))} />
          </div>
          <div className="filter-field">
            <label htmlFor="filter-category-level2">二级类目</label>
            <Select id="filter-category-level2" allowClear showSearch optionFilterProp="label" disabled={!draft.categoryLevel1} value={draft.categoryLevel2} onChange={(value) => setDraft((prev) => ({ ...prev, categoryLevel2: value }))} placeholder="全部" options={(categoriesQuery.data?.level2 ?? []).map((value) => ({ label: value, value }))} />
          </div>
          <div className="filter-field">
            <label htmlFor="filter-shop-type">店铺类型</label>
            <Select id="filter-shop-type" allowClear value={draft.shopType} onChange={(value) => setDraft((prev) => ({ ...prev, shopType: value }))} placeholder="全部" options={[{ label: "淘宝", value: "淘宝" }, { label: "天猫", value: "天猫" }]} />
          </div>
          <div className="filter-field">
            <label htmlFor="filter-buyer-median">最新支付买家数中值 &gt;</label>
            <InputNumber
              id="filter-buyer-median"
              min={0}
              precision={0}
              value={draft.latestBuyerMedianGt}
              onChange={(value) => setDraft((prev) => ({ ...prev, latestBuyerMedianGt: value === null ? undefined : Number(value) }))}
              placeholder="输入数值"
            />
          </div>
          <div className="filter-field">
            <label htmlFor="filter-history-weeks">上榜周数 ≥</label>
            <InputNumber id="filter-history-weeks" min={0} precision={0} value={draft.historyWeekCountMin} onChange={(value) => setDraft((prev) => ({ ...prev, historyWeekCountMin: value === null ? undefined : Number(value) }))} placeholder="输入周数" />
          </div>
          <div className="filter-field">
            <label htmlFor="filter-consecutive-weeks">连续上榜周数 ≥</label>
            <InputNumber id="filter-consecutive-weeks" min={0} precision={0} value={draft.consecutiveWeekCountMin} onChange={(value) => setDraft((prev) => ({ ...prev, consecutiveWeekCountMin: value === null ? undefined : Number(value) }))} placeholder="输入周数" />
          </div>
          <div className="filter-field filter-field-ai-status">
            <label htmlFor="filter-ai-status">数据获取状态</label>
            <Select
              id="filter-ai-status"
              allowClear
              value={draft.aiMetricsStatus}
              onChange={(value) => setDraft((prev) => ({ ...prev, aiMetricsStatus: value || undefined }))}
              placeholder="全部商品"
              options={[{ label: "未获取数据", value: "NOT_FETCHED" }, { label: "已获取数据", value: "FETCHED" }]}
            />
          </div>
          {isAdmin && teamFavoritesMode ? (
            <div className="filter-field filter-field-favorites">
              <label htmlFor="filter-member-keyword">收藏成员</label>
              <Input id="filter-member-keyword" allowClear value={memberKeyword} onChange={(event) => { setMemberKeyword(event.target.value); setPage(1); }} placeholder="姓名 / 账号 / 部门" />
            </div>
          ) : (
            <div className="filter-field filter-field-favorites">
              <label htmlFor="filter-favorites">收藏范围</label>
              <Checkbox id="filter-favorites" checked={draft.favoritesOnly ?? false} onChange={(event) => setDraft((prev) => ({ ...prev, favoritesOnly: event.target.checked || undefined }))}>仅看我的收藏</Checkbox>
            </div>
          )}
          <Space className="filter-actions"><Button type="primary" onClick={applyFilters}>查询</Button><Button onClick={resetFilters}>重置</Button></Space>
        </div>
      </Card>

      <Card className="table-card table-card-products" bordered={false}>
        <div className="table-heading">
          <div>
            <Typography.Title level={4}>{teamFavoritesMode && isAdmin ? "成员收藏" : "商品列表"}</Typography.Title>
            <Typography.Text type="secondary">{teamFavoritesMode && isAdmin ? "汇总所有普通成员收藏的商品，管理员可统一勾选并提交后台数据获取任务。" : "点击商品名称查看完整趋势，点击“打开链接”在新标签页查看商品。收藏商品后由管理员统一安排数据获取。"}</Typography.Text>
          </div>
          {isAdmin && (
            <div className="bulk-ai-actions">
              <Segmented
                value={teamFavoritesMode ? "team" : "all"}
                options={[{ label: "全部商品", value: "all" }, { label: "成员收藏", value: "team" }]}
                onChange={(value) => { setTeamFavoritesMode(value === "team"); setSelectedProductIds([]); setPage(1); }}
              />
              <Button type="primary" icon={<CloudDownloadOutlined />} disabled={!selectedProductIds.length || creatingTask} loading={creatingTask} onClick={() => void startAiMetrics()}>获取更多数据</Button>
              <div className="bulk-ai-meta">
                <Typography.Text strong>已选 {selectedProductIds.length} 件</Typography.Text>
                <Typography.Text type="secondary">可跨页保留选择；后台自动按每批50件执行</Typography.Text>
              </div>
              <Button type="link" disabled={!selectedProductIds.length || creatingTask} onClick={() => setSelectedProductIds([])}>清空选择</Button>
            </div>
          )}
          <div className="table-heading-actions">
            <Pagination
              size="small"
              current={page}
              pageSize={pageSize}
              total={data?.total ?? 0}
              showSizeChanger
              showLessItems
              pageSizeOptions={[50, 100]}
              onChange={(nextPage, nextSize) => {
                setPage(nextPage);
                setPageSize(nextSize);
              }}
            />
            <Tag color="blue">共 {data?.total ?? 0} 件</Tag>
          </div>
        </div>
        <div className="products-table-scroll" ref={tableWrapperRef}>
          <Table<ProductTableRow>
            rowKey="productId"
            columns={columns}
            dataSource={data?.items ?? []}
            rowSelection={isAdmin ? {
              selectedRowKeys: selectedProductIds,
              preserveSelectedRowKeys: true,
              onChange: (keys) => setSelectedProductIds(keys.map(String)),
            } : undefined}
            loading={activeQuery.isLoading || activeQuery.isFetching}
            scroll={{ x: 2600, y: "calc(100vh - 390px)" }}
            size="middle"
            locale={{ emptyText: <Empty description="暂无商品数据，请先导入生意参谋 Excel 榜单" /> }}
            pagination={false}
          />
        </div>
      </Card>
      <Suspense fallback={null}>
        <ProductDetailModal productId={selectedProductId ?? ""} open={Boolean(selectedProductId)} onClose={() => setSelectedProductId(null)} />
      </Suspense>
    </div>
  );
}
