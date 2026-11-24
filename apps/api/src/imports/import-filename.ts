import { isUtf8 } from "node:buffer";

export function normalizeImportFilename(filename: string): string {
  // Multer 默认按 Latin-1 解读 multipart filename，浏览器通常发送 UTF-8 字节。
  // 只对可完整还原为 UTF-8 的字节串解码，避免截断正常 Unicode 或产生替换字符。
  if (/[^\u0000-\u00ff]/u.test(filename)) return filename;
  const bytes = Buffer.from(filename, "latin1");
  return isUtf8(bytes) ? bytes.toString("utf8") : filename;
}
