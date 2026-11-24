import { ServiceUnavailableException } from "@nestjs/common";

export class BoundedWorkQueue {
  private active = false;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly maxQueued = 10) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active) {
      if (this.waiters.length >= this.maxQueued) throw new ServiceUnavailableException("导入解析任务较多，请稍后重试。");
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    } else this.active = true;
    try {
      return await work();
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active = false;
    }
  }
}
