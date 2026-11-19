function dateKey(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

/**
 * 以选中的上榜周期为终点，向前统计每隔7天都存在上榜记录的连续周数。
 * 选中周期本身没有记录时返回0，不能用更早的历史记录补足。
 */
export function consecutiveWeekCountEndingAt(anchorDate: string | Date, weekStarts: Array<string | Date>): number {
  const weeks = new Set(weekStarts.map(dateKey));
  let currentDate = dateKey(anchorDate);
  let count = 0;

  while (weeks.has(currentDate)) {
    count += 1;
    const previousWeek = new Date(`${currentDate}T00:00:00.000Z`);
    previousWeek.setUTCDate(previousWeek.getUTCDate() - 7);
    currentDate = previousWeek.toISOString().slice(0, 10);
  }

  return count;
}

/** 连续周数范围按包含边界的方式判断；没有选中周期时不接受0周。 */
export function isConsecutiveWeekCountInRange(count: number, min?: number, max?: number): boolean {
  return count > 0
    && (min === undefined || count >= min)
    && (max === undefined || count <= max);
}
