import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NO_SECOND_LEVEL_CATEGORY } from "../imports/metric-parser";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function lastTwelveCompletedWeeks(now = new Date()) {
  const dayFromMonday = (now.getUTCDay() + 6) % 7;
  const currentWeekStart = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - dayFromMonday,
  );
  const latestCompletedWeek = currentWeekStart - WEEK_MS;
  return Array.from({ length: 12 }, (_, index) => {
    const start = new Date(latestCompletedWeek - (11 - index) * WEEK_MS);
    return {
      weekStart: start,
      weekEnd: new Date(start.getTime() + 6 * DAY_MS),
      key: dateKey(start),
    };
  });
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(boardType: "NEW_PRODUCT_TRAFFIC" | "TRANSACTION_GROWTH" = "NEW_PRODUCT_TRAFFIC") {
    const [rows, employees] = await Promise.all([
      this.prisma.category.findMany({
        where: { enabled: true },
        include: { responsibleUser: { select: { id: true, name: true } } },
        orderBy: [{ categoryLevel1: "asc" }, { categoryLevel2: "asc" }],
      }),
      this.prisma.user.findMany({
        where: { role: "EMPLOYEE", employmentStatus: "ACTIVE", accountStatus: "ACTIVE" },
        select: { id: true, name: true, department: true },
        orderBy: [{ name: "asc" }],
      }),
    ]);

    const periods = lastTwelveCompletedWeeks();
    const grouped = await this.prisma.productHistory.groupBy({
      by: ["categoryLevel1", "categoryLevel2", "weekStart"],
      where: { boardType, weekStart: { in: periods.map((period) => period.weekStart) } },
      _count: { _all: true },
    });
    const countMap = new Map<string, number>();
    for (const item of grouped) {
      countMap.set(
        `${item.categoryLevel1}\u0000${item.categoryLevel2 ?? ""}\u0000${dateKey(item.weekStart)}`,
        item._count._all,
      );
    }

    type Owner = { id: string; name: string } | null;
    type Child = {
      id: string;
      categoryLevel2: string;
      responsibleUserId: string | null;
      responsibleUser: Owner;
    };
    type Parent = {
      id: string | null;
      categoryLevel1: string;
      responsibleUserId: string | null;
      responsibleUser: Owner;
      children: Map<string, Child>;
    };

    const parentMap = new Map<string, Parent>();
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
        parent.id = row.id;
        parent.responsibleUserId = row.responsibleUserId;
        parent.responsibleUser = row.responsibleUser;
        continue;
      }

      const existing = parent.children.get(row.categoryLevel2);
      if (!existing || (!existing.responsibleUserId && row.responsibleUserId)) {
        parent.children.set(row.categoryLevel2, {
          id: row.id,
          categoryLevel2: row.categoryLevel2,
          responsibleUserId: row.responsibleUserId,
          responsibleUser: row.responsibleUser,
        });
      }
    }

    const categories = [...parentMap.values()]
      .sort((a, b) => a.categoryLevel1.localeCompare(b.categoryLevel1, "zh-CN"))
      .map((parent) => {
        const children = [...parent.children.values()]
          .sort((a, b) => a.categoryLevel2.localeCompare(b.categoryLevel2, "zh-CN"))
          .map((child) => ({
            id: child.id,
            categoryLevel1: parent.categoryLevel1,
            categoryLevel2: child.categoryLevel2,
            responsibleUserId: child.responsibleUserId,
            responsibleUserName: child.responsibleUser?.name ?? null,
            ownerUserId: child.responsibleUserId ?? parent.responsibleUserId,
            ownerName: child.responsibleUser?.name ?? parent.responsibleUser?.name ?? null,
            inherited: !child.responsibleUserId && Boolean(parent.responsibleUserId),
            weekCounts: periods.map((period) => ({
              weekStart: period.key,
              count: countMap.get(`${parent.categoryLevel1}\u0000${child.categoryLevel2}\u0000${period.key}`) ?? 0,
            })),
          }));

        const weekProgress = periods.map((period) => {
          if (children.length) {
            const imported = children.filter((child) =>
              (child.weekCounts.find((week) => week.weekStart === period.key)?.count ?? 0) > 0,
            ).length;
            const recordCount = children.reduce((sum, child) =>
              sum + (child.weekCounts.find((week) => week.weekStart === period.key)?.count ?? 0), 0);
            return { weekStart: period.key, imported, total: children.length, recordCount };
          }
          const recordCount = countMap.get(`${parent.categoryLevel1}\u0000\u0000${period.key}`) ?? 0;
          return { weekStart: period.key, imported: recordCount > 0 ? 1 : 0, total: 1, recordCount };
        });

        return {
          id: parent.id,
          categoryLevel1: parent.categoryLevel1,
          responsibleUserId: parent.responsibleUserId,
          responsibleUserName: parent.responsibleUser?.name ?? null,
          ownerUserId: parent.responsibleUserId,
          ownerName: parent.responsibleUser?.name ?? null,
          weekProgress,
          children,
        };
      });

    return {
      periods: periods.map((period) => ({
        weekStart: period.key,
        weekEnd: dateKey(period.weekEnd),
      })),
      categories,
      employees,
    };
  }

  async searchOverview() {
    const [rows, employees] = await Promise.all([
      this.prisma.category.findMany({
        where: { enabled: true },
        include: { responsibleUser: { select: { id: true, name: true } } },
        orderBy: [{ categoryLevel1: "asc" }, { categoryLevel2: "asc" }],
      }),
      this.prisma.user.findMany({
        where: { role: "EMPLOYEE", employmentStatus: "ACTIVE", accountStatus: "ACTIVE" },
        select: { id: true, name: true, department: true },
        orderBy: [{ name: "asc" }],
      }),
    ]);

    const periods = lastTwelveCompletedWeeks();
    const levels = [...new Set(rows.map((row) => row.categoryLevel1))];
    const grouped = levels.length ? await this.prisma.searchTermHistory.groupBy({
      by: ["categoryLevel1", "categoryLevel2", "searchDate"],
      where: {
        dimension: "日",
        categoryLevel1: { in: levels },
        searchDate: { gte: periods[0].weekStart, lte: periods[11].weekEnd },
      },
      _count: { _all: true },
    }) : [];

    const dailyCounts = new Map<string, { daysWithData: number; recordCount: number }>();
    for (const item of grouped) {
      const dayFromMonday = (item.searchDate.getUTCDay() + 6) % 7;
      const weekStart = new Date(Date.UTC(
        item.searchDate.getUTCFullYear(),
        item.searchDate.getUTCMonth(),
        item.searchDate.getUTCDate() - dayFromMonday,
      ));
      const key = `${item.categoryLevel1}\u0000${item.categoryLevel2}\u0000${dateKey(weekStart)}`;
      const current = dailyCounts.get(key) ?? { daysWithData: 0, recordCount: 0 };
      current.daysWithData += 1;
      current.recordCount += item._count._all;
      dailyCounts.set(key, current);
    }

    type Owner = { id: string; name: string } | null;
    type Child = {
      id: string;
      categoryLevel2: string;
      responsibleUserId: string | null;
      responsibleUser: Owner;
    };
    type Parent = {
      id: string | null;
      categoryLevel1: string;
      responsibleUserId: string | null;
      responsibleUser: Owner;
      children: Map<string, Child>;
    };

    const parentMap = new Map<string, Parent>();
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
        parent.id = row.id;
        parent.responsibleUserId = row.responsibleUserId;
        parent.responsibleUser = row.responsibleUser;
        continue;
      }

      const existing = parent.children.get(row.categoryLevel2);
      if (!existing || (!existing.responsibleUserId && row.responsibleUserId)) {
        parent.children.set(row.categoryLevel2, {
          id: row.id,
          categoryLevel2: row.categoryLevel2,
          responsibleUserId: row.responsibleUserId,
          responsibleUser: row.responsibleUser,
        });
      }
    }

    const readCount = (level1: string, level2: string, weekStart: string) =>
      dailyCounts.get(`${level1}\u0000${level2}\u0000${weekStart}`) ?? { daysWithData: 0, recordCount: 0 };

    const categories = [...parentMap.values()]
      .sort((a, b) => a.categoryLevel1.localeCompare(b.categoryLevel1, "zh-CN"))
      .map((parent) => {
        const children = [...parent.children.values()]
          .sort((a, b) => a.categoryLevel2.localeCompare(b.categoryLevel2, "zh-CN"))
          .map((child) => ({
            id: child.id,
            categoryLevel1: parent.categoryLevel1,
            categoryLevel2: child.categoryLevel2,
            responsibleUserId: child.responsibleUserId,
            responsibleUserName: child.responsibleUser?.name ?? null,
            ownerUserId: child.responsibleUserId ?? parent.responsibleUserId,
            ownerName: child.responsibleUser?.name ?? parent.responsibleUser?.name ?? null,
            inherited: !child.responsibleUserId && Boolean(parent.responsibleUserId),
            weekCounts: periods.map((period) => {
              const selected = readCount(parent.categoryLevel1, child.categoryLevel2, period.key);
              return {
                weekStart: period.key,
                count: selected.daysWithData,
                daysWithData: selected.daysWithData,
                recordCount: selected.recordCount,
              };
            }),
          }));

        const weekProgress = periods.map((period) => {
          const parentCount = readCount(parent.categoryLevel1, NO_SECOND_LEVEL_CATEGORY, period.key);
          if (children.length) {
            const childCounts = children.map((child) =>
              child.weekCounts.find((week) => week.weekStart === period.key)!,
            );
            const imported = childCounts.filter((week) => week.daysWithData === 7).length;
            const partial = childCounts.filter((week) => week.daysWithData > 0 && week.daysWithData < 7).length;
            const recordCount = childCounts.reduce((sum, week) => sum + week.recordCount, 0);
            return {
              weekStart: period.key,
              imported,
              total: children.length,
              partial,
              recordCount,
            };
          }

          return {
            weekStart: period.key,
            imported: parentCount.daysWithData === 7 ? 1 : 0,
            total: 1,
            partial: parentCount.daysWithData > 0 && parentCount.daysWithData < 7 ? 1 : 0,
            daysWithData: parentCount.daysWithData,
            totalDays: 7,
            recordCount: parentCount.recordCount,
          };
        });

        return {
          id: parent.id,
          categoryLevel1: parent.categoryLevel1,
          responsibleUserId: parent.responsibleUserId,
          responsibleUserName: parent.responsibleUser?.name ?? null,
          ownerUserId: parent.responsibleUserId,
          ownerName: parent.responsibleUser?.name ?? null,
          weekProgress,
          children,
        };
      });

    return {
      periods: periods.map((period) => ({
        weekStart: period.key,
        weekEnd: dateKey(period.weekEnd),
      })),
      categories,
      employees,
    };
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
    responsibleUserId?: string | null;
  }) {
    const categoryLevel1 = input.categoryLevel1.trim();
    const categoryLevel2 = input.categoryLevel2?.trim() || null;
    if (!categoryLevel1) throw new BadRequestException("请输入一级类目名称。");
    if (categoryLevel1.length > 255 || (categoryLevel2 && categoryLevel2.length > 255)) {
      throw new BadRequestException("类目名称不能超过255个字符。");
    }
    if (categoryLevel2 && `${categoryLevel1} / ${categoryLevel2}`.length > 255) {
      throw new BadRequestException("一级和二级类目组合后的名称不能超过255个字符。");
    }
    await this.assertActiveEmployee(input.responsibleUserId);

    if (!categoryLevel2) {
      const existing = await this.prisma.category.findFirst({
        where: { categoryLevel1, categoryLevel2: null },
        select: { id: true },
      });
      if (existing) throw new BadRequestException("这个一级类目已经存在。");
      return this.prisma.category.create({
        data: {
          categoryName: categoryLevel1,
          categoryLevel1,
          categoryLevel2: null,
          responsibleUserId: input.responsibleUserId ?? null,
        },
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.category.findFirst({
        where: { categoryLevel1, categoryLevel2 },
        select: { id: true },
      });
      if (existing) throw new BadRequestException("这个二级类目已经存在。");

      const parent = await tx.category.findFirst({
        where: { categoryLevel1, categoryLevel2: null },
        select: { id: true },
      });
      if (!parent) {
        await tx.category.create({
          data: { categoryName: categoryLevel1, categoryLevel1, categoryLevel2: null },
        });
      }

      return tx.category.create({
        data: {
          categoryName: `${categoryLevel1} / ${categoryLevel2}`,
          categoryLevel1,
          categoryLevel2,
          responsibleUserId: input.responsibleUserId ?? null,
        },
      });
    });
  }

  async updateResponsible(id: string, responsibleUserId: string | null) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException("类目不存在。");
    await this.assertActiveEmployee(responsibleUserId);
    await this.prisma.category.updateMany({
      where: {
        categoryLevel1: category.categoryLevel1,
        categoryLevel2: category.categoryLevel2,
      },
      data: { responsibleUserId },
    });
    return { success: true };
  }
}
