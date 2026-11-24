import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { NO_SECOND_LEVEL_CATEGORY } from "./metric-parser";

export interface CategoryRegistrySource {
  categoryName: string;
  categoryLevel1: string;
  categoryLevel2: string;
}

function categoryRegistryName(level1: string, level2: string) {
  const suffix = ` / ${level2}`;
  const fullName = `${level1}${suffix}`;
  if (Array.from(fullName).length <= 255) return fullName;
  const digest = createHash("md5").update(level1).digest("hex").slice(0, 8);
  const marker = `~${digest}${suffix}`;
  return `${Array.from(level1).slice(0, 255 - Array.from(marker).length).join("")}${marker}`;
}

/** Build the shared parent/child registry rows for either market or search imports. */
export function buildCategoryRegistryRows(
  rows: Iterable<CategoryRegistrySource>,
): Prisma.CategoryCreateManyInput[] {
  const categoryByKey = new Map<string, Prisma.CategoryCreateManyInput>();
  for (const row of rows) {
    const parentKey = `parent\u0000${row.categoryLevel1}`;
    if (!categoryByKey.has(parentKey)) {
      categoryByKey.set(parentKey, {
        categoryName: row.categoryLevel1,
        categoryLevel1: row.categoryLevel1,
        categoryLevel2: null,
      });
    }

    const childKey = `child\u0000${row.categoryLevel1}\u0000${row.categoryLevel2}`;
    categoryByKey.set(childKey, {
      categoryName: row.categoryLevel2 === NO_SECOND_LEVEL_CATEGORY
        ? categoryRegistryName(row.categoryLevel1, row.categoryLevel2)
        : row.categoryName,
      categoryLevel1: row.categoryLevel1,
      categoryLevel2: row.categoryLevel2,
    });
  }
  return [...categoryByKey.values()];
}
