import test from "node:test";
import assert from "node:assert/strict";
import { buildCategoryRegistryRows } from "./category-registry";

test("公共类目登记同时生成一级父级和二级子级，并合并重复项", () => {
  const rows = buildCategoryRegistryRows([
    {
      categoryName: "收纳整理 / 家庭收纳用具",
      categoryLevel1: "收纳整理",
      categoryLevel2: "家庭收纳用具",
    },
    {
      categoryName: "收纳整理 / 家庭收纳用具",
      categoryLevel1: "收纳整理",
      categoryLevel2: "家庭收纳用具",
    },
    {
      categoryName: "餐饮具",
      categoryLevel1: "餐饮具",
      categoryLevel2: "无二级类目",
    },
  ]);

  assert.equal(rows.length, 4);
  assert.deepEqual(rows.find((row) => row.categoryName === "收纳整理"), {
    categoryName: "收纳整理",
    categoryLevel1: "收纳整理",
    categoryLevel2: null,
  });
  assert.deepEqual(rows.find((row) => row.categoryName === "收纳整理 / 家庭收纳用具"), {
    categoryName: "收纳整理 / 家庭收纳用具",
    categoryLevel1: "收纳整理",
    categoryLevel2: "家庭收纳用具",
  });
  assert.deepEqual(rows.find((row) => row.categoryName === "餐饮具 / 无二级类目"), {
    categoryName: "餐饮具 / 无二级类目",
    categoryLevel1: "餐饮具",
    categoryLevel2: "无二级类目",
  });
  assert.deepEqual(rows.find((row) => row.categoryName === "餐饮具"), {
    categoryName: "餐饮具",
    categoryLevel1: "餐饮具",
    categoryLevel2: null,
  });
});
