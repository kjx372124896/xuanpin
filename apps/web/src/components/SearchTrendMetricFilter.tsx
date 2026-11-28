import { useEffect, useState } from "react";
import { Alert, Button, InputNumber, Select, Space, Typography } from "antd";

type Operator = "all" | "gt" | "gte" | "eq" | "lt" | "lte" | "between";
interface MetricFilter { operator: Operator; value?: number; max?: number }
export interface SearchTrendMetricFilters {
  currentDaysWithData?: MetricFilter;
  currentDailyAverage?: MetricFilter;
  previousDaysWithData?: MetricFilter;
  previousDailyAverage?: MetricFilter;
}
export type SearchTrendMetricPeriod = "current" | "previous";
export function defaultSearchTrendMetricFilters(): SearchTrendMetricFilters {
  return { currentDaysWithData: { operator: "gt", value: 3 } };
}

const operators: Array<{ label: string; value: Operator }> = [
  { label: "不限", value: "all" }, { label: "大于 ＞", value: "gt" },
  { label: "大于等于 ≥", value: "gte" }, { label: "等于 ＝", value: "eq" },
  { label: "小于 ＜", value: "lt" }, { label: "小于等于 ≤", value: "lte" },
  { label: "介于（含边界）", value: "between" },
];

export function SearchTrendMetricFilterDropdown({ period, filters, open, close, onApply }: {
  period: SearchTrendMetricPeriod;
  filters: SearchTrendMetricFilters;
  open: boolean;
  close: () => void;
  onApply: (patch: SearchTrendMetricFilters) => void;
}) {
  const daysField = `${period}DaysWithData` as const;
  const averageField = `${period}DailyAverage` as const;
  const [days, setDays] = useState<MetricFilter>({ operator: "all" });
  const [average, setAverage] = useState<MetricFilter>({ operator: "all" });
  const [error, setError] = useState("");
  const title = period === "current" ? "当期日均" : "对比期日均";

  useEffect(() => {
    if (!open) return;
    setDays(filters[daysField] ?? { operator: "all" });
    setAverage(filters[averageField] ?? { operator: "all" });
    setError("");
  }, [open, filters, daysField, averageField]);

  function apply() {
    for (const [label, filter, integer] of [["有效天数", days, true], ["日均值", average, false]] as const) {
      if (filter.operator === "all") continue;
      const values = filter.operator === "between" ? [filter.value, filter.max] : [filter.value];
      if (values.some((value) => value === undefined || !Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value)))) {
        setError(`${label}请填写大于等于0的${integer ? "整数" : "数字"}。`);
        return;
      }
      if (filter.operator === "between" && filter.value! > filter.max!) {
        setError(`${label}下限不能大于上限。`);
        return;
      }
    }
    const normalize = (filter: MetricFilter): MetricFilter => filter.operator === "all"
      ? { operator: "all" }
      : { operator: filter.operator, value: filter.value, ...(filter.operator === "between" ? { max: filter.max } : {}) };
    onApply({ [daysField]: normalize(days), [averageField]: normalize(average) });
    close();
  }

  return <div className="search-metric-filter" onKeyDown={(event) => event.stopPropagation()}>
    <Typography.Text strong>{title}筛选</Typography.Text>
    {([
      { label: "有效天数", filter: days, setFilter: setDays, integer: true },
      { label: "日均值", filter: average, setFilter: setAverage, integer: false },
    ]).map(({ label, filter, setFilter, integer }) => <div className="search-metric-filter-field" key={label}>
      <Typography.Text>{label}</Typography.Text>
      <Select aria-label={`${title}${label}条件`} value={filter.operator} options={operators}
        onChange={(operator) => { setFilter((current) => ({ ...current, operator })); setError(""); }} />
      {filter.operator !== "all" && <div className="search-metric-filter-values">
        <InputNumber aria-label={`${title}${label}${filter.operator === "between" ? "下限" : "数值"}`}
          min={0} step={1} value={filter.value} placeholder={filter.operator === "between" ? "下限" : "数值"}
          addonAfter={integer ? "天" : undefined}
          onChange={(value) => { setFilter((current) => ({ ...current, value: value ?? undefined })); setError(""); }} />
        {filter.operator === "between" && <>
          <span>至</span>
          <InputNumber aria-label={`${title}${label}上限`} min={0} step={1} value={filter.max} placeholder="上限"
            addonAfter={integer ? "天" : undefined}
            onChange={(value) => { setFilter((current) => ({ ...current, max: value ?? undefined })); setError(""); }} />
        </>}
      </div>}
    </div>)}
    <Typography.Text type="secondary" className="search-metric-filter-note">两项条件同时满足时展示，区间包含上下限。日均值按列表展示的整数筛选。</Typography.Text>
    {error && <Alert type="error" showIcon title={error} />}
    <Space className="search-metric-filter-actions">
      <Button size="small" onClick={() => {
        onApply({ [daysField]: defaultSearchTrendMetricFilters()[daysField] ?? { operator: "all" }, [averageField]: { operator: "all" } });
        close();
      }}>恢复默认</Button>
      <Button size="small" onClick={close}>取消</Button>
      <Button size="small" type="primary" onClick={apply}>应用</Button>
    </Space>
  </div>;
}
