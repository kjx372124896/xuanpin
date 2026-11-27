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
import {
  CATEGORY_LEVELS, childImportBranches, getLevelImportProgress, grandchildImportBranches,
  hasIncompleteImport, parentImportBranches,
  type LevelImportProgress,
} from "./category-import-progress";

interface WeekPeriod {
  weekStart: string;
  weekEnd: string;
}
interface WeekCount {
  weekStart: string;
  count: number;
  daysWithData?: number;
  recordCount?: number;
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
  weekProgress: WeekProgress[];
  totalGrandchildren: number;
  grandchildren: CategoryGrandchild[];
}
interface CategoryGrandchild {
  id: string;
  categoryLevel1: string;
  categoryLevel2: string;
  categoryLevel3: string;
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
  weekCounts: WeekCount[];
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
  level: 1 | 2 | 3;
  isParent: boolean;
  importProgress: LevelImportProgress;
  categoryLevel1: string;
  categoryLevel2: string | null;
  categoryLevel3: string | null;
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
  const [searchTermType, setSearchTermType] = useState<"搜索词" | "核心词">("搜索词");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "INCOMPLETE">("ALL");
  const [search, setSearch] = useState("");
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryType, setCategoryType] = useState<"parent" | "child" | "grandchild">("parent");
  const [form] = Form.useForm();
  const selectedParentForForm = Form.useWatch("categoryLevel1", form) as string | undefined;

  const overviewQuery = useQuery({
    queryKey: ["categoriesOverview", boardType],
    queryFn: async () => (await api.get<CategoriesOverview>("/categories/overview", { params: { boardType } })).data,
    staleTime: 30_000,
  });
  const searchOverviewQuery = useQuery({
    queryKey: ["categoriesSearchOverview", searchTermType],
    queryFn: async () => (await api.get<CategoriesOverview>("/categories/search-overview", { params: { searchTermType } })).data,
    enabled: activeTab === "search",
    staleTime: 30_000,
  });
  const isSearchTab = activeTab === "search";
  const overview = isSearchTab ? searchOverviewQuery.data : overviewQuery.data;
  const overviewLoading = isSearchTab ? searchOverviewQuery.isLoading : overviewQuery.isLoading;
  const overviewFetching = isSearchTab ? searchOverviewQuery.isFetching : overviewQuery.isFetching;
  const summary = useMemo(() => {
    const progress = (overview?.categories ?? []).flatMap((parent) => {
      const levels = getLevelImportProgress(parentImportBranches(parent), overview?.periods ?? [], isSearchTab);
      return CATEGORY_LEVELS.flatMap((level) => levels[level] ? [levels[level]!] : []);
    });
    const total = progress.reduce((sum, level) => sum + level.total, 0);
    const complete = progress.reduce((sum, level) => sum + level.imported, 0);
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
    const periods = overview?.periods ?? [];

    return (overview?.categories ?? []).flatMap((parent) => {
      const parentMatches = !keyword || parent.categoryLevel1.toLocaleLowerCase().includes(keyword);
      const childRows = parent.children.flatMap((child) => {
        const childMatches = child.categoryLevel2.toLocaleLowerCase().includes(keyword);
        const grandchildren = child.grandchildren
          .filter((grandchild) => !mineOnly || grandchild.ownerUserId === user?.id)
          .filter((grandchild) => !keyword || parentMatches || childMatches || grandchild.categoryLevel3.toLocaleLowerCase().includes(keyword))
          .map((grandchild) => ({
            key: `grandchild:${grandchild.id}`,
            id: grandchild.id,
            level: 3 as const,
            isParent: false,
            importProgress: getLevelImportProgress(grandchildImportBranches(grandchild), periods, isSearchTab),
            categoryLevel1: "",
            categoryLevel2: null,
            categoryLevel3: grandchild.categoryLevel3,
            responsibleUserId: grandchild.responsibleUserId,
            ownerUserId: grandchild.ownerUserId,
            ownerName: grandchild.ownerName,
            inherited: grandchild.inherited,
            weekCounts: grandchild.weekCounts,
          }))
          .filter((grandchild) => statusFilter !== "INCOMPLETE" || hasIncompleteImport(grandchild.importProgress));

        const childProgress = getLevelImportProgress(childImportBranches(child), periods, isSearchTab);
        const includeChild = (!mineOnly || child.ownerUserId === user?.id || grandchildren.length > 0) &&
          (statusFilter !== "INCOMPLETE" || hasIncompleteImport(childProgress) || grandchildren.length > 0) &&
          (parentMatches || childMatches || grandchildren.length > 0);
        if (!includeChild) return [];

        return [{
          key: `child:${child.id ?? parent.categoryLevel1 + ":" + child.categoryLevel2}`,
          id: child.id,
          level: 2 as const,
          isParent: false,
          importProgress: childProgress,
          categoryLevel1: "",
          categoryLevel2: child.categoryLevel2,
          categoryLevel3: null,
          responsibleUserId: child.responsibleUserId,
          ownerUserId: child.ownerUserId,
          ownerName: child.ownerName,
          inherited: child.inherited,
          weekCounts: child.weekCounts,
          weekProgress: child.weekProgress,
          totalChildren: child.grandchildren.filter((grandchild) => grandchild.categoryLevel3 !== "无三级类目").length,
          children: grandchildren,
        }];
      });

      const parentProgress = getLevelImportProgress(parentImportBranches(parent), periods, isSearchTab);
      const includeParent = (!mineOnly || parent.ownerUserId === user?.id || childRows.length > 0) &&
        (parentMatches || childRows.length > 0) &&
        (statusFilter !== "INCOMPLETE" || hasIncompleteImport(parentProgress) || childRows.length > 0);
      if (!includeParent) return [];

      return [{
        key: `parent:${parent.categoryLevel1}`,
        id: parent.id,
        level: 1 as const,
        isParent: true,
        importProgress: parentProgress,
        categoryLevel1: parent.categoryLevel1,
        categoryLevel2: null,
        categoryLevel3: null,
        responsibleUserId: parent.responsibleUserId,
        ownerUserId: parent.ownerUserId,
        ownerName: parent.ownerName,
        inherited: false,
        weekProgress: parent.weekProgress,
        totalChildren: parent.weekProgress[0]?.total ?? 0,
        children: childRows,
      }];
    });
  }, [overview, mineOnly, statusFilter, search, user?.id, isSearchTab]);

  function openCreate(type: "parent" | "child" | "grandchild") {
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
    if (categoryType === "child" || categoryType === "grandchild") payload.categoryLevel2 = values.categoryLevel2;
    if (categoryType === "grandchild") payload.categoryLevel3 = values.categoryLevel3;
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

    const placeholder = row.level === 1
      ? "选择负责人"
      : row.ownerName ? `继承：${row.ownerName}` : "继承（未分配）";
    return (
      <Select
        size="small"
        allowClear
        showSearch
        optionFilterProp="label"
        style={{ width: "100%" }}
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
    if (row.level !== 3) {
      const progress = row.weekProgress?.find((item) => item.weekStart === period.weekStart);
      if (!progress) return <Typography.Text type="secondary">—</Typography.Text>;
      if (progress.total > 0) {
        if (isSearchTab) {
          const partial = progress.partial ?? 0;
          const color = progress.imported === progress.total ? "success" : progress.imported > 0 || partial > 0 ? "warning" : "error";
          return (
            <Tooltip title={`完整 ${progress.imported}/${progress.total} 个三级数据分支；部分完成 ${partial} 个；共 ${progress.recordCount} 条搜索记录。`}>
              <Tag color={color}>{progress.imported}/{progress.total}</Tag>
            </Tooltip>
          );
        }
        const color = progress.imported === progress.total ? "success" : progress.imported > 0 ? "warning" : "error";
        return (
          <Tooltip title={`已导入 ${progress.imported}/${progress.total} 个三级数据分支，共 ${progress.recordCount} 条商品记录`}>
            <Tag color={color}>{progress.imported}/{progress.total}</Tag>
          </Tooltip>
        );
      }
    }

    const week = row.weekCounts?.find((item) => item.weekStart === period.weekStart);
    if (isSearchTab) {
      const days = week?.daysWithData ?? week?.count ?? 0;
      const color = days === 7 ? "success" : days > 0 ? "warning" : "error";
      return <Tooltip title={`该周 ${days}/7 天有搜索词记录，共 ${week?.recordCount ?? 0} 条`}><Tag color={color}>{days}/7天</Tag></Tooltip>;
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
        ellipsis: true,
        fixed: "left",
        render: (value: string, row) => row.level === 1
          ? <Typography.Text strong>{value}</Typography.Text>
          : <Typography.Text type="secondary">—</Typography.Text>,
      },
      {
        title: "二级类目",
        dataIndex: "categoryLevel2",
        key: "categoryLevel2",
        width: 190,
        ellipsis: true,
        fixed: "left",
        render: (value: string | null, row) => row.level === 1
          ? <Typography.Text type="secondary">全部二级类目</Typography.Text>
          : row.level === 2 ? <Typography.Text>{value}</Typography.Text> : <Typography.Text type="secondary">—</Typography.Text>,
      },
      {
        title: "三级类目",
        dataIndex: "categoryLevel3",
        key: "categoryLevel3",
        width: 190,
        ellipsis: true,
        fixed: "left",
        render: (value: string | null, row) => row.level === 1
          ? <Typography.Text type="secondary">全部三级类目</Typography.Text>
          : row.level === 2
            ? <Typography.Text type="secondary">{row.totalChildren ? `${row.totalChildren} 个三级分类` : "暂无三级分类"}</Typography.Text>
            : <Typography.Text>{value}</Typography.Text>,
      },
      {
        title: "负责人",
        key: "owner",
        width: 180,
        fixed: "left",
        render: (_value, row) => renderOwner(row),
      },
      ...CATEGORY_LEVELS.map((level) => ({
        title: `${["", "一级", "二级", "三级"][level]}导入`,
        key: `importStatus${level}`,
        width: 110,
        fixed: "left" as const,
        align: "center" as const,
        render: (_value: unknown, row: CategoryTableRow) => {
          const progress = row.importProgress[level];
          if (!progress) return <Typography.Text type="secondary">—</Typography.Text>;
          return (
            <Tooltip title={`仅统计${["", "一级", "二级", "三级"][level]}类目直接导入的数据；最近${progress.totalWeeks}周完整 ${progress.completedWeeks}/${progress.totalWeeks} 周，已完成 ${progress.imported}/${progress.total} 个类目。`}>
              <Tag color={progress.complete ? "success" : "error"}>
                {progress.complete ? "已完成" : "未完成"}
              </Tag>
            </Tooltip>
          );
        },
      })),
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
    return [...fixedColumns, ...weekColumns].map((column) => ({
      ...column,
      width: typeof column.width === "number" ? Math.round(column.width * 2 / 3) : column.width,
    }));
  }, [overview, employeeOptions, isAdmin, ownerMutation.isPending, isSearchTab]);

  const parentOptions = (overview?.categories ?? []).map((item) => ({
    value: item.categoryLevel1,
    label: item.categoryLevel1,
  }));
  const childOptions = (overview?.categories.find((item) => item.categoryLevel1 === selectedParentForForm)?.children ?? [])
    .filter((item) => item.categoryLevel2 !== "无二级类目")
    .map((item) => ({ value: item.categoryLevel2, label: item.categoryLevel2 }));

  return (
    <div className="page-stack categories-page">
      <div className="page-heading-row">
        <div>
          <div className="eyebrow">CATEGORY TRACKING</div>
          <Typography.Title level={2}>类目管理</Typography.Title>
          <Typography.Text type="secondary">{isSearchTab ? "一级、二级、三级导入状态分别统计最近12周的直接导入数据；搜索词和核心词独立检查，每周7天都有记录才算完整。" : "分别查看新品流量和交易增速最近12周的导入情况；一级、二级、三级导入状态独立判断。"}</Typography.Text>
        </div>
        {isAdmin && (
          <Space wrap>
            <Button icon={<PlusOutlined />} onClick={() => openCreate("parent")}>新增一级类目</Button>
            <Button icon={<PlusOutlined />} onClick={() => openCreate("child")}>新增二级类目</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate("grandchild")}>新增三级类目</Button>
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
        <div><span>统计各级类目</span><strong>{summary.total}</strong></div>
        <div><span>最近12周已完成</span><strong>{summary.complete}</strong></div>
        <div><span>最近12周未完成</span><strong>{summary.incomplete}</strong></div>
        <div><span>整体完成率</span><strong>{summary.rate}%</strong></div>
      </div>

      <Card bordered={false} className="table-card category-table-card">
        <div className="category-toolbar">
          <Space wrap size={10}>
            {isSearchTab ? <Segmented
              value={searchTermType}
              options={[{ label: "搜索词", value: "搜索词" }, { label: "核心词", value: "核心词" }]}
              onChange={(value) => setSearchTermType(value as "搜索词" | "核心词")}
            /> : <Segmented
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
              placeholder="搜索一级、二级或三级类目"
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
          tableLayout="fixed"
          dataSource={tableRows}
          loading={overviewLoading}
          defaultExpandAllRows
          pagination={{ pageSize: 30, showSizeChanger: true, pageSizeOptions: [30, 50, 100], showTotal: (total) => `共 ${total} 个一级类目` }}
          scroll={{ x: columns.reduce((total, column) => total + (typeof column.width === "number" ? column.width : 0), 0) }}
          rowClassName={(row) => row.level === 1 ? "category-parent-row" : row.level === 2 ? "category-child-row" : "category-grandchild-row"}
          locale={{ emptyText: <Empty description={statusFilter === "INCOMPLETE" ? "所有类目最近12周均已完成导入" : mineOnly ? "暂时没有分配给你的类目" : "暂无类目，请先添加类目或导入数据"} /> }}
        />
        <div className="category-legend">
          <span>一级：无二级＋无三级数据；二级：实际二级下的无三级数据；三级：实际三级数据</span>
          <span>各级独立判断，— 表示该行不涉及此层级或暂无该层级类目</span>
          {isSearchTab ? <>
            <span><Tag color="success">7/7天</Tag> 该周每天均有搜索词记录</span>
            <span><Tag color="warning">1～6/7天</Tag> 该周数据不完整</span>
            <span><Tag color="error">0/7天</Tag> 该周没有搜索词记录</span>
            <span><Tag>继承</Tag> 三级类目优先继承二级负责人，二级再继承一级</span>
          </> : <>
            <span><Tag color="success">已完成</Tag> 最近12周均有导入记录</span>
            <span><Tag color="error">未完成</Tag> 至少有一个周期缺失</span>
            <span><Tag color="success">已导入</Tag> 有商品记录</span>
            <span><Tag>缺失</Tag> 该周没有入库记录</span>
            <span><Tag color="warning">部分完成</Tag> 周进度汇总中仍有数据分支缺失</span>
          </>}
        </div>
      </Card>

      <Modal
        title={categoryType === "parent" ? "新增一级类目" : categoryType === "child" ? "新增二级类目" : "新增三级类目"}
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
                <Select showSearch optionFilterProp="label" options={parentOptions} placeholder="选择所属一级类目" onChange={() => form.setFieldsValue({ categoryLevel2: undefined })} />
              </Form.Item>
              {categoryType === "child" ? (
                <Form.Item name="categoryLevel2" label="二级类目名称" rules={[{ required: true, whitespace: true, message: "请输入二级类目名称" }]}>
                  <Input maxLength={255} placeholder="例如：厨房置物架" />
                </Form.Item>
              ) : (
                <>
                  <Form.Item name="categoryLevel2" label="所属二级类目" rules={[{ required: true, message: "请选择二级类目" }]}>
                    <Select showSearch optionFilterProp="label" options={childOptions} placeholder={selectedParentForForm ? "选择所属二级类目" : "请先选择一级类目"} disabled={!selectedParentForForm} />
                  </Form.Item>
                  <Form.Item name="categoryLevel3" label="三级类目名称" rules={[{ required: true, whitespace: true, message: "请输入三级类目名称" }]}>
                    <Input maxLength={255} placeholder="例如：调料架" />
                  </Form.Item>
                </>
              )}
            </>
          )}
          <Form.Item name="responsibleUserId" label={categoryType === "parent" ? "默认负责人（可选）" : "单独负责人（可选）"}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={employeeOptions}
              placeholder={categoryType === "parent" ? "选择后默认分配给下属二级类目" : categoryType === "child" ? "不选择则继承一级类目负责人" : "不选择则继承二级或一级类目负责人"}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
