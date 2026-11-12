import { SetMetadata } from "@nestjs/common";

export const PUBLIC_KEY = "selection:public";
export const ROLES_KEY = "selection:roles";
export const IMPORT_KEY = "selection:import";

export const Public = () => SetMetadata(PUBLIC_KEY, true);
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
export const CanImport = () => SetMetadata(IMPORT_KEY, true);
