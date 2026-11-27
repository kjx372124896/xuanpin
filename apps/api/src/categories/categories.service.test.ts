import test from "node:test";
import assert from "node:assert/strict";
import { CategoriesService } from "./categories.service";
import { CategoriesController } from "./categories.controller";

const NO_SECOND = "无二级类目";
const NO_THIRD = "无三级类目";

test("搜索词类目概览只接受搜索词、核心词，并将选择传入统计服务", async () => {
  const selectedTypes: Array<string | undefined> = [];
  const controller = new CategoriesController({
    searchOverview: async (searchTermType?: string) => { selectedTypes.push(searchTermType); return {}; },
  } as never);
  await controller.searchOverview("搜索词");
  await controller.searchOverview("核心词");
  await controller.searchOverview();
  assert.deepEqual(selectedTypes, ["搜索词", "核心词", undefined]);
  assert.throws(() => controller.searchOverview("无效类型"), /搜索词类型无效/);
});

test("类目登记表返回12周进度，并让三级类目逐级继承负责人", async () => {
  const groupedBoardTypes: string[] = [];
  const prisma = {
    category: {
      findMany: async () => [
        { id: "parent-1", categoryName: "家居收纳", categoryLevel1: "家居收纳", categoryLevel2: null, categoryLevel3: null,
          responsibleUserId: "employee-1", responsibleUser: { id: "employee-1", name: "张三" } },
        { id: "child-1", categoryName: "家居收纳 / 厨房置物架", categoryLevel1: "家居收纳", categoryLevel2: "厨房置物架", categoryLevel3: null,
          responsibleUserId: null, responsibleUser: null },
        { id: "child-2", categoryName: "家居收纳 / 调料收纳", categoryLevel1: "家居收纳", categoryLevel2: "调料收纳", categoryLevel3: null,
          responsibleUserId: "employee-2", responsibleUser: { id: "employee-2", name: "李四" } },
        { id: "child-no-level2", categoryName: "家居收纳 / 无二级类目", categoryLevel1: "家居收纳", categoryLevel2: NO_SECOND, categoryLevel3: null,
          responsibleUserId: null, responsibleUser: null },
        { id: "third-1", categoryName: "家居收纳 / 厨房置物架 / 无三级类目", categoryLevel1: "家居收纳", categoryLevel2: "厨房置物架", categoryLevel3: NO_THIRD,
          responsibleUserId: null, responsibleUser: null },
      ],
    },
    user: { findMany: async () => [{ id: "employee-1", name: "张三", department: "选品一组" }] },
    productHistory: {
      groupBy: async (args: { where: { boardType: string; weekStart: { in: Date[] } } }) => {
        groupedBoardTypes.push(args.where.boardType);
        const weeks = args.where.weekStart.in;
        return [
          { categoryLevel1: "家居收纳", categoryLevel2: "厨房置物架", categoryLevel3: NO_THIRD, weekStart: weeks[11], _count: { _all: 8 } },
          { categoryLevel1: "家居收纳", categoryLevel2: "调料收纳", categoryLevel3: NO_THIRD, weekStart: weeks[10], _count: { _all: 4 } },
          { categoryLevel1: "家居收纳", categoryLevel2: NO_SECOND, categoryLevel3: NO_THIRD, weekStart: weeks[11], _count: { _all: 2 } },
        ];
      },
    },
  };

  const result = await new CategoriesService(prisma as never).overview("TRANSACTION_GROWTH");
  assert.deepEqual(groupedBoardTypes, ["TRANSACTION_GROWTH"]);
  assert.equal(result.periods.length, 12);

  const parent = result.categories.find((item) => item.categoryLevel1 === "家居收纳");
  assert.ok(parent);
  assert.equal(parent.children.length, 3);

  const inheritedChild = parent.children.find((item) => item.categoryLevel2 === "厨房置物架");
  assert.ok(inheritedChild);
  assert.equal(inheritedChild.ownerUserId, "employee-1");
  assert.equal(inheritedChild.ownerName, "张三");
  assert.equal(inheritedChild.inherited, true);
  assert.equal(inheritedChild.grandchildren[0].ownerUserId, "employee-1");
  assert.equal(inheritedChild.grandchildren[0].inherited, true);
  assert.equal(inheritedChild.grandchildren[0].weekCounts[11].count, 8);

  const overriddenChild = parent.children.find((item) => item.categoryLevel2 === "调料收纳");
  assert.ok(overriddenChild);
  assert.equal(overriddenChild.ownerUserId, "employee-2");
  assert.equal(overriddenChild.inherited, false);

  const noLevel2Child = parent.children.find((item) => item.categoryLevel2 === NO_SECOND);
  assert.ok(noLevel2Child);
  assert.equal(noLevel2Child.ownerUserId, "employee-1");
  assert.equal(noLevel2Child.inherited, true);
  assert.equal(noLevel2Child.weekCounts[11].count, 2);
  assert.equal(parent.weekCounts[11].count, 2);
  assert.equal(parent.weekCounts[10].count, 0);

  assert.deepEqual(parent.weekProgress[11], {
    weekStart: result.periods[11].weekStart,
    imported: 2,
    total: 3,
    recordCount: 10,
  });
});

test("搜索词榜单按三级分支独立统计7天覆盖，一级类目数据只计入无二级类目", async () => {
  const prisma = {
    category: {
      findMany: async () => [
        { id: "parent-1", categoryName: "家居收纳", categoryLevel1: "家居收纳", categoryLevel2: null, categoryLevel3: null,
          responsibleUserId: "employee-1", responsibleUser: { id: "employee-1", name: "张三" } },
        { id: "child-1", categoryName: "家居收纳 / 厨房置物架", categoryLevel1: "家居收纳", categoryLevel2: "厨房置物架", categoryLevel3: null,
          responsibleUserId: null, responsibleUser: null },
        { id: "child-unclassified", categoryName: "家居收纳 / 无二级类目", categoryLevel1: "家居收纳", categoryLevel2: NO_SECOND, categoryLevel3: null,
          responsibleUserId: null, responsibleUser: null },
        { id: "child-2", categoryName: "家居收纳 / 调料收纳", categoryLevel1: "家居收纳", categoryLevel2: "调料收纳", categoryLevel3: null,
          responsibleUserId: "employee-2", responsibleUser: { id: "employee-2", name: "李四" } },
        { id: "third-kitchen", categoryName: "家居收纳 / 厨房置物架 / 无三级类目", categoryLevel1: "家居收纳", categoryLevel2: "厨房置物架", categoryLevel3: NO_THIRD,
          responsibleUserId: null, responsibleUser: null },
      ],
    },
    user: { findMany: async () => [{ id: "employee-1", name: "张三", department: "选品一组" }] },
    searchTermHistory: {
      groupBy: async (args: { where: { searchDate: { gte: Date; lte: Date } } }) => {
        const latestWeekStart = new Date(args.where.searchDate.lte.getTime() - 6 * 24 * 60 * 60 * 1000);
        const rows: Array<{ categoryLevel1: string; categoryLevel2: string; categoryLevel3: string; searchDate: Date; _count: { _all: number } }> = [];
        for (let day = 0; day < 7; day += 1) {
          const searchDate = new Date(latestWeekStart.getTime() + day * 24 * 60 * 60 * 1000);
          rows.push({ categoryLevel1: "家居收纳", categoryLevel2: NO_SECOND, categoryLevel3: NO_THIRD, searchDate, _count: { _all: 5 } });
          if (day < 2) {
            rows.push({ categoryLevel1: "家居收纳", categoryLevel2: "厨房置物架", categoryLevel3: NO_THIRD, searchDate, _count: { _all: 3 } });
          }
        }
        return rows;
      },
    },
  };

  const result = await new CategoriesService(prisma as never).searchOverview();
  assert.equal(result.periods.length, 12);

  const parent = result.categories.find((item) => item.categoryLevel1 === "家居收纳");
  assert.ok(parent);
  const directChild = parent.children.find((item) => item.categoryLevel2 === "厨房置物架");
  const inheritedChild = parent.children.find((item) => item.categoryLevel2 === "调料收纳");
  assert.ok(directChild);
  assert.ok(inheritedChild);

  assert.equal(directChild.grandchildren[0].weekCounts[11].daysWithData, 2);
  assert.equal(inheritedChild.weekCounts[11].daysWithData, 0);
  assert.equal(inheritedChild.weekCounts[11].recordCount, 0);
  const unclassified = parent.children.find((item) => item.categoryLevel2 === NO_SECOND)!;
  assert.equal(unclassified.weekCounts[11].daysWithData, 7);
  assert.equal(unclassified.weekCounts[11].recordCount, 35);
  assert.equal(unclassified.ownerUserId, "employee-1");
  assert.equal(parent.weekCounts[11].daysWithData, 7);
  assert.equal(parent.weekCounts[11].recordCount, 35);
  assert.deepEqual(parent.weekProgress[11], {
    weekStart: result.periods[11].weekStart,
    imported: 1,
    total: 3,
    partial: 1,
    recordCount: 41,
  });
});
