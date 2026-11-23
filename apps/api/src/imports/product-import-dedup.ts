import type { ParsedImportRow } from "./import-parser";

type ProductImportBusinessFields = Pick<
  ParsedImportRow,
  "boardType" | "productId" | "weekStart" | "categoryName" | "exportTime"
>;

export interface ProductImportCandidate<T extends ProductImportBusinessFields = ParsedImportRow> {
  row: T;
  fileId: string;
  fileName: string;
}

export function productImportBusinessKey(row: ProductImportBusinessFields) {
  return `${row.boardType}|${row.productId}|${row.weekStart.toISOString().slice(0, 10)}|${row.categoryName}`;
}

/**
 * Deduplicate rows before persistence. For an identical business key, the row
 * with the latest exportTime wins. Equal or missing export times keep the
 * first encountered row, making the result deterministic by upload order.
 */
export function deduplicateProductImportRows<T extends ProductImportBusinessFields>(
  candidates: ProductImportCandidate<T>[],
) {
  const winners = new Map<string, ProductImportCandidate<T>>();
  const duplicateCountsByFile = new Map<string, number>();
  let duplicateRows = 0;

  const countDuplicate = (fileId: string) => {
    duplicateRows += 1;
    duplicateCountsByFile.set(fileId, (duplicateCountsByFile.get(fileId) ?? 0) + 1);
  };

  for (const candidate of candidates) {
    const key = productImportBusinessKey(candidate.row);
    const current = winners.get(key);
    if (!current) {
      winners.set(key, candidate);
      continue;
    }

    const candidateTime = candidate.row.exportTime?.getTime() ?? Number.NEGATIVE_INFINITY;
    const currentTime = current.row.exportTime?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (candidateTime > currentTime) {
      countDuplicate(current.fileId);
      winners.set(key, candidate);
    } else {
      countDuplicate(candidate.fileId);
    }
  }

  return {
    rows: [...winners.values()],
    duplicateRows,
    duplicateCountsByFile,
  };
}
