import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Checkbox, DatePicker, Empty, Image, Input, InputNumber, Pagination, Segmented, Select, Space, Table, Tag, Tooltip, Typography, message } from "antd";
import { CloudDownloadOutlined, FilterOutlined, LinkOutlined, ReloadOutlined, SearchOutlined, StarFilled, StarOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import type { BoardType, Paginated, ProductListItem } from "@selection/shared";
import { api, errorMessage } from "../api";
import { useAuth } from "../auth/AuthContext";
import { useNavigate } from "react-router-dom";

interface Filters {
  keyword?: string;
  categoryLevel1?: string[];
  categoryLevel2?: string[];
  shopType?: string;
  listingDateFrom?: string;
  listingDateTo?: string;
  latestWeekStarts?: string[];
  latestBuyerMedianMin?: number;
  latestBuyerMedianMax?: number;
  historyWeekCountMin?: number;
  historyWeekCountMax?: number;
  consecutiveWeekCountMin?: number;
  consecutiveWeekCountMax?: number;
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

function numberText(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

function BuyerTrend({ points }: { points: ProductListItem["buyerTrend"] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const validPoints = points.filter((point) => point.median !== null || point.min !== null || point.max !== null);
  if (!validPoints.length) return <Typography.Text type="secondary">暂无趋势</Typography.Text>;

  const lowerValues = validPoints.map((point) => point.min ?? point.median ?? point.max ?? 0);
  const upperValues = validPoints.map((point, index) => Math.max(lowerValues[index], point.max ?? point.median ?? lowerValues[index]));
  // 趋势小图横向放大1.5倍，图表高度保持158px不变。
  const chartWidth = 495;
  const chartHeight = 158;
  const plot = { left: 38, right: 10, top: 25, bottom: 27 };
  const plotWidth = chartWidth - plot.left - plot.right;
  const plotHeight = chartHeight - plot.top - plot.bottom;
  const maxValue = Math.max(1, ...upperValues, ...validPoints.map((point) => point.median ?? 0));
  // 纵轴上限预留约18%空间，确保最高节点上方也能完整显示数值标签。
  const axisMax = Math.max(4, Math.ceil((maxValue * 1.18) / 4) * 4);
  const yFor = (value: number) => plot.top + plotHeight - (Math.max(0, value) / axisMax) * plotHeight;
  const chartPoints = validPoints.map((point, index) => {
    const lower = lowerValues[index];
    const upper = upperValues[index];
    const medianY = point.median === null ? null : yFor(point.median);
    return {
      point,
      x: validPoints.length === 1 ? plot.left + plotWidth / 2 : plot.left + (index / (validPoints.length - 1)) * plotWidth,
      y: medianY ?? yFor((lower + upper) / 2),
      lowerY: yFor(lower),
      upperY: yFor(upper),
      medianY,
    };
  });
  const bandPoints = [
    ...chartPoints.map((point) => `${point.x},${point.upperY}`),
    ...chartPoints.slice().reverse().map((point) => `${point.x},${point.lowerY}`),
  ].join(" ");
  let medianPath = "";
  let hasPreviousMedian = false;
  chartPoints.forEach((point) => {
    if (point.medianY === null) {
      hasPreviousMedian = false;
      return;
    }
    medianPath += `${hasPreviousMedian ? "L" : "M"} ${point.x} ${point.medianY} `;
    hasPreviousMedian = true;
  });
  const labelStep = Math.max(1, Math.ceil((validPoints.length - 1) / 5));
  const labelIndices = validPoints.map((_, index) => index).filter((index) => index === 0 || index === validPoints.length - 1 || index % labelStep === 0);
  const hoveredPoint = hoveredIndex === null ? null : chartPoints[hoveredIndex];
  const tooltipLeft = hoveredPoint
    ? Math.max(2, Math.min(hoveredPoint.x > chartWidth * 0.62 ? hoveredPoint.x - 174 : hoveredPoint.x + 10, chartWidth - 174))
    : 0;
  const tooltipTop = hoveredPoint
    ? Math.max(2, Math.min(hoveredPoint.y > chartHeight * 0.62 ? hoveredPoint.y - 88 : hoveredPoint.y + 10, chartHeight - 88))
    : 0;
  return (
    <div className="buyer-trend-cell" role="group" aria-label="支付买家数趋势，包含中值折线和最小值至最大值区间范围">
      <div className="buyer-trend-legend">
        <span><i className="buyer-trend-legend-range" />区间范围</span>
        <span><i className="buyer-trend-legend-median" />中值</span>
      </div>
      <div className="buyer-trend-chart-wrap">
        <svg className="buyer-trend-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="按周展示支付买家数中值及区间范围">
          {[0, 1, 2, 3, 4].map((step) => {
            const value = axisMax * step / 4;
            const y = yFor(value);
            return <g key={step}><line x1={plot.left} y1={y} x2={chartWidth - plot.right} y2={y} stroke="#e9edf5" strokeDasharray="3 3" /><text x={plot.left - 7} y={y + 3} fill="#8792a8" fontSize="9" textAnchor="end">{numberText(value)}</text></g>;
          })}
          <line x1={plot.left} y1={plot.top + plotHeight} x2={chartWidth - plot.right} y2={plot.top + plotHeight} stroke="#d9deea" />
          <polygon points={bandPoints} fill="rgba(168, 204, 53, 0.18)" />
          {hoveredPoint && <line x1={hoveredPoint.x} y1={plot.top} x2={hoveredPoint.x} y2={plot.top + plotHeight} stroke="#aeb7c8" strokeDasharray="3 3" />}
          <path d={medianPath} fill="none" stroke="#595c83" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          {chartPoints.map((point, index) => (
            <g
              key={`${point.point.weekStart}-${index}`}
              tabIndex={0}
              role="button"
              aria-label={`${dayjs(point.point.weekStart).format("YYYY-MM-DD")}，支付买家数中值 ${numberText(point.point.median)}`}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              onFocus={() => setHoveredIndex(index)}
              onBlur={() => setHoveredIndex(null)}
              style={{ cursor: "crosshair", outline: "none" }}
            >
              {point.medianY !== null && (
                <>
                  <text
                    x={point.x}
                    y={point.medianY - 9}
                    fill="#45496f"
                    stroke="#fff"
                    strokeWidth="3"
                    paintOrder="stroke"
                    fontSize="10"
                    fontWeight="700"
                    textAnchor={index === 0 ? "start" : index === chartPoints.length - 1 ? "end" : "middle"}
                  >
                    {numberText(point.point.median)}
                  </text>
                  <circle cx={point.x} cy={point.medianY} r="3.3" fill="#595c83" stroke="#fff" strokeWidth="1.2" />
                </>
              )}
              <circle cx={point.x} cy={point.y} r="9" fill="transparent"><title>{`${dayjs(point.point.weekStart).format("YYYY-MM-DD")}：${numberText(point.point.median)}`}</title></circle>
            </g>
          ))}
          {labelIndices.map((index) => {
            const point = chartPoints[index];
            return <text key={index} x={point.x} y={chartHeight - 6} fill="#8792a8" fontSize="9" textAnchor={index === 0 ? "start" : index === chartPoints.length - 1 ? "end" : "middle"}>{dayjs(point.point.weekStart).format("MM/DD")}</text>;
          })}
        </svg>
        {hoveredPoint && (
          <div className="buyer-trend-tooltip" style={{ left: tooltipLeft, top: tooltipTop }}>
            <strong>{dayjs(hoveredPoint.point.weekStart).format("YYYY-MM-DD")} 至 {dayjs(hoveredPoint.point.weekEnd).format("MM-DD")}</strong>
            <span>原始值：{hoveredPoint.point.raw ?? "—"}</span>
            <span>最小值：{numberText(hoveredPoint.point.min)}</span>
            <span>最大值：{numberText(hoveredPoint.point.max)}</span>
            <span>中值：{numberText(hoveredPoint.point.median)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function openProductUrl(url: string | null) {
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}

export function ProductsPage() {
  const [boardType, setBoardType] = useState<BoardType>("NEW_PRODUCT_TRAFFIC");
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
  const [tableScrollY, setTableScrollY] = useState(400);
  const tableWrapperRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";
  const params = useMemo(() => ({
    page,
    pageSize,
    boardType,
    ...filters,
    categoryLevel1: filters.categoryLevel1?.join(",") || undefined,
    categoryLevel2: filters.categoryLevel2?.join(",") || undefined,
    latestWeekStarts: filters.latestWeekStarts?.join(",") || undefined,
  }), [page, pageSize, boardType, filters]);
  const productsQuery = useQuery({
    queryKey: ["products", "board-v1", boardType, params],
    queryFn: async () => (await api.get<Paginated<ProductListItem>>("/products", { params })).data,
  });
  const teamParams = useMemo(() => ({ ...params, favoritesOnly: undefined, memberKeyword: memberKeyword.trim() || undefined }), [params, memberKeyword]);
  const teamFavoritesQuery = useQuery({
    queryKey: ["team-favorites", "board-v1", boardType, teamParams],
    queryFn: async () => (await api.get<Paginated<TeamFavoriteProduct>>("/products/team-favorites", { params: teamParams })).data,
    enabled: isAdmin && teamFavoritesMode,
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories", boardType, draft.categoryLevel1],
    queryFn: async () => (await api.get<CategoryOptions>("/products/categories", {
      params: { boardType, ...(draft.categoryLevel1?.length ? { level1: draft.categoryLevel1.join(",") } : {}) },
    })).data,
  });
  const periodsQuery = useQuery({
    queryKey: ["product-periods", boardType],
    queryFn: async () => (await api.get<PeriodOptions>("/products/periods", { params: { boardType } })).data,
  });
  const activeQuery = isAdmin && teamFavoritesMode ? teamFavoritesQuery : productsQuery;
  const data = activeQuery.data;

  useEffect(() => {
    const tableBody = tableWrapperRef.current?.querySelector<HTMLElement>(".ant-table-body");
    if (tableBody) tableBody.scrollTop = 0;
  }, [page, pageSize, teamFavoritesMode, boardType]);

  // 根据商品列表卡片主体的可用高度计算表格 body 高度，避免滚动容器塌缩时只显示少量行。
  useEffect(() => {
    const container = tableWrapperRef.current;
    if (!container) return;
    const cardBody = container.closest<HTMLElement>(".table-card-products")?.querySelector<HTMLElement>(".ant-card-body");
    const heading = cardBody?.querySelector<HTMLElement>(".table-heading");

    const updateTableHeight = () => {
      const header = container.querySelector<HTMLElement>(".ant-table-thead");
      const headerHeight = header?.getBoundingClientRect().height ?? 44;
      const bodyStyle = cardBody ? window.getComputedStyle(cardBody) : null;
      const headingStyle = heading ? window.getComputedStyle(heading) : null;
      const verticalPadding = bodyStyle
        ? (Number.parseFloat(bodyStyle.paddingTop) || 0) + (Number.parseFloat(bodyStyle.paddingBottom) || 0)
        : 0;
      const headingMargin = headingStyle ? Number.parseFloat(headingStyle.marginBottom) || 0 : 0;
      const availableHeight = cardBody
        ? cardBody.clientHeight - verticalPadding - (heading?.getBoundingClientRect().height ?? 0) - headingMargin
        : container.clientHeight;
      const nextHeight = Math.max(160, Math.floor(availableHeight - headerHeight - 2));
      setTableScrollY((current) => current === nextHeight ? current : nextHeight);
    };

    updateTableHeight();
    const observer = new ResizeObserver(updateTableHeight);
    observer.observe(container);
    if (cardBody) observer.observe(cardBody);
    if (heading) observer.observe(heading);
    return () => observer.disconnect();
  }, []);

  const columns: ColumnsType<ProductTableRow> = [
    {
      title: "商品", dataIndex: "productName", key: "productName", width: 360, fixed: "left",
      render: (_value, item) => (
        <div className="product-cell">
          <Image
            src={item.imageUrl || undefined}
            width={120}
            height={120}
            className="product-thumb"
            fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='100%25' height='100%25' fill='%23edf1f7'/%3E%3C/svg%3E"
          />
          <div className="product-cell-copy">
            <div className="product-category">{[item.latestCategoryLevel1, item.latestCategoryLevel2].filter(Boolean).join(" / ") || "未分类"}</div>
            <Button type="link" className="product-name-link" onClick={() => setSelectedProductId(item.productId)}>{item.productName}</Button>
            <div className="product-meta-row">
              <Typography.Text type="secondary" className="product-id">ID：{item.productId}</Typography.Text>
              <Typography.Text type="secondary" className="product-listing-date">上架日期：{item.listingDate || "—"}</Typography.Text>
              <Button type="link" size="small" icon={<LinkOutlined />} disabled={!item.productUrl} className="open-product-link" onClick={() => openProductUrl(item.productUrl)}>打开链接</Button>
            </div>
            <div className="product-shop-row">
              <Typography.Text type="secondary" className="product-shop-name">店铺：{item.shopName || "—"}{item.shopType ? ` · ${item.shopType}` : ""}</Typography.Text>
            </div>
            <div className="product-count-row">
              <span>上榜周数：<strong>{item.historyWeekCount} 周</strong></span>
              <span>连续上榜：<strong>{item.consecutiveWeekCount} 周</strong></span>
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
    { title: "趋势", key: "buyerTrend", width: 525, render: (_value, item) => <BuyerTrend points={item.buyerTrend} /> },
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

  // Keep the scrollable table width in sync with the actual column widths,
  // including the optional selection and team-favorite columns.
  const tableScrollX = columns.reduce(
    (total, column) => total + (typeof column.width === "number" ? column.width : 0),
    isAdmin ? 48 : 0,
  );

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
      <Card className="filter-card filter-card-compact" bordered={false}>
        <div className="filter-title"><FilterOutlined /> 筛选商品</div>
        <div className="filter-grid">
          <div className="filter-field filter-field-keyword">
            <label htmlFor="filter-keyword">商品搜索</label>
            <Input id="filter-keyword" allowClear value={draft.keyword} onChange={(event) => setDraft((prev) => ({ ...prev, keyword: event.target.value }))} onPressEnter={applyFilters} prefix={<SearchOutlined />} placeholder="名称 / ID / 店铺" />
          </div>
          <div className="filter-field filter-field-periods">
            <label htmlFor="filter-periods">上榜周期</label>
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
            <Select id="filter-category-level1" mode="multiple" allowClear showSearch optionFilterProp="label" maxTagCount="responsive" value={draft.categoryLevel1 ?? []} onChange={(value) => setDraft((prev) => ({ ...prev, categoryLevel1: value, categoryLevel2: [] }))} placeholder="全部（可多选）" options={(categoriesQuery.data?.level1 ?? []).map((value) => ({ label: value, value }))} />
          </div>
          <div className="filter-field">
            <label htmlFor="filter-category-level2">二级类目</label>
            <Select id="filter-category-level2" mode="multiple" allowClear showSearch optionFilterProp="label" maxTagCount="responsive" disabled={!draft.categoryLevel1?.length} value={draft.categoryLevel2 ?? []} onChange={(value) => setDraft((prev) => ({ ...prev, categoryLevel2: value }))} placeholder="全部（可多选）" options={(categoriesQuery.data?.level2 ?? []).map((value) => ({ label: value, value }))} />
          </div>
          <div className="filter-field filter-field-shop-type">
            <label htmlFor="filter-shop-type">店铺类型</label>
            <Select id="filter-shop-type" allowClear value={draft.shopType} onChange={(value) => setDraft((prev) => ({ ...prev, shopType: value }))} placeholder="全部" options={[{ label: "淘宝", value: "淘宝" }, { label: "天猫", value: "天猫" }]} />
          </div>
          <div className="filter-field filter-field-listing-date">
            <label htmlFor="filter-listing-date">上架日期</label>
            <DatePicker.RangePicker
              id="filter-listing-date"
              allowClear
              format="YYYY-MM-DD"
              placeholder={["开始日期", "结束日期"]}
              value={draft.listingDateFrom && draft.listingDateTo ? [dayjs(draft.listingDateFrom), dayjs(draft.listingDateTo)] : null}
              onChange={(value) => setDraft((prev) => ({
                ...prev,
                listingDateFrom: value?.[0]?.format("YYYY-MM-DD"),
                listingDateTo: value?.[1]?.format("YYYY-MM-DD"),
              }))}
            />
          </div>
          <div className="filter-field filter-field-range filter-field-second-row">
            <label htmlFor="filter-history-weeks-min">上榜周数</label>
            <div className="filter-range-control">
              <InputNumber id="filter-history-weeks-min" min={0} precision={0} value={draft.historyWeekCountMin} onChange={(value) => setDraft((prev) => ({ ...prev, historyWeekCountMin: value === null ? undefined : Number(value) }))} placeholder="最小" />
              <span className="filter-range-separator" aria-hidden="true">-</span>
              <InputNumber id="filter-history-weeks-max" min={0} precision={0} value={draft.historyWeekCountMax} onChange={(value) => setDraft((prev) => ({ ...prev, historyWeekCountMax: value === null ? undefined : Number(value) }))} placeholder="最大" />
            </div>
          </div>
          <div className="filter-field filter-field-range filter-field-second-row">
            <label htmlFor="filter-consecutive-weeks-min"><Tooltip title="选择上榜周期后，以该周期为终点向前回溯连续上榜周数；未选择周期时，按商品最近上榜周期计算。">连续周数</Tooltip></label>
            <div className="filter-range-control">
              <InputNumber id="filter-consecutive-weeks-min" min={0} precision={0} value={draft.consecutiveWeekCountMin} onChange={(value) => setDraft((prev) => ({ ...prev, consecutiveWeekCountMin: value === null ? undefined : Number(value) }))} placeholder="最小" />
              <span className="filter-range-separator" aria-hidden="true">-</span>
              <InputNumber id="filter-consecutive-weeks-max" min={0} precision={0} value={draft.consecutiveWeekCountMax} onChange={(value) => setDraft((prev) => ({ ...prev, consecutiveWeekCountMax: value === null ? undefined : Number(value) }))} placeholder="最大" />
            </div>
          </div>
          <div className="filter-field filter-field-range filter-field-second-row">
            <label htmlFor="filter-buyer-median-min">最新支付买家数</label>
            <div className="filter-range-control">
              <InputNumber id="filter-buyer-median-min" min={0} precision={0} value={draft.latestBuyerMedianMin} onChange={(value) => setDraft((prev) => ({ ...prev, latestBuyerMedianMin: value === null ? undefined : Number(value) }))} placeholder="最小" />
              <span className="filter-range-separator" aria-hidden="true">-</span>
              <InputNumber id="filter-buyer-median-max" min={0} precision={0} value={draft.latestBuyerMedianMax} onChange={(value) => setDraft((prev) => ({ ...prev, latestBuyerMedianMax: value === null ? undefined : Number(value) }))} placeholder="最大" />
            </div>
          </div>
          <div className="filter-field filter-field-ai-status filter-field-second-row">
            <label htmlFor="filter-ai-status">数据状态</label>
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
            <div className="filter-field filter-field-favorites filter-field-second-row">
              <label htmlFor="filter-member-keyword">收藏成员</label>
              <Input id="filter-member-keyword" allowClear value={memberKeyword} onChange={(event) => { setMemberKeyword(event.target.value); setPage(1); }} placeholder="姓名 / 账号 / 部门" />
            </div>
          ) : (
            <div className="filter-field filter-field-favorites filter-field-second-row">
              <label htmlFor="filter-favorites">收藏范围</label>
              <Checkbox id="filter-favorites" checked={draft.favoritesOnly ?? false} onChange={(event) => setDraft((prev) => ({ ...prev, favoritesOnly: event.target.checked || undefined }))}>仅看我的收藏</Checkbox>
            </div>
          )}
          <Space className="filter-actions filter-field-second-row">
            <Button type="primary" onClick={applyFilters}>查询</Button>
            <Button onClick={resetFilters}>重置</Button>
            <Button icon={<ReloadOutlined />} onClick={() => void activeQuery.refetch()}>刷新数据</Button>
          </Space>
        </div>
      </Card>

      <Card className="table-card table-card-products" bordered={false}>
        <div className="table-heading">
          <div className="table-heading-title">
            <div className="table-heading-copy">
              <Typography.Title level={4}>{teamFavoritesMode && isAdmin ? "成员收藏" : "商品列表"}</Typography.Title>
              {teamFavoritesMode && isAdmin && (
                <Typography.Text type="secondary">汇总所有普通成员收藏的商品，管理员可统一勾选并提交后台数据获取任务。</Typography.Text>
              )}
            </div>
            <Segmented
              size="large"
              value={boardType}
              options={[{ label: "新品流量", value: "NEW_PRODUCT_TRAFFIC" }, { label: "交易增速", value: "TRANSACTION_GROWTH" }]}
              onChange={(value) => {
                setBoardType(value as BoardType);
                setDraft({});
                setFilters({});
                setPage(1);
                setSelectedProductIds([]);
                setSelectedProductId(null);
              }}
            />
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
                <Typography.Text type="secondary">跨页选择；按每批50件执行</Typography.Text>
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
            <Tag color="blue">共 {data?.total ?? 0} 条</Tag>
          </div>
        </div>
        <div className="products-table-scroll" ref={tableWrapperRef}>
          <Table<ProductTableRow>
            rowKey="productId"
            columns={columns}
            dataSource={data?.items ?? []}
            rowSelection={isAdmin ? {
              fixed: true,
              columnWidth: 48,
              selectedRowKeys: selectedProductIds,
              preserveSelectedRowKeys: true,
              onChange: (keys) => setSelectedProductIds(keys.map(String)),
              renderCell: (_checked, _record, index, originNode) => (
                <div className="product-row-selection-cell">
                  {originNode}
                  <span className="product-row-index">{index + 1}</span>
                </div>
              ),
            } : undefined}
            loading={activeQuery.isLoading || activeQuery.isFetching}
            scroll={{ x: tableScrollX, y: tableScrollY }}
            size="middle"
            locale={{ emptyText: <Empty description="暂无商品数据，请先导入生意参谋 Excel 榜单" /> }}
            pagination={false}
          />
        </div>
      </Card>
      <Suspense fallback={null}>
        <ProductDetailModal productId={selectedProductId ?? ""} open={Boolean(selectedProductId)} onClose={() => setSelectedProductId(null)} boardType={boardType} />
      </Suspense>
    </div>
  );
}
