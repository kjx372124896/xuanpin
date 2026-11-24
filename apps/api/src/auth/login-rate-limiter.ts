import { HttpException, HttpStatus } from "@nestjs/common";
import { createHash } from "node:crypto";

type Window = { count: number; expiresAt: number };

// The application runs as one API process. Bound both password checks and
// remembered keys so unauthenticated requests cannot exhaust CPU or memory.
export class LoginRateLimiter {
  private readonly windows = new Map<string, Window>();
  private active = 0;
  private lastCleanup = 0;

  constructor(private readonly now: () => number = Date.now) {}

  start(username: string, ip: string | undefined): (passwordVerified: boolean) => void {
    const now = this.now();
    if (now - this.lastCleanup >= 30_000) {
      for (const [key, entry] of this.windows) if (entry.expiresAt <= now) this.windows.delete(key);
      this.lastCleanup = now;
    }
    const accountKey = `account:${createHash("sha256").update(username.trim()).digest("hex")}`;
    const ipKey = `ip:${ip ?? "unknown"}`;
    const limits = [
      { key: accountKey, max: 10, duration: 10 * 60_000 },
      { key: ipKey, max: 60, duration: 60_000 },
    ];
    if (this.active >= 4) this.reject();
    for (const limit of limits) {
      const entry = this.windows.get(limit.key);
      if (entry && entry.expiresAt > now && entry.count >= limit.max) this.reject();
    }
    const missingKeys = limits.filter(({ key }) => !this.windows.has(key)).length;
    if (this.windows.size + missingKeys > 10_000) this.reject();
    for (const limit of limits) {
      const entry = this.windows.get(limit.key);
      if (!entry || entry.expiresAt <= now) this.windows.set(limit.key, { count: 1, expiresAt: now + limit.duration });
      else entry.count += 1;
    }
    const accountWindow = this.windows.get(accountKey)!;
    this.active += 1;
    let released = false;
    return (passwordVerified) => {
      if (released) return;
      released = true;
      this.active -= 1;
      if (passwordVerified && this.windows.get(accountKey) === accountWindow) accountWindow.count = 0;
    };
  }

  private reject(): never {
    throw new HttpException("登录尝试过于频繁，请稍后再试。", HttpStatus.TOO_MANY_REQUESTS);
  }
}
