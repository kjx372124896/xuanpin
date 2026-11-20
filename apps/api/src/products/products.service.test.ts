import test from "node:test";
import assert from "node:assert/strict";
import { ProductsService } from "./products.service";

test("选择一级类目后仍返回全部一级类目选项，只收窄二级类目选项", async () => {
  const findManyCalls: Array<{ where?: Record<string, unknown> }> = [];
  const prisma = {
    category: {
      findMany: async (args: { where?: Record<string, unknown> }) => {
        findManyCalls.push(args);
        return [
          { categoryLevel1: "厨房用品", categoryLevel2: "厨房置物架" },
          { categoryLevel1: "厨房用品", categoryLevel2: "调料收纳" },
          { categoryLevel1: "宠物用品", categoryLevel2: "宠物垫" },
          { categoryLevel1: "宠物用品", categoryLevel2: "宠物围栏" },
        ];
      },
    },
  };

  const service = new ProductsService(prisma as never);
  const result = await service.categories(["厨房用品"]);

  assert.deepEqual(result.level1, ["厨房用品", "宠物用品"]);
  assert.deepEqual(result.level2, ["厨房置物架", "调料收纳"]);
  assert.deepEqual(findManyCalls[0].where, { enabled: true });
});

test("未选择一级类目时保留全部一级选项且不展示二级选项", async () => {
  const prisma = {
    category: {
      findMany: async () => [
        { categoryLevel1: "厨房用品", categoryLevel2: "厨房置物架" },
        { categoryLevel1: "宠物用品", categoryLevel2: "宠物垫" },
      ],
    },
  };

  const result = await new ProductsService(prisma as never).categories();

  assert.deepEqual(result.level1, ["厨房用品", "宠物用品"]);
  assert.deepEqual(result.level2, []);
});
