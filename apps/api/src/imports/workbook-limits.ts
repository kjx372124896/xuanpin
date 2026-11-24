import type ExcelJS from "exceljs";
import { unzipSync, type Unzipped } from "fflate";

export const WORKBOOK_LIMITS = {
  compressedBytes: 50 * 1024 * 1024,
  expandedBytes: 128 * 1024 * 1024,
  entryBytes: 64 * 1024 * 1024,
  entries: 4096,
  worksheets: 32,
  rows: 100_000,
  columns: 128,
};
export const MAX_BATCH_ROWS = 250_000;

export function readBoundedArchive(buffer: Uint8Array, limits = WORKBOOK_LIMITS): Unzipped {
  if (buffer.length > limits.compressedBytes) throw new Error("Excel 文件不能超过50 MB。");
  let entries = 0;
  let expandedBytes = 0;
  // First inspect every central-directory entry without allocating its output.
  // A later oversized entry must not cause earlier entries to be expanded first.
  unzipSync(buffer, { filter: (entry) => {
    entries += 1;
    expandedBytes += entry.originalSize;
    if (entries > limits.entries) throw new Error("Excel 压缩条目过多，请拆分工作簿。");
    if (!Number.isSafeInteger(entry.originalSize) || entry.originalSize < 0 || entry.originalSize > limits.entryBytes) {
      throw new Error("Excel 单个压缩条目展开后过大，请拆分工作簿。");
    }
    if (expandedBytes > limits.expandedBytes) throw new Error("Excel 解压总量超过128 MB，请拆分工作簿。");
    return false;
  } });
  return unzipSync(buffer);
}

export function assertWorkbookLimits(workbook: ExcelJS.Workbook) {
  if (workbook.worksheets.length > WORKBOOK_LIMITS.worksheets) throw new Error("Excel 工作表过多，请拆分工作簿。");
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > WORKBOOK_LIMITS.rows || sheet.columnCount > WORKBOOK_LIMITS.columns) {
      throw new Error("Excel 工作表超过10万行或128列，请拆分工作簿。");
    }
  }
}
