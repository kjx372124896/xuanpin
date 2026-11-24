import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, DatePicker, Empty, Input, InputNumber, Pagination, Select, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { SorterResult } from "antd/es/table/interface";
import { FilterOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { api, errorMessage } from "../api";

interface SearchMetric {
  raw: string | null;
  min: number | null;
  max: number | null;
  median: number | null;
}
interface SearchTrendPoint {
  date: string | null;
  comparisonDate: string | null;
  rank: number | null;
  raw: string | null;
  min: number | null;
  max: number | null;
  median: number | null;
  comparisonRank: number | null;
  comparisonRaw: string | null;
  comparisonMin: number | null;
  comparisonMax: number | null;
  comparisonMedian: number | null;
}
interface SearchTrendItem {
  searchTerm: string;
  categoryName: string;
  classificationName: string | null;
  searchTermType: string;
  boardType: string;
  dimension: string;
  latestDate: string;
  latestRank: number | null;
  latestSearchPeople: SearchMetric;
  daysWithData: number;
  previousDailyAverage: number | null;
  currentDailyAverage: number | null;
  previousDaysWithData: number;
  currentDaysWithData: number;
  growthRate: number | null;
  trend: SearchTrendPoint[];
}
interface SearchTrendResult {
  items: SearchTrendItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  startDate: string;
  endDate: string;
  comparison: {
    mode: "previousMonth" | "previousYear";
    days: number;
    currentDays: number;
    previousDays: number;
    previousStartDate: string;
    previousEndDate: string;
    currentStartDate: string;
    currentEndDate: string;
  };
}
interface SearchTrendOptions {
  categories: string[];
  categoryLevels: Array<{ categoryLevel1: string; categoryLevel2: string }>;
  searchTermTypes: string[];
  boardTypes: string[];
  latestDate: string | null;
}
interface SearchFilters {
  startDate?: string;
  endDate?: string;
  categoryLevel1?: string[];
  categoryLevel2?: string[];
  searchTermType?: string[];
  boardType?: string[];
  keyword?: string;
  searchPeopleMin?: number;
  searchPeopleMax?: number;
  comparisonMode?: "previousMonth" | "previousYear";
  minGrowthRate?: number;
}

interface SearchTrendSort {
  field: "latestRank" | "growthRate";
  order: "ascend" | "descend";
}

function formatNumber(value: number | null) {
  if (value === null) return "—";
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

function formatDailyAverage(value: number | null) {
  if (value === null) return "—";
  return Math.round(value).toString();
}

const DailySearchTrend = memo(function DailySearchTrend({ points }: { points: SearchTrendPoint[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const valueOf = (median: number | null, min: number | null, max: number | null) =>
    median ?? (min !== null && max !== null ? (min + max) / 2 : min ?? max);
  const values = points.flatMap((point) => [
    valueOf(point.median, point.min, point.max),
    valueOf(point.comparisonMedian, point.comparisonMin, point.comparisonMax),
  ]).filter((value): value is number => value !== null);
  if (!values.length) return <Typography.Text type="secondary">暂无趋势</Typography.Text>;

  const maxValue = Math.max(1, ...values);
  const chartWidth = 990;
  const chartHeight = 192;
  const plot = { left: 38, right: 10, top: 22, bottom: 24 };
  const plotWidth = chartWidth - plot.left - plot.right;
  const plotHeight = chartHeight - plot.top - plot.bottom;
  const axisMax = Math.max(4, Math.ceil((maxValue * 1.18) / 4) * 4);
  const yFor = (value: number) => plot.top + plotHeight - (Math.max(0, value) / axisMax) * plotHeight;

  const chartPoints = points.map((point, index) => {
    const currentValue = valueOf(point.median, point.min, point.max);
    const comparisonValue = valueOf(point.comparisonMedian, point.comparisonMin, point.comparisonMax);
    const currentY = currentValue === null ? null : yFor(currentValue);
    const comparisonY = comparisonValue === null ? null : yFor(comparisonValue);
    const validY = [currentY, comparisonY].filter((value): value is number => value !== null);
    return {
      point,
      x: points.length === 1 ? plot.left + plotWidth / 2 : plot.left + (index / (points.length - 1)) * plotWidth,
      currentValue,
      comparisonValue,
      currentY,
      comparisonY,
      hoverY: validY.length ? Math.min(...validY) : plot.top + plotHeight / 2,
    };
  });
  type ChartPoint = (typeof chartPoints)[number];

  const makeSegments = (field: "currentY" | "comparisonY") => {
    const segments: ChartPoint[][] = [];
    let segment: ChartPoint[] = [];
    chartPoints.forEach((point) => {
      if (point[field] === null) {
        if (segment.length) segments.push(segment);
        segment = [];
      } else {
        segment.push(point);
      }
    });
    if (segment.length) segments.push(segment);
    return segments;
  };
  const currentSegments = makeSegments("currentY");
  const comparisonSegments = makeSegments("comparisonY");
  const labelStep = Math.max(1, Math.ceil((points.length - 1) / 5));
  const labelIndices = points.map((_, index) => index).filter((index) => index === 0 || index === points.length - 1 || index % labelStep === 0);
  const hoveredPoint = hoveredIndex === null ? null : chartPoints[hoveredIndex] ?? null;
  const tooltipLeft = hoveredPoint ? (hoveredPoint.x / chartWidth) * 100 : 0;
  const tooltipTop = hoveredPoint
    ? Math.max(2, Math.min(hoveredPoint.hoverY > chartHeight * 0.62 ? hoveredPoint.hoverY - 94 : hoveredPoint.hoverY + 10, chartHeight - 94))
    : 0;

  return (
    <div className="buyer-trend-cell" role="group" aria-label="每日搜索人数趋势：蓝色为统计日期，绿色为对比日期">
      <div className="buyer-trend-legend">
        <span><i className="buyer-trend-legend-current" />统计日期</span>
        <span><i className="buyer-trend-legend-comparison" />对比日期</span>
      </div>
      <div className="buyer-trend-chart-wrap">
        <svg
          className="buyer-trend-chart"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          preserveAspectRatio="none"
          role="group"
          tabIndex={0}
          aria-label={hoveredPoint
            ? `趋势数据。统计 ${hoveredPoint.point.date ?? "无数据"}：${formatNumber(hoveredPoint.currentValue)}；对比 ${hoveredPoint.point.comparisonDate ?? "无数据"}：${formatNumber(hoveredPoint.comparisonValue)}。使用左右方向键切换日期。`
            : "每日搜索人数双折线图，蓝色为统计日期，绿色为对比日期。使用左右方向键查看数据。"}
          onMouseMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (!bounds.width) return;
            const chartX = ((event.clientX - bounds.left) / bounds.width) * chartWidth;
            const relativeX = Math.max(0, Math.min(plotWidth, chartX - plot.left));
            const nextIndex = points.length <= 1 ? 0 : Math.round((relativeX / plotWidth) * (points.length - 1));
            setHoveredIndex(nextIndex);
          }}
          onMouseLeave={() => setHoveredIndex(null)}
          onFocus={() => setHoveredIndex((current) => current ?? 0)}
          onBlur={() => setHoveredIndex(null)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            setHoveredIndex((current) => Math.max(0, Math.min(points.length - 1, (current ?? 0) + (event.key === "ArrowRight" ? 1 : -1))));
          }}
        >
          {[0, 1, 2, 3, 4].map((step) => {
            const value = axisMax * step / 4;
            const y = yFor(value);
            return <g key={step}><line x1={plot.left} y1={y} x2={chartWidth - plot.right} y2={y} stroke="#e9edf5" strokeDasharray="3 3" /><text x={plot.left - 7} y={y + 3} fill="#8792a8" fontSize="9" textAnchor="end">{formatNumber(value)}</text></g>;
          })}
          <line x1={plot.left} y1={plot.top + plotHeight} x2={chartWidth - plot.right} y2={plot.top + plotHeight} stroke="#d9deea" />
          {currentSegments.map((segment, index) => <path key={`current-${index}`} d={segment.map((point, pointIndex) => `${pointIndex === 0 ? "M" : "L"} ${point.x} ${point.currentY}`).join(" ")} fill="none" stroke="#3478e5" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />)}
          {comparisonSegments.map((segment, index) => <path key={`comparison-${index}`} d={segment.map((point, pointIndex) => `${pointIndex === 0 ? "M" : "L"} ${point.x} ${point.comparisonY}`).join(" ")} fill="none" stroke="#20a36a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />)}
          {hoveredPoint && (
            <g pointerEvents="none">
              <line x1={hoveredPoint.x} y1={plot.top} x2={hoveredPoint.x} y2={plot.top + plotHeight} stroke="#aeb7c8" strokeDasharray="3 3" />
              {hoveredPoint.currentY !== null && <circle cx={hoveredPoint.x} cy={hoveredPoint.currentY} r="4" fill="#3478e5" stroke="#fff" strokeWidth="1.2" />}
              {hoveredPoint.comparisonY !== null && <circle cx={hoveredPoint.x} cy={hoveredPoint.comparisonY} r="4" fill="#20a36a" stroke="#fff" strokeWidth="1.2" />}
            </g>
          )}
          <rect x={plot.left} y={plot.top} width={plotWidth} height={plotHeight} fill="transparent" style={{ cursor: "crosshair" }} />
          {labelIndices.map((index) => {
            const point = points[index];
            const labelDate = point.date ?? point.comparisonDate;
            const x = points.length === 1 ? plot.left + plotWidth / 2 : plot.left + (index / (points.length - 1)) * plotWidth;
            return <text key={index} x={x} y={chartHeight - 6} fill="#8792a8" fontSize="9" textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}>{labelDate ? dayjs(labelDate).format("MM/DD") : "—"}</text>;
          })}
        </svg>
        {hoveredPoint && (
          <div className="buyer-trend-tooltip" style={{ left: `clamp(2px, ${tooltipLeft}%, calc(100% - 224px))`, top: tooltipTop }}>
            <div className="buyer-trend-tooltip-series">
              <i className="buyer-trend-legend-current" />
              <strong>统计 {hoveredPoint.point.date ?? "—"}</strong>
              <b>{formatNumber(hoveredPoint.currentValue)}</b>
            </div>
            <span>排名：{hoveredPoint.point.rank ?? "—"} · 区间：{formatNumber(hoveredPoint.point.min)} - {formatNumber(hoveredPoint.point.max)}</span>
            <div className="buyer-trend-tooltip-series">
              <i className="buyer-trend-legend-comparison" />
              <strong>对比 {hoveredPoint.point.comparisonDate ?? "—"}</strong>
              <b>{formatNumber(hoveredPoint.comparisonValue)}</b>
            </div>
            <span>排名：{hoveredPoint.point.comparisonRank ?? "—"} · 区间：{formatNumber(hoveredPoint.point.comparisonMin)} - {formatNumber(hoveredPoint.point.comparisonMax)}</span>
          </div>
        )}
      </div>
    </div>
  );
});
function itemKey(item: SearchTrendItem) {
  return [item.searchTerm, item.categoryName, item.searchTermType, item.boardType, item.dimension].join("|");
}

export function SearchTrendsPage() {
  const [draft, setDraft] = useState<SearchFilters>({});
  const [filters, setFilters] = useState<SearchFilters>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<SearchTrendSort>({ field: "latestRank", order: "ascend" });
  const [initialized, setInitialized] = useState(false);
  const [tableScrollY, setTableScrollY] = useState(400);
  const tableWrapperRef = useRef<HTMLDivElement>(null);

  const optionsQuery = useQuery({
    queryKey: ["searchTrendOptions"],
    queryFn: async () => (await api.get<SearchTrendOptions>("/search-trends/options")).data,
  });
  const categoryOptions = useMemo(() => {
    const levels = optionsQuery.data?.categoryLevels ?? [];
    const selectedLevel1 = new Set(draft.categoryLevel1 ?? []);
    return {
      level1: [...new Set(levels.map((item) => item.categoryLevel1))],
      level2: [...new Set(levels.filter((item) => selectedLevel1.has(item.categoryLevel1)).map((item) => item.categoryLevel2))],
    };
  }, [optionsQuery.data?.categoryLevels, draft.categoryLevel1]);

  useEffect(() => {
    if (optionsQuery.isLoading || initialized) return;
    const latestDate = optionsQuery.data?.latestDate;
    const defaults: SearchFilters = {
      ...(latestDate ? {
        startDate: dayjs(latestDate).subtract(29, "day").format("YYYY-MM-DD"),
        endDate: latestDate,
      } : {}),
      comparisonMode: "previousMonth" as const,
    };
    setDraft(defaults);
    setFilters(defaults);
    setInitialized(true);
  }, [optionsQuery.data?.latestDate, optionsQuery.isLoading, initialized]);

  const trendsQuery = useQuery({
    queryKey: ["searchTrends", filters, page, pageSize, sort],
    queryFn: async () => {
      const params: Record<string, string | number> = {
        page,
        pageSize,
        sortBy: sort.field,
        sortOrder: sort.order === "ascend" ? "asc" : "desc",
      };
      if (filters.startDate) params.startDate = filters.startDate;
      if (filters.endDate) params.endDate = filters.endDate;
      params.comparisonMode = filters.comparisonMode ?? "previousMonth";
      if (filters.categoryLevel1?.length) params.categoryLevel1 = filters.categoryLevel1.join(",");
      if (filters.categoryLevel2?.length) params.categoryLevel2 = filters.categoryLevel2.join(",");
      if (filters.searchTermType?.length) params.searchTermType = filters.searchTermType.join(",");
      if (filters.boardType?.length) params.boardType = filters.boardType.join(",");
      if (filters.keyword) params.keyword = filters.keyword;
      if (filters.searchPeopleMin !== undefined) params.searchPeopleMin = filters.searchPeopleMin;
      if (filters.searchPeopleMax !== undefined) params.searchPeopleMax = filters.searchPeopleMax;
      if (filters.minGrowthRate !== undefined) params.minGrowthRate = filters.minGrowthRate;
      return (await api.get<SearchTrendResult>("/search-trends", { params })).data;
    },
    // 等待筛选选项返回并写入默认日期后再查询，避免先发无日期请求、随后又发默认日期请求。
    enabled: initialized,
  });

  useEffect(() => {
    const tableBody = tableWrapperRef.current?.querySelector<HTMLElement>(".ant-table-body");
    if (tableBody) tableBody.scrollTop = 0;
  }, [page, pageSize, filters, sort]);

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

  const columns = useMemo<ColumnsType<SearchTrendItem>>(() => [
    {
      title: "最新排名",
      dataIndex: "latestRank",
      key: "latestRank",
      width: 120,
      align: "center",
      sorter: true,
      sortOrder: sort.field === "latestRank" ? sort.order : null,
      render: (value: number | null, item) => (
        <div className="latest-rank-cell">
          <Typography.Text strong className="latest-rank-value">{value ?? "—"}</Typography.Text>
          <div className="latest-rank-meta">
            {item.categoryName && (
              <Typography.Text
                type="secondary"
                className="latest-rank-category"
                ellipsis={{ tooltip: item.categoryName }}
              >
                {item.categoryName}
              </Typography.Text>
            )}
            {item.searchTermType && <Tag className="latest-rank-type" title={item.searchTermType}>{item.searchTermType}</Tag>}
          </div>
        </div>
      ),
    },
    {
      title: "搜索词",
      dataIndex: "searchTerm",
      key: "searchTerm",
      width: 130,
      render: (value: string, item) => (
        <div className="search-term-cell">
          <Typography.Text strong>{value}</Typography.Text>
          {item.classificationName && item.classificationName !== item.categoryName && <Typography.Text type="secondary">{item.classificationName}</Typography.Text>}
        </div>
      ),
    },
    {
      title: "对比期日均",
      dataIndex: "previousDailyAverage",
      key: "previousDailyAverage",
      width: 120,
      render: (value: number | null, item) => (
        <div className="metric-summary">
          <strong>{formatDailyAverage(value)}</strong>
          <span>有效 {item.previousDaysWithData} 天</span>
        </div>
      ),
    },
    {
      title: "当期日均",
      dataIndex: "currentDailyAverage",
      key: "currentDailyAverage",
      width: 120,
      render: (value: number | null, item) => (
        <div className="metric-summary">
          <strong>{formatDailyAverage(value)}</strong>
          <span>有效 {item.currentDaysWithData} 天</span>
        </div>
      ),
    },
    {
      title: "对比增长率",
      dataIndex: "growthRate",
      key: "growthRate",
      width: 120,
      sorter: true,
      sortDirections: ["descend", "ascend"],
      sortOrder: sort.field === "growthRate" ? sort.order : null,
      render: (value: number | null) => value === null
        ? "—"
        : <Typography.Text strong style={{ color: value > 0 ? "#16835d" : value < 0 ? "#cf3f48" : undefined }}>{value > 0 ? "+" : ""}{value.toFixed(1)}%</Typography.Text>,
    },
    {
      title: "每日搜索人数趋势",
      key: "trend",
      render: (_value, item) => <DailySearchTrend points={item.trend} />,
    },
  ], [sort]);

  function applyFilters() {
    setPage(1);
    setFilters({ ...draft });
  }

  function resetFilters() {
    const latestDate = optionsQuery.data?.latestDate;
    const defaults = latestDate ? {
      startDate: dayjs(latestDate).subtract(29, "day").format("YYYY-MM-DD"),
      endDate: latestDate,
      comparisonMode: "previousMonth" as const,
    } : {};
    setDraft(defaults);
    setFilters(defaults);
    setSort({ field: "latestRank", order: "ascend" });
    setPage(1);
  }

  function dateChanged(value: [Dayjs | null, Dayjs | null] | null) {
    setDraft((current) => ({
      ...current,
      startDate: value?.[0]?.format("YYYY-MM-DD"),
      endDate: value?.[1]?.format("YYYY-MM-DD"),
    }));
  }

  return (
    <div className="page-stack search-trends-page">
      <Card className="filter-card filter-card-compact search-trend-filter-card" bordered={false}>
        <div className="filter-title"><FilterOutlined /> 筛选搜索词</div>
        <div className="filter-grid search-trend-filter-grid">
          <div className="filter-field filter-field-listing-date search-trend-field-date">
            <label>统计日期</label>
            <DatePicker.RangePicker
              allowClear
              value={draft.startDate && draft.endDate ? [dayjs(draft.startDate), dayjs(draft.endDate)] : null}
              onChange={dateChanged}
              format="YYYY-MM-DD"
              placeholder={["开始日期", "结束日期"]}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="search-category-level1">一级类目</label>
            <Select
              id="search-category-level1"
              mode="multiple"
              allowClear
              showSearch
              optionFilterProp="label"
              maxTagCount="responsive"
              value={draft.categoryLevel1 ?? []}
              onChange={(value) => setDraft((current) => ({ ...current, categoryLevel1: value, categoryLevel2: [] }))}
              placeholder="全部一级类目"
              options={categoryOptions.level1.map((value) => ({ label: value, value }))}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="search-category-level2">二级类目</label>
            <Select
              id="search-category-level2"
              mode="multiple"
              allowClear
              showSearch
              optionFilterProp="label"
              maxTagCount="responsive"
              disabled={!draft.categoryLevel1?.length}
              value={draft.categoryLevel2 ?? []}
              onChange={(value) => setDraft((current) => ({ ...current, categoryLevel2: value }))}
              placeholder={draft.categoryLevel1?.length ? "全部二级类目" : "请先选择一级类目"}
              options={categoryOptions.level2.map((value) => ({ label: value, value }))}
            />
          </div>
          <div className="filter-field">
            <label>搜索词类型</label>
            <Select
              mode="multiple"
              allowClear
              maxTagCount="responsive"
              value={draft.searchTermType ?? []}
              onChange={(value) => setDraft((current) => ({ ...current, searchTermType: value }))}
              placeholder="全部类型"
              options={(optionsQuery.data?.searchTermTypes ?? []).map((value) => ({ label: value, value }))}
            />
          </div>
          <div className="filter-field">
            <label>榜单类型</label>
            <Select
              mode="multiple"
              allowClear
              maxTagCount="responsive"
              value={draft.boardType ?? []}
              onChange={(value) => setDraft((current) => ({ ...current, boardType: value }))}
              placeholder="全部榜单"
              options={(optionsQuery.data?.boardTypes ?? []).map((value) => ({ label: value, value }))}
            />
          </div>
          <div className="filter-field">
            <label>搜索词</label>
            <Input
              allowClear
              value={draft.keyword}
              prefix={<SearchOutlined />}
              onChange={(event) => setDraft((current) => ({ ...current, keyword: event.target.value }))}
              onPressEnter={applyFilters}
              placeholder="输入搜索词"
            />
          </div>
          <div className="filter-field">
            <label>搜索人数中值</label>
            <div className="filter-range-control">
              <InputNumber min={0} value={draft.searchPeopleMin} onChange={(value) => setDraft((current) => ({ ...current, searchPeopleMin: value === null ? undefined : Number(value) }))} placeholder="最小值" />
              <span className="filter-range-separator">-</span>
              <InputNumber min={0} value={draft.searchPeopleMax} onChange={(value) => setDraft((current) => ({ ...current, searchPeopleMax: value === null ? undefined : Number(value) }))} placeholder="最大值" />
            </div>
          </div>
          <div className="filter-field search-trend-field-comparison-mode">
            <label>对比方式</label>
            <Select
              value={draft.comparisonMode ?? "previousMonth"}
              onChange={(value: "previousMonth" | "previousYear") => setDraft((current) => ({ ...current, comparisonMode: value }))}
              options={[
                { label: "环比上月同期", value: "previousMonth" },
                { label: "环比去年同期", value: "previousYear" },
              ]}
            />
          </div>
          <div className="filter-field search-trend-field-min-growth">
            <label>最低环比增长率</label>
            <InputNumber
              min={-100}
              step={1}
              value={draft.minGrowthRate}
              onChange={(value) => setDraft((current) => ({ ...current, minGrowthRate: value === null ? undefined : Number(value) }))}
              placeholder="不限"
              addonAfter="%"
              style={{ width: "100%" }}
            />
          </div>
          <div className="filter-actions search-trend-filter-actions">
            <Button type="primary" onClick={applyFilters}>查询</Button>
            <Button onClick={resetFilters}>重置</Button>
            <Button icon={<ReloadOutlined />} onClick={() => { void optionsQuery.refetch(); void trendsQuery.refetch(); }}>刷新数据</Button>
          </div>
        </div>
        <Typography.Text type="secondary" className="search-trend-filter-hint">
          {trendsQuery.data?.comparison
            ? `${trendsQuery.data.comparison.mode === "previousMonth" ? "环比上月同期" : "环比去年同期"}：统计日期 ${trendsQuery.data.comparison.currentStartDate} 至 ${trendsQuery.data.comparison.currentEndDate}（${trendsQuery.data.comparison.currentDays}天）；对比日期 ${trendsQuery.data.comparison.previousStartDate} 至 ${trendsQuery.data.comparison.previousEndDate}（${trendsQuery.data.comparison.previousDays}天）。日均按各搜索词在对应周期内的有效记录天数计算，缺失日期不补0。`
            : "选择环比上月同期或环比去年同期，系统会根据统计日期自动匹配对比日期。日均按各搜索词的有效记录天数计算，缺失日期不补0。"}
        </Typography.Text>
      </Card>

      <Card className="table-card table-card-products search-trends-table-card" bordered={false}>
        {optionsQuery.isError && <Alert type="error" showIcon message="筛选选项加载失败" description={errorMessage(optionsQuery.error)} className="section-alert" />}
        {trendsQuery.isError && <Alert type="error" showIcon message="搜索趋势查询失败" description={errorMessage(trendsQuery.error)} className="section-alert" />}
        <div className="table-heading">
          <div className="table-heading-title">
            <div className="table-heading-copy">
              <Typography.Title level={4}>搜索词列表</Typography.Title>
              <Typography.Text type="secondary">
                {trendsQuery.data ? trendsQuery.data.startDate + " 至 " + trendsQuery.data.endDate + " · 共 " + trendsQuery.data.total.toLocaleString() + " 个搜索词" : "每行展示一个搜索词及其日搜索人数趋势"}
              </Typography.Text>
            </div>
          </div>
          <div className="table-heading-actions">
            <Pagination
              size="small"
              current={page}
              pageSize={pageSize}
              total={trendsQuery.data?.total ?? 0}
              showSizeChanger
              showLessItems
              pageSizeOptions={[50, 100]}
              showTotal={(total) => "共 " + total.toLocaleString() + " 个搜索词"}
              onChange={(nextPage, nextSize) => {
                setPage(nextPage);
                setPageSize(nextSize);
              }}
            />
            <Tag color="blue">日粒度</Tag>
          </div>
        </div>
        <div className="products-table-scroll" ref={tableWrapperRef}>
          <Table<SearchTrendItem>
            rowKey={itemKey}
            columns={columns}
            dataSource={trendsQuery.data?.items ?? []}
            loading={trendsQuery.isLoading || trendsQuery.isFetching}
            tableLayout="fixed"
            scroll={{ y: tableScrollY }}
            size="small"
            pagination={false}
            onChange={(_pagination, _filters, sorter) => {
              const activeSorter: SorterResult<SearchTrendItem> | undefined = Array.isArray(sorter) ? sorter[0] : sorter;
              if (activeSorter?.columnKey === "growthRate" && activeSorter.order) {
                setSort({ field: "growthRate", order: activeSorter.order });
              } else if (activeSorter?.columnKey === "latestRank" && activeSorter.order) {
                setSort({ field: "latestRank", order: activeSorter.order });
              } else {
                setSort({ field: "latestRank", order: "ascend" });
              }
              setPage(1);
            }}
            locale={{ emptyText: <Empty description="暂无搜索趋势数据，请先在数据导入中导入搜索榜单" /> }}
          />
        </div>
      </Card>
    </div>
  );
}
