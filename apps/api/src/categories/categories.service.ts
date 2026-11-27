import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NO_SECOND_LEVEL_CATEGORY, NO_THIRD_LEVEL_CATEGORY } from "../imports/metric-parser";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

type Owner = { id: string; name: string } | null;
type WeekCount = { weekStart: string; count: number; daysWithData?: number; recordCount: number };
type WeekProgress = {
  weekStart: string;
  imported: number;
  total: number;
  recordCount: number;
  partial?: number;
  daysWithData?: number;
  totalDays?: number;
};
type CountValue = { count: number; daysWithData: number; recordCount: number };

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function lastTwelveCompletedWeeks(now = new Date()) {
  const dayFromMonday = (now.getUTCDay() + 6) % 7;
  const currentWeekStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayFromMonday);
  const latestCompletedWeek = currentWeekStart - WEEK_MS;
  return Array.from({ length: 12 }, (_, index) => {
    const start = new Date(latestCompletedWeek - (11 - index) * WEEK_MS);
    return { weekStart: start, weekEnd: new Date(start.getTime() + 6 * DAY_MS), key: dateKey(start) };
  });
}

function countKey(level1: string, level2: string, level3: string, period: string) {
  return `${level1}\u0000${level2}\u0000${level3}\u0000${period}`;
}

type GrandchildNode = {
  id: string;
  categoryLevel3: string;
  responsibleUserId: string | null;
  responsibleUser: Owner;
};

type ChildNode = {
  id: string | null;
  categoryLevel2: string;
  responsibleUserId: string | null;
  responsibleUser: Owner;
  grandchildren: Map<string, GrandchildNode>;
};

type ParentNode = {
  id: string | null;
  categoryLevel1: string;
  responsibleUserId: string | null;
  responsibleUser: Owner;
  children: Map<string, ChildNode>;
};

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  private buildOverview(
    rows: Array<{
      id: string;
      categoryName: string;
      categoryLevel1: string;
      categoryLevel2: string | null;
      categoryLevel3: string | null;
      responsibleUserId: string | null;
      responsibleUser: Owner;
    }>,
    employees: Array<{ id: string; name: string; department: string | null }>,
    periods: ReturnType<typeof lastTwelveCompletedWeeks>,
    counts: Map<string, CountValue>,
    kind: "market" | "search",
  ) {
    const parentMap = new Map<string, ParentNode>();
    for (const row of rows) {
      let parent = parentMap.get(row.categoryLevel1);
      if (!parent) {
        parent = {
          id: null,
          categoryLevel1: row.categoryLevel1,
          responsibleUserId: null,
          responsibleUser: null,
          children: new Map(),
        };
        parentMap.set(row.categoryLevel1, parent);
      }

      if (row.categoryLevel2 === null) {
        if (!parent.id || (!parent.responsibleUserId && row.responsibleUserId)) {
          parent.id = row.id;
          parent.responsibleUserId = row.responsibleUserId;
          parent.responsibleUser = row.responsibleUser;
        }
        continue;
      }

      let child = parent.children.get(row.categoryLevel2);
      if (!child) {
        child = {
          id: null,
          categoryLevel2: row.categoryLevel2,
          responsibleUserId: null,
          responsibleUser: null,
          grandchildren: new Map(),
        };
        parent.children.set(row.categoryLevel2, child);
      }

      if (row.categoryLevel3 === null) {
        if (!child.id || (!child.responsibleUserId && row.responsibleUserId)) {
          child.id = row.id;
          child.responsibleUserId = row.responsibleUserId;
          child.responsibleUser = row.responsibleUser;
        }
      } else {
        const existing = child.grandchildren.get(row.categoryLevel3);
        if (!existing || (!existing.responsibleUserId && row.responsibleUserId)) {
          child.grandchildren.set(row.categoryLevel3, {
            id: row.id,
            categoryLevel3: row.categoryLevel3,
            responsibleUserId: row.responsibleUserId,
            responsibleUser: row.responsibleUser,
          });
        }
      }
    }

    const readWeekCounts = (level1: string, level2: string, level3: string): WeekCount[] =>
      periods.map((period) => {
        const selected = counts.get(countKey(level1, level2, level3, period.key)) ?? {
          count: 0, daysWithData: 0, recordCount: 0,
        };
        return kind === "search"
          ? { weekStart: period.key, count: selected.daysWithData, daysWithData: selected.daysWithData, recordCount: selected.recordCount }
          : { weekStart: period.key, count: selected.recordCount, recordCount: selected.recordCount };
      });

    const makeProgress = (branches: WeekCount[][]): WeekProgress[] => periods.map((period) => {
      const weekValues = branches.map((branch) => branch.find((week) => week.weekStart === period.key)!).filter(Boolean);
      const imported = kind === "search"
        ? weekValues.filter((week) => (week.daysWithData ?? week.count) === 7).length
        : weekValues.filter((week) => week.count > 0).length;
      const partial = kind === "search"
        ? weekValues.filter((week) => (week.daysWithData ?? week.count) > 0 && (week.daysWithData ?? week.count) < 7).length
        : 0;
      const recordCount = weekValues.reduce((sum, week) => sum + (week.recordCount ?? 0), 0);
      return {
        weekStart: period.key,
        imported,
        total: branches.length,
        recordCount,
        ...(kind === "search" ? { partial } : {}),
      };
    });

    const categories = [...parentMap.values()]
      .sort((a, b) => a.categoryLevel1.localeCompare(b.categoryLevel1, "zh-CN"))
      .map((parent) => {
        const children = [...parent.children.values()]
          .sort((a, b) => a.categoryLevel2.localeCompare(b.categoryLevel2, "zh-CN"))
          .map((child) => {
            const childOwnerId = child.responsibleUserId ?? parent.responsibleUserId;
            const childOwnerName = child.responsibleUser?.name ?? parent.responsibleUser?.name ?? null;
            const grandchildren = [...child.grandchildren.values()]
              .sort((a, b) => a.categoryLevel3.localeCompare(b.categoryLevel3, "zh-CN"))
              .map((grandchild) => {
                const ownerUserId = grandchild.responsibleUserId ?? childOwnerId;
                const ownerName = grandchild.responsibleUser?.name ?? childOwnerName;
                return {
                  id: grandchild.id,
                  categoryLevel1: parent.categoryLevel1,
                  categoryLevel2: child.categoryLevel2,
                  categoryLevel3: grandchild.categoryLevel3,
                  responsibleUserId: grandchild.responsibleUserId,
                  responsibleUserName: grandchild.responsibleUser?.name ?? null,
                  ownerUserId,
                  ownerName,
                  inherited: !grandchild.responsibleUserId && Boolean(ownerUserId),
                  weekCounts: readWeekCounts(parent.categoryLevel1, child.categoryLevel2, grandchild.categoryLevel3),
                };
              });

            const directWeekCounts = readWeekCounts(parent.categoryLevel1, child.categoryLevel2, NO_THIRD_LEVEL_CATEGORY);
            const branches = grandchildren.length ? grandchildren.map((item) => item.weekCounts) : [directWeekCounts];
            return {
              id: child.id,
              categoryLevel1: parent.categoryLevel1,
              categoryLevel2: child.categoryLevel2,
              responsibleUserId: child.responsibleUserId,
              responsibleUserName: child.responsibleUser?.name ?? null,
              ownerUserId: childOwnerId,
              ownerName: childOwnerName,
              inherited: !child.responsibleUserId && Boolean(parent.responsibleUserId),
              weekCounts: directWeekCounts,
              weekProgress: makeProgress(branches),
              totalGrandchildren: grandchildren.length,
              grandchildren,
            };
          });

        const parentBranches = children.flatMap((child) =>
          child.totalGrandchildren ? child.grandchildren.map((grandchild) => grandchild.weekCounts) : [child.weekCounts],
        );
        return {
          id: parent.id,
          categoryLevel1: parent.categoryLevel1,
          responsibleUserId: parent.responsibleUserId,
          responsibleUserName: parent.responsibleUser?.name ?? null,
          ownerUserId: parent.responsibleUserId,
          ownerName: parent.responsibleUser?.name ?? null,
          weekCounts: readWeekCounts(parent.categoryLevel1, NO_SECOND_LEVEL_CATEGORY, NO_THIRD_LEVEL_CATEGORY),
          weekProgress: makeProgress(parentBranches),
          children,
        };
      });

    return {
      periods: periods.map((period) => ({ weekStart: period.key, weekEnd: dateKey(period.weekEnd) })),
      categories,
      employees,
    };
  }

  async overview(boardType: "NEW_PRODUCT_TRAFFIC" | "TRANSACTION_GROWTH" = "NEW_PRODUCT_TRAFFIC") {
    const [rows, employees] = await Promise.all([
      this.prisma.category.findMany({
        where: { enabled: true },
        include: { responsibleUser: { select: { id: true, name: true } } },
        orderBy: [{ categoryLevel1: "asc" }, { categoryLevel2: "asc" }, { categoryLevel3: "asc" }],
      }),
      this.prisma.user.findMany({
        where: { role: "EMPLOYEE", employmentStatus: "ACTIVE", accountStatus: "ACTIVE" },
        select: { id: true, name: true, department: true },
        orderBy: [{ name: "asc" }],
      }),
    ]);
    const periods = lastTwelveCompletedWeeks();
    const grouped = await this.prisma.productHistory.groupBy({
      by: ["categoryLevel1", "categoryLevel2", "categoryLevel3", "weekStart"],
      where: { boardType, weekStart: { in: periods.map((period) => period.weekStart) } },
      _count: { _all: true },
    });
    const counts = new Map<string, CountValue>();
    for (const item of grouped) {
      const key = countKey(item.categoryLevel1, item.categoryLevel2, item.categoryLevel3, dateKey(item.weekStart));
      const current = counts.get(key) ?? { count: 0, daysWithData: 0, recordCount: 0 };
      current.count += item._count._all;
      current.recordCount += item._count._all;
      counts.set(key, current);
    }
    return this.buildOverview(rows, employees, periods, counts, "market");
  }

  async searchOverview(searchTermType?: "搜索词" | "核心词") {
    const [rows, employees] = await Promise.all([
      this.prisma.category.findMany({
        where: { enabled: true },
        include: { responsibleUser: { select: { id: true, name: true } } },
        orderBy: [{ categoryLevel1: "asc" }, { categoryLevel2: "asc" }, { categoryLevel3: "asc" }],
      }),
      this.prisma.user.findMany({
        where: { role: "EMPLOYEE", employmentStatus: "ACTIVE", accountStatus: "ACTIVE" },
        select: { id: true, name: true, department: true },
        orderBy: [{ name: "asc" }],
      }),
    ]);
    const periods = lastTwelveCompletedWeeks();
    const grouped = await this.prisma.searchTermHistory.groupBy({
      by: ["categoryLevel1", "categoryLevel2", "categoryLevel3", "searchDate"],
      where: {
        dimension: "日",
        ...(searchTermType ? { searchTermType } : {}),
        searchDate: { gte: periods[0].weekStart, lte: periods[11].weekEnd },
      },
      _count: { _all: true },
    });
    const counts = new Map<string, CountValue>();
    for (const item of grouped) {
      const dayFromMonday = (item.searchDate.getUTCDay() + 6) % 7;
      const weekStart = new Date(Date.UTC(
        item.searchDate.getUTCFullYear(),
        item.searchDate.getUTCMonth(),
        item.searchDate.getUTCDate() - dayFromMonday,
      ));
      const key = countKey(item.categoryLevel1, item.categoryLevel2, item.categoryLevel3, dateKey(weekStart));
      const current = counts.get(key) ?? { count: 0, daysWithData: 0, recordCount: 0 };
      current.daysWithData += 1;
      current.recordCount += item._count._all;
      counts.set(key, current);
    }
    return this.buildOverview(rows, employees, periods, counts, "search");
  }

  private async assertActiveEmployee(userId: string | null | undefined) {
    if (!userId) return;
    const user = await this.prisma.user.findFirst({
      where: { id: userId, role: "EMPLOYEE", employmentStatus: "ACTIVE", accountStatus: "ACTIVE" },
      select: { id: true },
    });
    if (!user) throw new BadRequestException("负责人必须是账号正常且在职的普通员工。");
  }

  async create(input: {
    categoryLevel1: string;
    categoryLevel2?: string;
    categoryLevel3?: string;
    responsibleUserId?: string | null;
  }) {
    const categoryLevel1 = input.categoryLevel1.trim();
    const categoryLevel2 = input.categoryLevel2?.trim() || null;
    const categoryLevel3 = input.categoryLevel3?.trim() || null;
    if (!categoryLevel1) throw new BadRequestException("请输入一级类目名称。");
    if (categoryLevel3 && !categoryLevel2) throw new BadRequestException("新增三级类目时必须先选择二级类目。");
    if (categoryLevel2 === NO_SECOND_LEVEL_CATEGORY) throw new BadRequestException("无二级类目由导入数据自动生成，不能手动创建。");
    if (categoryLevel3 === NO_THIRD_LEVEL_CATEGORY) throw new BadRequestException("无三级类目由导入数据自动生成，不能手动创建。");
    if ([categoryLevel1, categoryLevel2, categoryLevel3].some((value) => value && value.length > 255)) {
      throw new BadRequestException("类目名称不能超过255个字符。");
    }
    const fullName = [categoryLevel1, categoryLevel2, categoryLevel3].filter(Boolean).join(" / ");
    if (fullName.length > 255) throw new BadRequestException("完整类目路径不能超过255个字符。");
    await this.assertActiveEmployee(input.responsibleUserId);

    return this.prisma.$transaction(async (tx) => {
      const parent = await tx.category.findFirst({
        where: { categoryLevel1, categoryLevel2: null, categoryLevel3: null },
        select: { id: true },
      });
      if (!categoryLevel2) {
        if (parent) throw new BadRequestException("这个一级类目已经存在。");
        return tx.category.create({
          data: {
            categoryName: categoryLevel1,
            categoryLevel1,
            categoryLevel2: null,
            categoryLevel3: null,
            responsibleUserId: input.responsibleUserId ?? null,
          },
        });
      }

      if (!parent) {
        await tx.category.create({
          data: { categoryName: categoryLevel1, categoryLevel1, categoryLevel2: null, categoryLevel3: null },
        });
      }

      const childName = `${categoryLevel1} / ${categoryLevel2}`;
      const child = await tx.category.findFirst({
        where: { categoryLevel1, categoryLevel2, categoryLevel3: null },
        select: { id: true },
      });
      if (!categoryLevel3) {
        if (child) throw new BadRequestException("这个二级类目已经存在。");
        return tx.category.create({
          data: {
            categoryName: childName,
            categoryLevel1,
            categoryLevel2,
            categoryLevel3: null,
            responsibleUserId: input.responsibleUserId ?? null,
          },
        });
      }

      if (!child) {
        await tx.category.create({
          data: { categoryName: childName, categoryLevel1, categoryLevel2, categoryLevel3: null },
        });
      }
      const thirdName = `${childName} / ${categoryLevel3}`;
      const existingThird = await tx.category.findFirst({
        where: { categoryLevel1, categoryLevel2, categoryLevel3 },
        select: { id: true },
      });
      if (existingThird) throw new BadRequestException("这个三级类目已经存在。");
      return tx.category.create({
        data: {
          categoryName: thirdName,
          categoryLevel1,
          categoryLevel2,
          categoryLevel3,
          responsibleUserId: input.responsibleUserId ?? null,
        },
      });
    });
  }

  async updateResponsible(id: string, responsibleUserId: string | null) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException("类目不存在。");
    await this.assertActiveEmployee(responsibleUserId);
    await this.prisma.category.update({ where: { id }, data: { responsibleUserId } });
    return { success: true };
  }
}
