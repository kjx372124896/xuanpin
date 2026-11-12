import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export function getProjectRoot() {
  const cwd = process.cwd();
  return existsSync(path.join(cwd, "pnpm-workspace.yaml")) ? cwd : path.resolve(cwd, "../..");
}

export function getUploadRoot() {
  const root = getProjectRoot();
  const configured = process.env.UPLOAD_DIR || "apps/api/storage/uploads";
  const folder = path.resolve(root, configured);
  mkdirSync(folder, { recursive: true });
  return folder;
}
