import axios from "axios";

export const api = axios.create({ baseURL: "/api", withCredentials: true, timeout: 60_000 });

export function errorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[] } | undefined;
    if (Array.isArray(data?.message)) return data.message.join("；");
    if (data?.message) return data.message;
    return error.message || "请求失败，请稍后重试。";
  }
  return error instanceof Error ? error.message : "发生未知错误。";
}
