import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { NO_SECOND_LEVEL_CATEGORY, NO_THIRD_LEVEL_CATEGORY } from "./metric-parser";

export interface CategoryRegistrySource {
  categoryName: string;
  categoryLevel1: string;
  categoryLevel2: string;
  categoryLevel3?: string;
}

function categoryRegistryName(...levels: string[]) {
  const fullName = levels.join(" / ");
  if (Array.from(fullName).length <= 255) return fullName;
  const digest = createHash("md5").update(fullName).digest("hex").slice(0, 8);
  const marker = `~${digest}`;
  return `${Array.from(fullName).slice(0, 255 - Array.from(marker).length).join("")}${marker}`;
}

/** Build level-1, level-2 and level-3 nodes for market or search imports. */
export function buildCategoryRegistryRows(
  rows: Iterable<CategoryRegistrySource>,
): Prisma.CategoryCreateManyInput[] {
  const categoryByKey = new Map<string, Prisma.CategoryCreateManyInput>();
  for (const row of rows) {
    const categoryLevel3 = row.categoryLevel3 ?? NO_THIRD_LEVEL_CATEGORY;
    const parentKey = `parent\u0000${row.categoryLevel1}`;
    if (!categoryByKey.has(parentKey)) {
      categoryByKey.set(parentKey, {
        categoryName: row.categoryLevel1,
        categoryLevel1: row.categoryLevel1,
        categoryLevel2: null,
        categoryLevel3: null,
      });
    }

    const childName = row.categoryLevel2 !== NO_SECOND_LEVEL_CATEGORY && categoryLevel3 === NO_THIRD_LEVEL_CATEGORY
      ? row.categoryName
      : categoryRegistryName(row.categoryLevel1, row.categoryLevel2);
    const childKey = `child\u0000${row.categoryLevel1}\u0000${row.categoryLevel2}`;
    if (categoryLevel3 === NO_THIRD_LEVEL_CATEGORY || !categoryByKey.has(childKey)) {
      categoryByKey.set(childKey, {
        categoryName: childName,
        categoryLevel1: row.categoryLevel1,
        categoryLevel2: row.categoryLevel2,
        categoryLevel3: null,
      });
    }

    if (row.categoryLevel2 !== NO_SECOND_LEVEL_CATEGORY) {
      const thirdKey = `third\u0000${row.categoryLevel1}\u0000${row.categoryLevel2}\u0000${categoryLevel3}`;
      categoryByKey.set(thirdKey, {
        categoryName: categoryLevel3 === NO_THIRD_LEVEL_CATEGORY
          ? categoryRegistryName(row.categoryLevel1, row.categoryLevel2, categoryLevel3)
          : row.categoryName,
        categoryLevel1: row.categoryLevel1,
        categoryLevel2: row.categoryLevel2,
        categoryLevel3,
      });
    }
  }
  return [...categoryByKey.values()];
}
