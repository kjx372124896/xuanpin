export interface AiMetricsRow {
  productId: string;
  previousSales: string;
  sales: string;
  clickRate: string;
  conversionRate: string;
  addToCartRate: string;
  addToCartCost: string;
  roi: string;
  unitPrice: string;
  spend: string;
  cpc: string;
}

export interface AiMetricsParseResult {
  rows: AiMetricsRow[];
  missingProductIds: string[];
  errors: string[];
  tableCount: number;
}

const FIELD_KEYS = [
  "productId", "previousSales", "sales", "clickRate", "conversionRate", "addToCartRate",
  "addToCartCost", "roi", "unitPrice", "spend", "cpc",
] as const;

const HEADER_TO_FIELD = new Map<string, typeof FIELD_KEYS[number]>([
  ["品id", "productId"], ["商品id", "productId"], ["宝贝id", "productId"], ["itemid", "productId"],
  ["上期销售额", "previousSales"], ["上期成交金额", "previousSales"],
  ["销售额", "sales"], ["成交金额", "sales"], ["总成交金额", "sales"],
  ["点击率", "clickRate"], ["转化率", "conversionRate"], ["支付转化率", "conversionRate"],
  ["加购率", "addToCartRate"], ["加购成本", "addToCartCost"],
  ["投产比", "roi"], ["投产比roi", "roi"], ["roi", "roi"],
  ["件单价", "unitPrice"], ["花费", "spend"], ["消耗", "spend"], ["cpc", "cpc"],
]);

function cleanCell(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\*\*(.*)\*\*$/s, "$1")
    .replace(/^__(.*)__$/s, "$1")
    .replace(/^`(.*)`$/s, "$1")
    .replace(/\\\|/g, "|")
    .trim();
}

function normalizeHeader(value: string): string {
  return cleanCell(value).normalize("NFKC").toLowerCase().replace(/[\s_*`（）()]/g, "");
}

function splitPipeRow(line: string): string[] {
  const raw = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return raw.split(/(?<!\\)\|/).map((cell) => cleanCell(cell));
}

function isSeparator(cells: string[]): boolean {
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function extractTables(markdown: string): Array<{ headers: string[]; rows: string[][]; rowWidthErrors: number[] }> {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const tables: Array<{ headers: string[]; rows: string[][]; rowWidthErrors: number[] }> = [];
  for (let index = 0; index < lines.length - 1; index++) {
    if (!lines[index].includes("|") || !lines[index + 1].includes("|")) continue;
    const headers = splitPipeRow(lines[index]);
    if (!isSeparator(splitPipeRow(lines[index + 1]))) continue;
    const rows: string[][] = [];
    const rowWidthErrors: number[] = [];
    let cursor = index + 2;
    for (; cursor < lines.length; cursor++) {
      const line = lines[cursor].trim();
      if (!line || !line.includes("|")) break;
      const cells = splitPipeRow(line);
      if (isSeparator(cells)) break;
      if (cells.length !== headers.length) rowWidthErrors.push(rows.length + 1);
      rows.push(cells);
    }
    tables.push({ headers, rows, rowWidthErrors });
    index = cursor - 1;
  }
  return tables;
}

function parseProductId(value: string): string | null {
  const raw = cleanCell(value).replace(/,/g, "");
  const match = raw.match(/(?:^|\D)(\d{6,20})(?:\.0)?(?:$|\D)/);
  return match?.[1] ?? null;
}

export function parseAiMetricsMarkdown(markdown: string, expectedProductIds: string[] = []): AiMetricsParseResult {
  const tables = extractTables(markdown);
  const detailTables = tables.filter((table) => table.headers.some((header) => HEADER_TO_FIELD.get(normalizeHeader(header)) === "productId"));
  const errors: string[] = [];
  const rows: AiMetricsRow[] = [];
  const seenIds = new Set<string>();
  if (!detailTables.length) errors.push("未找到包含“品ID”或“商品ID”的Markdown商品表格。");

  for (const [tableIndex, table] of detailTables.entries()) {
    const mappedHeaders = table.headers.map((header) => HEADER_TO_FIELD.get(normalizeHeader(header)) ?? null);
    const unknownHeaders = table.headers.filter((_header, index) => mappedHeaders[index] === null);
    const duplicateFields = FIELD_KEYS.filter((key) => mappedHeaders.filter((mapped) => mapped === key).length > 1);
    const missingFields = FIELD_KEYS.filter((key) => !mappedHeaders.includes(key));
    if (unknownHeaders.length) errors.push(`第${tableIndex + 1}张表存在未知字段：${[...new Set(unknownHeaders)].join("、")}`);
    if (duplicateFields.length) errors.push(`第${tableIndex + 1}张表存在重复字段：${duplicateFields.join("、")}`);
    if (missingFields.length) errors.push(`第${tableIndex + 1}张表缺少字段：${missingFields.join("、")}`);
    if (table.headers.length !== FIELD_KEYS.length) errors.push(`第${tableIndex + 1}张表应为${FIELD_KEYS.length}列，实际为${table.headers.length}列。`);
    if (table.rowWidthErrors.length) errors.push(`第${tableIndex + 1}张表的数据行列数异常：第${table.rowWidthErrors.join("、")}行。`);
    if (unknownHeaders.length || duplicateFields.length || missingFields.length || table.rowWidthErrors.length) continue;

    const indexByField = new Map<typeof FIELD_KEYS[number], number>();
    mappedHeaders.forEach((field, index) => { if (field) indexByField.set(field, index); });
    for (const [rowIndex, cells] of table.rows.entries()) {
      const id = parseProductId(cells[indexByField.get("productId")!] ?? "");
      if (!id) {
        errors.push(`第${tableIndex + 1}张表第${rowIndex + 1}行的商品ID无效。`);
        continue;
      }
      if (seenIds.has(id)) {
        errors.push(`商品ID ${id} 在AI回复中重复出现。`);
        continue;
      }
      seenIds.add(id);
      const get = (key: Exclude<typeof FIELD_KEYS[number], "productId">) => cells[indexByField.get(key)!] ?? "";
      rows.push({
        productId: id,
        previousSales: get("previousSales"),
        sales: get("sales"),
        clickRate: get("clickRate"),
        conversionRate: get("conversionRate"),
        addToCartRate: get("addToCartRate"),
        addToCartCost: get("addToCartCost"),
        roi: get("roi"),
        unitPrice: get("unitPrice"),
        spend: get("spend"),
        cpc: get("cpc"),
      });
    }
  }

  const expected = [...new Set(expectedProductIds.map((id) => String(id).trim()).filter(Boolean))];
  const expectedSet = new Set(expected);
  const unmatched = rows.map((row) => row.productId).filter((id) => expectedSet.size > 0 && !expectedSet.has(id));
  if (unmatched.length) errors.push(`AI回复包含不属于本批次的商品ID：${[...new Set(unmatched)].join("、")}`);
  const missingProductIds = expected.filter((id) => !seenIds.has(id));
  return { rows: errors.length ? [] : rows, missingProductIds, errors, tableCount: detailTables.length };
}
