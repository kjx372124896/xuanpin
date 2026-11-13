export type UserRole = "SUPER_ADMIN" | "ADMIN" | "EMPLOYEE";
export type EmploymentStatus = "ACTIVE" | "RESIGNED" | "SUSPENDED";
export type AccountStatus = "ACTIVE" | "DISABLED";

export interface SafeUser {
  id: string;
  username: string;
  name: string;
  employeeNo: string | null;
  department: string | null;
  role: UserRole;
  employmentStatus: EmploymentStatus;
  accountStatus: AccountStatus;
  canImport: boolean;
}

export interface MetricRange {
  raw: string | null;
  min: number | null;
  max: number | null;
  median: number | null;
}

export interface ProductListItem {
  productId: string;
  productName: string;
  productUrl: string | null;
  shopName: string | null;
  shopType: string | null;
  imageUrl: string | null;
  latestCategory: string | null;
  latestCategoryLevel1: string | null;
  latestCategoryLevel2: string | null;
  latestWeekStart: string | null;
  latestWeekEnd: string | null;
  latestRank: number | null;
  historyWeekCount: number;
  consecutiveWeekCount: number;
  isFavorited: boolean;
  firstWeekStart: string | null;
  visitor: MetricRange;
  buyer: MetricRange;
  cart: MetricRange;
  buyerTrend: Array<{ weekStart: string; median: number | null }>;
  aiPreviousSales: string | null;
  aiSales: string | null;
  aiClickRate: string | null;
  aiConversionRate: string | null;
  aiAddToCartRate: string | null;
  aiAddToCartCost: string | null;
  aiRoi: string | null;
  aiUnitPrice: string | null;
  aiSpend: string | null;
  aiCpc: string | null;
}

export interface ProductHistoryItem {
  id: string;
  weekStart: string;
  weekEnd: string;
  categoryName: string;
  categoryLevel1: string;
  categoryLevel2: string | null;
  rank: number | null;
  trend: string | null;
  visitor: MetricRange;
  buyer: MetricRange;
  cart: MetricRange;
  exportTime: string | null;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
