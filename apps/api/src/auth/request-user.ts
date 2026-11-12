import type { Request } from "express";
import type { UserRole, EmploymentStatus, AccountStatus } from "@prisma/client";

export interface RequestUser {
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

export type AuthenticatedRequest = Request & { user: RequestUser; sessionTokenHash: string };

export function toSafeUser(user: {
  id: string; username: string; name: string; employeeNo: string | null; department: string | null;
  role: UserRole; employmentStatus: EmploymentStatus; accountStatus: AccountStatus; canImport: boolean;
}): RequestUser {
  return {
    id: user.id, username: user.username, name: user.name, employeeNo: user.employeeNo,
    department: user.department, role: user.role, employmentStatus: user.employmentStatus,
    accountStatus: user.accountStatus, canImport: user.canImport,
  };
}
