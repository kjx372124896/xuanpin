export type CategoryLevel = 1 | 2 | 3;

export interface ImportWeekCount {
  weekStart: string;
  count: number;
  daysWithData?: number;
}

interface ImportGrandchild {
  categoryLevel3: string;
  weekCounts: ImportWeekCount[];
}

interface ImportChild {
  categoryLevel2: string;
  weekCounts: ImportWeekCount[];
  grandchildren: ImportGrandchild[];
}

type ImportBranches = Partial<Record<CategoryLevel, ImportWeekCount[][]>>;

export interface ImportProgress {
  complete: boolean;
  completedWeeks: number;
  totalWeeks: number;
  total: number;
  imported: number;
}

export type LevelImportProgress = Record<CategoryLevel, ImportProgress | null>;

const NO_SECOND = "无二级类目";
const NO_THIRD = "无三级类目";
export const CATEGORY_LEVELS = [1, 2, 3] as const;

export function parentImportBranches(parent: { weekCounts: ImportWeekCount[]; children: ImportChild[] }): ImportBranches {
  const children = parent.children.filter((child) => child.categoryLevel2 !== NO_SECOND);
  return {
    1: [parent.weekCounts],
    2: children.map((child) => child.weekCounts),
    3: children.flatMap((child) => child.grandchildren
      .filter((grandchild) => grandchild.categoryLevel3 !== NO_THIRD)
      .map((grandchild) => grandchild.weekCounts)),
  };
}

export function childImportBranches(child: ImportChild): ImportBranches {
  if (child.categoryLevel2 === NO_SECOND) return { 1: [child.weekCounts] };
  return {
    2: [child.weekCounts],
    3: child.grandchildren.filter((grandchild) => grandchild.categoryLevel3 !== NO_THIRD)
      .map((grandchild) => grandchild.weekCounts),
  };
}

export function grandchildImportBranches(grandchild: ImportGrandchild & { categoryLevel2: string }): ImportBranches {
  const level = grandchild.categoryLevel2 === NO_SECOND ? 1 : grandchild.categoryLevel3 === NO_THIRD ? 2 : 3;
  return { [level]: [grandchild.weekCounts] };
}

export function getLevelImportProgress(
  branches: ImportBranches,
  periods: { weekStart: string }[],
  isSearch: boolean,
): LevelImportProgress {
  const result: LevelImportProgress = { 1: null, 2: null, 3: null };
  const periodKeys = new Set(periods.map((period) => period.weekStart));
  for (const level of CATEGORY_LEVELS) {
    const levelBranches = branches[level] ?? [];
    if (!levelBranches.length) continue;
    const completedByBranch = levelBranches.map((weeks) => new Set(weeks
      .filter((week) => periodKeys.has(week.weekStart) && (isSearch ? (week.daysWithData ?? week.count) === 7 : week.count > 0))
      .map((week) => week.weekStart)));
    const completedWeeks = [...periodKeys].filter((key) => completedByBranch.every((weeks) => weeks.has(key))).length;
    const imported = completedByBranch.filter((weeks) => periodKeys.size > 0 && weeks.size === periodKeys.size).length;
    result[level] = {
      complete: periodKeys.size > 0 && completedWeeks === periodKeys.size,
      completedWeeks,
      totalWeeks: periodKeys.size,
      total: levelBranches.length,
      imported,
    };
  }
  return result;
}

export function hasIncompleteImport(progress: LevelImportProgress): boolean {
  return CATEGORY_LEVELS.some((level) => progress[level] !== null && !progress[level]!.complete);
}
