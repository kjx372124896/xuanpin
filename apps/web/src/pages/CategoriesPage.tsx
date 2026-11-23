import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button, Card, Empty, Form, Input, Modal, Select, Segmented, Space, Table, Tabs, Tag, Tooltip, Typography, message,
} from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useAuth } from "../auth/AuthContext";
import { api, errorMessage } from "../api";

interface WeekPeriod {
  weekStart: string;
  weekEnd: string;
}
interface WeekCount {
  weekStart: string;
  count: number;
  daysWithData?: number;
  recordCount?: number;
  inheritedFromParent?: boolean;
}
interface WeekProgress {
  weekStart: string;
  imported: number;
  total: number;
  recordCount: number;
  partial?: number;
  daysWithData?: number;
  totalDays?: number;
}
interface CategoryChild {
  id: string;
  categoryLevel1: string;
  categoryLevel2: string;
  responsibleUserId: string | null;
  responsibleUserName: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  inherited: boolean;
  weekCounts: WeekCount[];
}
interface CategoryParent {
  id: string | null;
  categoryLevel1: string;
  responsibleUserId: string | null;
  responsibleUserName: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  weekProgress: WeekProgress[];
  children: CategoryChild[];
}
interface EmployeeOption {
  id: string;
  name: string;
  department: string | null;
}
interface CategoriesOverview {
  periods: WeekPeriod[];
  categories: CategoryParent[];
  employees: EmployeeOption[];
}
interface CategoryTableRow {
  key: string;
  id: string | null;
  isParent: boolean;
  importStatus: "COMPLETE" | "INCOMPLETE";
  categoryLevel1: string;
  categoryLevel2: string | null;
  responsibleUserId: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  inherited: boolean;
  weekCounts?: WeekCount[];
  weekProgress?: WeekProgress[];
  totalChildren?: number;
  children?: CategoryTableRow[];
}

export function CategoriesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";
  const [activeTab, setActiveTab] = useState<"market" | "search">("market");
  const [mineOnly, setMineOnly] = useState(false);
  const [boardType, setBoardType] = useState<"NEW_PRODUCT_TRAFFIC" | "TRANSACTION_GROWTH">("NEW_PRODUCT_TRAFFIC");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "INCOMPLETE">("ALL");
  const [search, setSearch] = useState("");
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryType, setCategoryType] = useState<"parent" | "child">("parent");
  const [form] = Form.useForm();

  const overviewQuery = useQuery({
    queryKey: ["categoriesOverview", boardType],
    queryFn: async () => (await api.get<CategoriesOverview>("/categories/overview", { params: { boardType } })).data,
    staleTime: 30_000,
  });
  const searchOverviewQuery = useQuery({
    queryKey: ["categoriesSearchOverview"],
    queryFn: async () => (await api.get<CategoriesOverview>("/categories/search-overview")).data,
    enabled: activeTab === "search",
    staleTime: 30_000,
  });
  const isSearchTab = activeTab === "search";
  const overview = isSearchTab ? searchOverviewQuery.data : overviewQuery.data;
  const overviewLoading = isSearchTab ? searchOverviewQuery.isLoading : overviewQuery.isLoading;
  const overviewFetching = isSearchTab ? searchOverviewQuery.isFetching : overviewQuery.isFetching;
  const summary = useMemo(() => {
    const categories = (overview?.categories ?? []).flatMap((parent) => parent.children.length
      ? parent.children.map((child) => ({
        complete: Boolean(overview?.periods.length) && child.weekCounts.length === overview!.periods.length &&
          child.weekCounts.every((week) => isSearchTab ? (week.daysWithData ?? week.count) === 7 : week.count > 0),
      }))
      : [{
        complete: Boolean(overview?.periods.length) && parent.weekProgress.length === overview!.periods.length &&
          parent.weekProgress.every((week) => isSearchTab
            ? (week.daysWithData ?? 0) === 7
            : week.total > 0 && week.imported === week.total),
      }]);
    const total = categories.length;
    const complete = categories.filter((item) => item.complete).length;
    return { total, complete, incomplete: total - complete, rate: total ? Math.round((complete / total) * 1000) / 10 : 0 };
  }, [overview, isSearchTab]);
  const employeeOptions = (overview?.employees ?? []).map((employee) => ({
    value: employee.id,
    label: employee.department ? `${employee.name}（${employee.department}）` : employee.name,
  }));

  const createMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => api.post("/categories", values),
    onSuccess: () => {
      message.success("类目已添加");
      setCategoryModalOpen(false);
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: ["categoriesOverview"] });
      void queryClient.invalidateQueries({ queryKey: ["categoriesSearchOverview"] });
    },
    onError: (error) => message.error(errorMessage(error)),
  });
  const ownerMutation = useMutation({
    mutationFn: async (input: { id: string; responsibleUserId: string | null }) =>
      api.patch(`/categories/${input.id}/responsible`, { responsibleUserId: input.responsibleUserId }),
    onSuccess: () => {
      message.success("负责人已更新");
      void queryClient.invalidateQueries({ queryKey: ["categoriesOverview"] });
      void queryClient.invalidateQueries({ queryKey: ["categoriesSearchOverview"] });
    },
    onError: (error) => message.error(errorMessage(error)),
  });

  const tableRows = useMemo<CategoryTableRow[]>(() => {
    const keyword = search.trim().toLocaleLowerCase();
    const expectedWeeks = overview?.periods.length ?? 0;
    return (overview?.categories ?? []).flatMap((parent) => {
      const childRows = parent.children
        .filter((child) => !mineOnly || child.ownerUserId === user?.id)
        .filter((child) => statusFilter !== "INCOMPLETE" ||
          expectedWeeks === 0 || child.weekCounts.length !== expectedWeeks || child.weekCounts.some((week) =>
            isSearchTab ? (week.daysWithData ?? week.count) !== 7 : week.count <= 0))
        .filter((child) => !keyword ||
          parent.categoryLevel1.toLocaleLowerCase().includes(keyword) ||
          child.categoryLevel2.toLocaleLowerCase().includes(keyword))
        .map((child) => ({
          key: `child:${child.id}`,
          id: child.id,
          isParent: false,
          importStatus: expectedWeeks > 0 && child.weekCounts.length === expectedWeeks && child.weekCounts.every((week) =>
            isSearchTab ? (week.daysWithData ?? week.count) === 7 : week.count > 0)
            ? "COMPLETE" as const
            : "INCOMPLETE" as const,
          categoryLevel1: "",
          categoryLevel2: child.categoryLevel2,
          responsibleUserId: child.responsibleUserId,
          ownerUserId: child.ownerUserId,
          ownerName: child.ownerName,
          inherited: child.inherited,
          weekCounts: child.weekCounts,
        }));

      const parentMatches = !keyword || parent.categoryLevel1.toLocaleLowerCase().includes(keyword);
      const parentComplete = expectedWeeks > 0 && parent.weekProgress.length === expectedWeeks &&
        parent.weekProgress.every((week) => isSearchTab
          ? parent.children.length > 0
            ? week.total > 0 && week.imported === week.total
            : (week.daysWithData ?? 0) === 7
          : week.total > 0 && week.imported === week.total);
      const includeParent = (!mineOnly || parent.ownerUserId === user?.id || childRows.length > 0) &&
        (parentMatches || childRows.length > 0) && (statusFilter !== "INCOMPLETE" || !parentComplete);
      if (!includeParent) return [];

      return [{
        key: `parent:${parent.categoryLevel1}`,
        id: parent.id,
        isParent: true,
        importStatus: parentComplete ? "COMPLETE" : "INCOMPLETE",
        categoryLevel1: parent.categoryLevel1,
        categoryLevel2: null,
        responsibleUserId: parent.responsibleUserId,
        ownerUserId: parent.ownerUserId,
        ownerName: parent.ownerName,
        inherited: false,
        weekProgress: parent.weekProgress,
        totalChildren: parent.children.length,
        children: childRows,
      }];
    });
  }, [overview, mineOnly, statusFilter, search, user?.id, isSearchTab]);

  function openCreate(type: "parent" | "child") {
    setCategoryType(type);
    form.resetFields();
    form.setFieldsValue({ responsibleUserId: undefined });
    setCategoryModalOpen(true);
  }

  function saveCategory(values: Record<string, unknown>) {
    const payload: Record<string, unknown> = {
      categoryLevel1: values.categoryLevel1,
      responsibleUserId: values.responsibleUserId || null,
    };
    if (categoryType === "child") payload.categoryLevel2 = values.categoryLevel2;
    createMutation.mutate(payload);
  }

  function renderOwner(row: CategoryTableRow) {
    if (!isAdmin) {
      if (!row.ownerName) return <Typography.Text type="secondary">未分配</Typography.Text>;
      return (
        <Space size={4}>
          <Typography.Text>{row.ownerName}</Typography.Text>
          {row.inherited && <Tag bordered={false} color="default">继承</Tag>}
        </Space>
      );
    }

    const placeholder = row.isParent
      ? "选择负责人"
      : row.ownerName ? `继承：${row.ownerName}` : "继承（未分配）";
    return (
      <Select
        size="small"
        allowClear
        showSearch
        optionFilterProp="label"
        style={{ width: 150 }}
        placeholder={placeholder}
        value={row.responsibleUserId ?? undefined}
        options={employeeOptions}
        loading={ownerMutation.isPending}
        disabled={!row.id}
        onChange={(value) => {
          if (row.id) ownerMutation.mutate({ id: row.id, responsibleUserId: value ?? null });
        }}
      />
    );
  }

  function renderWeekCell(row: CategoryTableRow, period: WeekPeriod) {
    if (row.isParent) {
      const progress = row.weekProgress?.find((item) => item.weekStart === period.weekStart);
      if (!progress) return <Typography.Text type="secondary">—</Typography.Text>;
      if ((row.totalChildren ?? 0) > 0) {
        if (isSearchTab) {
          const partial = progress.partial ?? 0;
          const color = progress.imported === progress.total ? "success" : progress.imported > 0 || partial > 0 ? "warning" : "error";
          return (
            <Tooltip title={`完整 ${progress.imported}/${progress.total} 个二级类目；部分完成 ${partial} 个；共 ${progress.recordCount} 条搜索记录。二级类目没有独立数据时，会继承一级类目当周数据。`}>
              <Tag color={color}>{progress.imported}/{progress.total}</Tag>
            </Tooltip>
          );
        }
        const color = progress.imported === progress.total ? "success" : progress.imported > 0 ? "warning" : "error";
        return (
          <Tooltip title={`已导入 ${progress.imported}/${progress.total} 个二级类目，共 ${progress.recordCount} 条商品记录`}>
            <Tag color={color}>{progress.imported}/{progress.total}</Tag>
          </Tooltip>
        );
      }
      if (isSearchTab) {
        const days = progress.daysWithData ?? 0;
        const color = days === 7 ? "success" : days > 0 ? "warning" : "error";
        return <Tooltip title={`该周 ${days}/7 天有搜索词记录，共 ${progress.recordCount} 条`}><Tag color={color}>{days}/7天</Tag></Tooltip>;
      }
      return progress.recordCount > 0
        ? <Tag color="success">{progress.recordCount} 条</Tag>
        : <Tag>缺失</Tag>;
    }

    const week = row.weekCounts?.find((item) => item.weekStart === period.weekStart);
    if (isSearchTab) {
      const days = week?.daysWithData ?? week?.count ?? 0;
      const color = days === 7 ? "success" : days > 0 ? "warning" : "error";
      const inherited = week?.inheritedFromParent ? "；使用一级类目数据继承" : "";
      return <Tooltip title={`该周 ${days}/7 天有搜索词记录，共 ${week?.recordCount ?? 0} 条${inherited}`}><Tag color={color}>{days}/7天{week?.inheritedFromParent ? " · 继承" : ""}</Tag></Tooltip>;
    }
    const count = week?.count ?? 0;
    return count > 0
      ? <Tooltip title={`该周有 ${count} 条商品上榜历史记录`}><Tag color="success">{count} 条</Tag></Tooltip>
      : <Tag>缺失</Tag>;
  }

  const columns = useMemo<ColumnsType<CategoryTableRow>>(() => {
    const fixedColumns: ColumnsType<CategoryTableRow> = [
      {
        title: "一级类目",
        dataIndex: "categoryLevel1",
        key: "categoryLevel1",
        width: 190,
        fixed: "left",
        render: (value: string, row) => row.isParent
          ? <Typography.Text strong>{value}</Typography.Text>
          : <Typography.Text type="secondary">—</Typography.Text>,
      },
      {
        title: "二级类目",
        dataIndex: "categoryLevel2",
        key: "categoryLevel2",
        width: 190,
        fixed: "left",
        render: (value: string | null, row) => row.isParent
          ? <Typography.Text type="secondary">全部二级类目</Typography.Text>
          : <Typography.Text>{value}</Typography.Text>,
      },
      {
        title: "负责人",
        key: "owner",
        width: 180,
        fixed: "left",
        render: (_value, row) => renderOwner(row),
      },
      {
        title: "状态",
        dataIndex: "importStatus",
        key: "importStatus",
        width: 110,
        fixed: "left",
        align: "center",
        render: (value: CategoryTableRow["importStatus"], row) => {
          const completedWeeks = row.isParent
            ? row.weekProgress?.filter((week) => isSearchTab
              ? row.totalChildren
                ? week.total > 0 && week.imported === week.total
                : (week.daysWithData ?? 0) === 7
              : week.total > 0 && week.imported === week.total).length ?? 0
            : row.weekCounts?.filter((week) => isSearchTab ? (week.daysWithData ?? week.count) === 7 : week.count > 0).length ?? 0;
          const totalWeeks = overview?.periods.length ?? 12;
          return (
            <Tooltip title={`最近${totalWeeks}周完成 ${completedWeeks}/${totalWeeks} 周`}>
              <Tag color={value === "COMPLETE" ? "success" : "error"}>
                {value === "COMPLETE" ? "已完成" : "未完成"}
              </Tag>
            </Tooltip>
          );
        },
      },
    ];
    const weekColumns: ColumnsType<CategoryTableRow> = (overview?.periods ?? []).map((period) => ({
      title: (
        <Tooltip title={`${period.weekStart} 至 ${period.weekEnd}`}>
          <span>{dayjs(period.weekStart).format("MM/DD")}<br />{dayjs(period.weekEnd).format("MM/DD")}</span>
        </Tooltip>
      ),
      key: period.weekStart,
      width: 112,
      align: "center",
      render: (_value, row) => renderWeekCell(row, period),
    }));
    return [...fixedColumns, ...weekColumns];
  }, [overview, employeeOptions, isAdmin, ownerMutation.isPending, isSearchTab]);

  const parentOptions = (overview?.categories ?? []).map((item) => ({
    value: item.categoryLevel1,
    label: item.categoryLevel1,
  }));

  return (
    <div className="page-stack categories-page">
      <div className="page-heading-row">
        <div>
          <div className="eyebrow">CATEGORY TRACKING</div>
          <Typography.Title level={2}>类目管理</Typography.Title>
          <Typography.Text type="secondary">{isSearchTab ? "按日维度检查搜索词数据；每周7天都有记录才算完整，二级类目可继承一级类目数据。" : "分别查看新品流量和交易增速最近12周的导入情况，缺失周期一目了然。"}</Typography.Text>
        </div>
        {isAdmin && (
          <Space wrap>
            <Button icon={<PlusOutlined />} onClick={() => openCreate("parent")}>新增一级类目</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate("child")}>新增二级类目</Button>
          </Space>
        )}
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as "market" | "search")}
        items={[
          { key: "market", label: "市场榜单", children: <></> },
          { key: "search", label: "搜索词榜单", children: <></> },
        ]}
      />

      <div className="import-summary-grid category-summary-grid">
        <div><span>统计类目</span><strong>{summary.total}</strong></div>
        <div><span>最近12周已完成</span><strong>{summary.complete}</strong></div>
        <div><span>最近12周未完成</span><strong>{summary.incomplete}</strong></div>
        <div><span>整体完成率</span><strong>{summary.rate}%</strong></div>
      </div>

      <Card bordered={false} className="table-card category-table-card">
        <div className="category-toolbar">
          <Space wrap size={10}>
            {!isSearchTab && <Segmented
              value={boardType}
              options={[{ label: "新品流量", value: "NEW_PRODUCT_TRAFFIC" }, { label: "交易增速", value: "TRANSACTION_GROWTH" }]}
              onChange={(value) => setBoardType(value as "NEW_PRODUCT_TRAFFIC" | "TRANSACTION_GROWTH")}
            />}
            <Segmented
              value={mineOnly ? "mine" : "all"}
              options={[{ label: "全部类目", value: "all" }, { label: "我负责的类目", value: "mine" }]}
              onChange={(value) => setMineOnly(value === "mine")}
            />
            <Segmented
              value={statusFilter}
              options={[{ label: "全部状态", value: "ALL" }, { label: "未完成导入", value: "INCOMPLETE" }]}
              onChange={(value) => setStatusFilter(value === "INCOMPLETE" ? "INCOMPLETE" : "ALL")}
            />
            <Input.Search
              allowClear
              placeholder="搜索一级或二级类目"
              style={{ width: 240 }}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Space>
          <Space size={8}>
            <Typography.Text type="secondary">{tableRows.length} 个一级类目</Typography.Text>
            <Button size="small" icon={<ReloadOutlined />} loading={overviewFetching} onClick={() => void (isSearchTab ? searchOverviewQuery.refetch() : overviewQuery.refetch())}>刷新</Button>
          </Space>
        </div>
        <Table<CategoryTableRow>
          className="category-register-table"
          rowKey="key"
          columns={columns}
          dataSource={tableRows}
          loading={overviewLoading}
          defaultExpandAllRows
          pagination={{ pageSize: 30, showSizeChanger: true, pageSizeOptions: [30, 50, 100], showTotal: (total) => `共 ${total} 个一级类目` }}
          scroll={{ x: 2000 }}
          rowClassName={(row) => row.isParent ? "category-parent-row" : "category-child-row"}
          locale={{ emptyText: <Empty description={statusFilter === "INCOMPLETE" ? "所有类目最近12周均已完成导入" : mineOnly ? "暂时没有分配给你的类目" : "暂无类目，请先添加类目或导入数据"} /> }}
        />
        <div className="category-legend">
          {isSearchTab ? <>
            <span><Tag color="success">7/7天</Tag> 该周每天均有搜索词记录</span>
            <span><Tag color="warning">1～6/7天</Tag> 该周数据不完整</span>
            <span><Tag color="error">0/7天</Tag> 该周没有搜索词记录</span>
            <span><Tag>继承</Tag> 二级类目使用一级类目当周数据</span>
          </> : <>
            <span><Tag color="success">已完成</Tag> 最近12周均有导入记录</span>
            <span><Tag color="error">未完成</Tag> 至少有一个周期缺失</span>
            <span><Tag color="success">已导入</Tag> 有商品记录</span>
            <span><Tag>缺失</Tag> 该周没有入库记录</span>
            <span><Tag color="warning">部分完成</Tag> 一级类目下仍有二级类目缺失</span>
          </>}
        </div>
      </Card>

      <Modal
        title={categoryType === "parent" ? "新增一级类目" : "新增二级类目"}
        open={categoryModalOpen}
        onCancel={() => { setCategoryModalOpen(false); form.resetFields(); }}
        onOk={() => form.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={createMutation.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={saveCategory}>
          {categoryType === "parent" ? (
            <Form.Item name="categoryLevel1" label="一级类目名称" rules={[{ required: true, whitespace: true, message: "请输入一级类目名称" }]}>
              <Input maxLength={255} placeholder="例如：厨房用品" />
            </Form.Item>
          ) : (
            <>
              <Form.Item name="categoryLevel1" label="所属一级类目" rules={[{ required: true, message: "请选择一级类目" }]}>
                <Select showSearch optionFilterProp="label" options={parentOptions} placeholder="选择所属一级类目" />
              </Form.Item>
              <Form.Item name="categoryLevel2" label="二级类目名称" rules={[{ required: true, whitespace: true, message: "请输入二级类目名称" }]}>
                <Input maxLength={255} placeholder="例如：厨房置物架" />
              </Form.Item>
            </>
          )}
          <Form.Item name="responsibleUserId" label={categoryType === "parent" ? "默认负责人（可选）" : "单独负责人（可选）"}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={employeeOptions}
              placeholder={categoryType === "parent" ? "选择后默认分配给下属二级类目" : "不选择则继承一级类目负责人"}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
