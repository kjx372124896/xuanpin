import test from "node:test";
import assert from "node:assert/strict";
import { CategoriesService } from "./categories.service";

test("类目登记表返回12周进度，并让二级类目继承一级负责人", async () => {
  const prisma = {
    category: {
      findMany: async () => [
        {
          id: "parent-1",
          categoryName: "家居收纳",
          categoryLevel1: "家居收纳",
          categoryLevel2: null,
          responsibleUserId: "employee-1",
          responsibleUser: { id: "employee-1", name: "张三" },
        },
        {
          id: "child-1",
          categoryName: "家居收纳 / 厨房置物架",
          categoryLevel1: "家居收纳",
          categoryLevel2: "厨房置物架",
          responsibleUserId: null,
          responsibleUser: null,
        },
        {
          id: "child-2",
          categoryName: "家居收纳 / 调料收纳",
          categoryLevel1: "家居收纳",
          categoryLevel2: "调料收纳",
          responsibleUserId: "employee-2",
          responsibleUser: { id: "employee-2", name: "李四" },
        },
      ],
    },
    user: {
      findMany: async () => [{ id: "employee-1", name: "张三", department: "选品一组" }],
    },
    productHistory: {
      groupBy: async (args: { where: { weekStart: { in: Date[] } } }) => {
        const weeks = args.where.weekStart.in;
        return [
          {
            categoryLevel1: "家居收纳",
            categoryLevel2: "厨房置物架",
            weekStart: weeks[11],
            _count: { _all: 8 },
          },
          {
            categoryLevel1: "家居收纳",
            categoryLevel2: "调料收纳",
            weekStart: weeks[10],
            _count: { _all: 4 },
          },
        ];
      },
    },
  };

  const result = await new CategoriesService(prisma as never).overview();
  assert.equal(result.periods.length, 12);

  const parent = result.categories.find((item) => item.categoryLevel1 === "家居收纳");
  assert.ok(parent);
  assert.equal(parent.children.length, 2);

  const inheritedChild = parent.children.find((item) => item.categoryLevel2 === "厨房置物架");
  assert.ok(inheritedChild);
  assert.equal(inheritedChild.ownerUserId, "employee-1");
  assert.equal(inheritedChild.ownerName, "张三");
  assert.equal(inheritedChild.inherited, true);
  assert.equal(inheritedChild.weekCounts[11].count, 8);

  const overriddenChild = parent.children.find((item) => item.categoryLevel2 === "调料收纳");
  assert.ok(overriddenChild);
  assert.equal(overriddenChild.ownerUserId, "employee-2");
  assert.equal(overriddenChild.inherited, false);

  assert.deepEqual(parent.weekProgress[11], {
    weekStart: result.periods[11].weekStart,
    imported: 1,
    total: 2,
    recordCount: 8,
  });
});
