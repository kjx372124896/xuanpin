import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { ProductsService } from "../products/products.service";
import { DmpAiService } from "./dmp-ai.service";
import { DmpAuthService } from "./dmp-auth.service";

const BATCH_SIZE = 50;
const RECOVERY_INTERVAL_MS = 30_000;
const MAX_AUTOMATIC_RECOVERIES = 30;
const MAX_PRODUCTS_PER_TASK = 2_000;
const TERMINAL_BATCH_STATUSES = ["COMPLETED", "PARTIAL", "FAILED", "NEEDS_REVIEW"];

@Injectable()
export class DmpJobsService implements OnModuleInit, OnModuleDestroy {
  private stopped = false;
  private draining = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: DmpAuthService,
    private readonly ai: DmpAiService,
    private readonly products: ProductsService,
  ) {}

  async onModuleInit() {
    await this.recoverInterruptedBatches();
    this.schedule(500);
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  async createTask(adminId: string, input: unknown) {
    if (!Array.isArray(input)) throw new BadRequestException("商品ID列表格式不正确。");
    const productIds = [...new Set(input.map((value) => String(value ?? "").trim()).filter(Boolean))];
    if (!productIds.length) throw new BadRequestException("请先勾选需要获取数据的商品。");
    if (productIds.length > MAX_PRODUCTS_PER_TASK) throw new BadRequestException(`单个后台任务最多支持 ${MAX_PRODUCTS_PER_TASK} 个商品。`);
    if (productIds.some((id) => !/^\d{6,20}$/.test(id))) throw new BadRequestException("商品ID必须为6至20位数字。");

    const credentialStatus = await this.auth.getStatus(adminId);
    if (!credentialStatus.configured || credentialStatus.lastStatus !== "VALID") {
      throw new BadRequestException("达摩盘授权尚未就绪，请管理员先在「达摩盘授权」页面完成登录和连接测试。");
    }

    const existing = await this.prisma.product.findMany({
      where: { productId: { in: productIds } },
      select: { productId: true },
    });
    const existingIds = new Set(existing.map((item) => item.productId));
    const missing = productIds.filter((id) => !existingIds.has(id));
    if (missing.length) throw new BadRequestException(`有 ${missing.length} 个商品已不在商品库中，请刷新列表后重新选择。`);

    const chunks: string[][] = [];
    for (let index = 0; index < productIds.length; index += BATCH_SIZE) chunks.push(productIds.slice(index, index + BATCH_SIZE));
    const task = await this.prisma.dmpCollectionTask.create({
      data: {
        createdById: adminId,
        title: `商品数据获取 · ${productIds.length} 件`,
        status: "QUEUED",
        productIdsJson: JSON.stringify(productIds),
        totalProducts: productIds.length,
        totalBatches: chunks.length,
        batches: {
          create: chunks.map((ids, index) => ({
            batchNumber: index + 1,
            productIdsJson: JSON.stringify(ids),
            clientRunId: randomUUID(),
            status: "QUEUED",
            nextAttemptAt: new Date(),
          })),
        },
      },
    });
    this.schedule(0);
    return this.getTask(task.id);
  }

  async listTasks() {
    const tasks = await this.prisma.dmpCollectionTask.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        createdBy: { select: { id: true, name: true, username: true } },
        batches: { orderBy: { batchNumber: "asc" } },
      },
    });
    return { items: tasks.map((task) => this.mapTask(task)) };
  }

  async getTask(taskId: string) {
    const task = await this.prisma.dmpCollectionTask.findUnique({
      where: { id: taskId },
      include: {
        createdBy: { select: { id: true, name: true, username: true } },
        batches: { orderBy: { batchNumber: "asc" } },
      },
    });
    if (!task) throw new NotFoundException("没有找到该后台获取任务。");
    return this.mapTask(task);
  }

  async recoverBatch(taskId: string, batchNumber: number) {
    const batch = await this.findBatch(taskId, batchNumber);
    const run = await this.prisma.dmpAiRun.findUnique({
      where: { userId_clientRunId: { userId: batch.task.createdById, clientRunId: batch.clientRunId } },
    });
    if (!run?.sessionId) {
      throw new BadRequestException("这一批没有可查询的达摩盘会话。若任务已明确失败，请使用「重试」创建新的批次尝试。");
    }
    if (run.markdown) {
      await this.importBatchResult(batch, run.markdown);
      return this.getTask(taskId);
    }
    await this.prisma.dmpCollectionBatch.update({
      where: { id: batch.id },
      data: { status: "RECOVERING", recoveryCount: 0, nextAttemptAt: new Date(), lastError: null, completedAt: null },
    });
    await this.prisma.dmpCollectionTask.update({ where: { id: taskId }, data: { status: "RUNNING", completedAt: null } });
    this.schedule(0);
    return this.getTask(taskId);
  }

  async retryBatch(taskId: string, batchNumber: number) {
    const batch = await this.findBatch(taskId, batchNumber);
    if (!["FAILED", "NEEDS_REVIEW", "PARTIAL"].includes(batch.status)) {
      throw new BadRequestException("当前批次不处于可重试状态。");
    }
    const previousRun = await this.prisma.dmpAiRun.findUnique({
      where: { userId_clientRunId: { userId: batch.task.createdById, clientRunId: batch.clientRunId } },
    });
    if (previousRun?.sessionId && !previousRun.markdown && ["TALKING", "UNCERTAIN"].includes(previousRun.status)) {
      throw new BadRequestException("原 AI 会话尚未确认结束。请先「重新查询」原会话，不能直接重新发送收费请求。");
    }
    const previousIds = this.safeJsonArray(batch.previousClientRunIdsJson);
    previousIds.push(batch.clientRunId);
    await this.prisma.dmpCollectionBatch.update({
      where: { id: batch.id },
      data: {
        clientRunId: randomUUID(),
        previousClientRunIdsJson: JSON.stringify([...new Set(previousIds)]),
        status: "QUEUED",
        recoveryCount: 0,
        nextAttemptAt: new Date(),
        lastError: null,
        startedAt: null,
        completedAt: null,
        savedProducts: 0,
      },
    });
    await this.prisma.dmpCollectionTask.update({ where: { id: taskId }, data: { status: "QUEUED", completedAt: null, lastError: null } });
    this.schedule(0);
    return this.getTask(taskId);
  }

  private async findBatch(taskId: string, batchNumber: number) {
    if (!Number.isInteger(batchNumber) || batchNumber < 1) throw new BadRequestException("批次序号不正确。");
    const batch = await this.prisma.dmpCollectionBatch.findUnique({
      where: { taskId_batchNumber: { taskId, batchNumber } },
      include: { task: true },
    });
    if (!batch) throw new NotFoundException("没有找到该任务批次。");
    return batch;
  }

  private mapTask(task: any) {
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      productIds: this.safeJsonArray(task.productIdsJson),
      totalProducts: task.totalProducts,
      totalBatches: task.totalBatches,
      completedBatches: task.completedBatches,
      failedBatches: task.failedBatches,
      savedProducts: task.savedProducts,
      lastError: task.lastError,
      createdAt: task.createdAt.toISOString(),
      startedAt: task.startedAt?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null,
      updatedAt: task.updatedAt.toISOString(),
      createdBy: task.createdBy,
      batches: task.batches.map((batch: any) => ({
        id: batch.id,
        batchNumber: batch.batchNumber,
        productIds: this.safeJsonArray(batch.productIdsJson),
        status: batch.status,
        attempts: batch.attempts,
        recoveryCount: batch.recoveryCount,
        savedProducts: batch.savedProducts,
        lastError: batch.lastError,
        startedAt: batch.startedAt?.toISOString() ?? null,
        completedAt: batch.completedAt?.toISOString() ?? null,
        updatedAt: batch.updatedAt.toISOString(),
        canRetry: ["FAILED", "NEEDS_REVIEW", "PARTIAL"].includes(batch.status),
        canRecover: ["RECOVERING", "NEEDS_REVIEW"].includes(batch.status),
      })),
    };
  }

  private safeJsonArray(value: string): string[] {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }

  private schedule(delayMs: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.drain();
    }, Math.max(0, delayMs));
  }

  private async drain() {
    if (this.stopped || this.draining) return;
    this.draining = true;
    try {
      // 与参考插件的有界并发分波思路一致，默认最多同时执行两个 AI 批次。
      await Promise.allSettled([this.workerLoop(), this.workerLoop()]);
    } catch (error) {
      console.error("DMP 后台任务调度异常：", this.errorText(error));
    } finally {
      this.draining = false;
      this.schedule(2_000);
    }
  }

  private async workerLoop() {
    while (!this.stopped) {
      const candidate = await this.prisma.dmpCollectionBatch.findFirst({
        where: {
          status: { in: ["QUEUED", "RECOVERING"] },
          nextAttemptAt: { lte: new Date() },
          task: { status: { in: ["QUEUED", "RUNNING"] } },
        },
        orderBy: [{ createdAt: "asc" }, { batchNumber: "asc" }],
        include: { task: true },
      });
      if (!candidate) return;
      const sourceStatus = candidate.status;
      const claimed = await this.prisma.dmpCollectionBatch.updateMany({
        where: { id: candidate.id, status: sourceStatus, nextAttemptAt: { lte: new Date() } },
        data: {
          status: "RUNNING",
          ...(sourceStatus === "QUEUED" ? { attempts: { increment: 1 } } : {}),
          startedAt: candidate.startedAt ?? new Date(),
        },
      });
      if (!claimed.count) continue;
      await this.prisma.dmpCollectionTask.update({
        where: { id: candidate.taskId },
        data: { status: "RUNNING", startedAt: candidate.task.startedAt ?? new Date(), completedAt: null },
      });
      await this.executeBatch(candidate, sourceStatus);
    }
  }

  private async executeBatch(batch: any, sourceStatus: string) {
    try {
      if (sourceStatus === "RECOVERING") await this.recoverExistingBatch(batch);
      else await this.startNewBatch(batch);
    } catch (error) {
      const run = await this.prisma.dmpAiRun.findUnique({
        where: { userId_clientRunId: { userId: batch.task.createdById, clientRunId: batch.clientRunId } },
      }).catch(() => null);
      if (run?.sessionId && !run.markdown && ["TALKING", "UNCERTAIN"].includes(run.status)) {
        await this.prisma.dmpCollectionBatch.update({
          where: { id: batch.id },
          data: {
            status: "RECOVERING",
            nextAttemptAt: new Date(Date.now() + RECOVERY_INTERVAL_MS),
            lastError: "请求过程中出现异常，但达摩盘会话已创建；后台将只读查询原会话，不会重新发送收费请求。",
          },
        });
        await this.refreshTask(batch.taskId);
        return;
      }
      await this.prisma.dmpCollectionBatch.update({
        where: { id: batch.id },
        data: {
          status: run?.status === "CREATE_UNCERTAIN" ? "NEEDS_REVIEW" : "FAILED",
          lastError: this.errorText(error).slice(0, 2000),
          completedAt: new Date(),
        },
      });
      await this.refreshTask(batch.taskId);
    }
  }

  private async startNewBatch(batch: any) {
    const productIds = this.safeJsonArray(batch.productIdsJson);
    const result = await this.ai.fetchBatch(batch.task.createdById, {
      clientRunId: batch.clientRunId,
      productIds,
      batchNumber: batch.batchNumber,
    });
    if (result.markdown) {
      await this.importBatchResult(batch, result.markdown);
      return;
    }
    if (result.sessionId && ["TALKING", "UNCERTAIN"].includes(result.status)) {
      await this.prisma.dmpCollectionBatch.update({
        where: { id: batch.id },
        data: { status: "RECOVERING", recoveryCount: 0, nextAttemptAt: new Date(Date.now() + RECOVERY_INTERVAL_MS), lastError: result.errorMessage ?? "原 AI 会话尚未返回完整结果，等待重新查询。" },
      });
      await this.refreshTask(batch.taskId);
      return;
    }
    const needsReview = result.status === "CREATE_UNCERTAIN" || Boolean(result.sessionId && result.status !== "FAILED");
    await this.prisma.dmpCollectionBatch.update({
      where: { id: batch.id },
      data: {
        status: needsReview ? "NEEDS_REVIEW" : "FAILED",
        lastError: result.errorMessage ?? `达摩盘批次未完成（${result.status || "未知状态"}）。`,
        completedAt: new Date(),
      },
    });
    await this.refreshTask(batch.taskId);
  }

  private async recoverExistingBatch(batch: any) {
    const run = await this.prisma.dmpAiRun.findUnique({
      where: { userId_clientRunId: { userId: batch.task.createdById, clientRunId: batch.clientRunId } },
    });
    if (!run?.sessionId) {
      await this.prisma.dmpCollectionBatch.update({
        where: { id: batch.id },
        data: { status: "NEEDS_REVIEW", lastError: "没有找到已持久化的达摩盘会话 ID，不能自动重新发送；请检查后人工重试。", completedAt: new Date() },
      });
      await this.refreshTask(batch.taskId);
      return;
    }
    if (run.markdown) {
      await this.importBatchResult(batch, run.markdown);
      return;
    }

    const recovered = await this.ai.recoverRun(batch.task.createdById, batch.clientRunId);
    if (recovered.markdown) {
      await this.importBatchResult(batch, recovered.markdown);
      return;
    }

    const latest = await this.prisma.dmpAiRun.findUnique({
      where: { userId_clientRunId: { userId: batch.task.createdById, clientRunId: batch.clientRunId } },
    });
    if (latest?.markdown) {
      await this.importBatchResult(batch, latest.markdown);
      return;
    }
    if (latest && ["FAILED", "CREATE_UNCERTAIN"].includes(latest.status)) {
      await this.prisma.dmpCollectionBatch.update({
        where: { id: batch.id },
        data: { status: latest.status === "CREATE_UNCERTAIN" ? "NEEDS_REVIEW" : "FAILED", lastError: latest.errorMessage ?? "原会话已失败。", completedAt: new Date() },
      });
      await this.refreshTask(batch.taskId);
      return;
    }

    const recoveryCount = batch.recoveryCount + 1;
    if (recoveryCount >= MAX_AUTOMATIC_RECOVERIES) {
      await this.prisma.dmpCollectionBatch.update({
        where: { id: batch.id },
        data: {
          status: "NEEDS_REVIEW",
          recoveryCount,
          lastError: "自动查询已持续约15分钟，仍未确认原会话完成。没有重新发送收费请求；管理员可以稍后再次查询原会话。",
          completedAt: new Date(),
        },
      });
    } else {
      await this.prisma.dmpCollectionBatch.update({
        where: { id: batch.id },
        data: {
          status: "RECOVERING",
          recoveryCount,
          nextAttemptAt: new Date(Date.now() + RECOVERY_INTERVAL_MS),
          lastError: "原 AI 会话暂未返回完整结果，后台会继续只读查询。",
        },
      });
    }
    await this.refreshTask(batch.taskId);
  }

  private async importBatchResult(batch: any, markdown: string) {
    const productIds = this.safeJsonArray(batch.productIdsJson);
    try {
      const result = await this.products.importAiMetrics(productIds, markdown);
      const status = result.savedCount === productIds.length ? "COMPLETED" : "PARTIAL";
      const missingCount = productIds.length - result.savedCount;
      await this.prisma.dmpCollectionBatch.update({
        where: { id: batch.id },
        data: {
          status,
          savedProducts: result.savedCount,
          lastError: missingCount ? `本批请求 ${productIds.length} 件，成功入库 ${result.savedCount} 件；请核对未匹配商品。` : null,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      await this.prisma.dmpCollectionBatch.update({
        where: { id: batch.id },
        data: {
          status: "NEEDS_REVIEW",
          lastError: `已取得 AI 回复，但数据解析或入库未完成：${this.errorText(error)}`.slice(0, 2000),
          completedAt: new Date(),
        },
      });
    }
    await this.refreshTask(batch.taskId);
  }

  private async refreshTask(taskId: string) {
    const batches = await this.prisma.dmpCollectionBatch.findMany({ where: { taskId } });
    const completedBatches = batches.filter((batch) => ["COMPLETED", "PARTIAL"].includes(batch.status)).length;
    const failedBatches = batches.filter((batch) => ["FAILED", "NEEDS_REVIEW"].includes(batch.status)).length;
    const partialBatches = batches.filter((batch) => batch.status === "PARTIAL").length;
    const savedProducts = batches.reduce((sum, batch) => sum + batch.savedProducts, 0);
    const hasRunning = batches.some((batch) => ["RUNNING", "RECOVERING"].includes(batch.status));
    const hasQueued = batches.some((batch) => batch.status === "QUEUED");
    const allTerminal = batches.length > 0 && batches.every((batch) => TERMINAL_BATCH_STATUSES.includes(batch.status));
    const status = hasRunning ? "RUNNING"
      : hasQueued ? "QUEUED"
        : failedBatches || partialBatches ? (completedBatches ? "PARTIAL" : "FAILED")
          : allTerminal ? "COMPLETED" : "QUEUED";
    const firstError = batches.find((batch) => ["FAILED", "NEEDS_REVIEW", "PARTIAL"].includes(batch.status) && batch.lastError)?.lastError ?? null;
    await this.prisma.dmpCollectionTask.update({
      where: { id: taskId },
      data: {
        status,
        completedBatches,
        failedBatches,
        savedProducts,
        lastError: firstError,
        completedAt: allTerminal ? new Date() : null,
      },
    });
  }

  private async recoverInterruptedBatches() {
    const interrupted = await this.prisma.dmpCollectionBatch.findMany({
      where: { status: "RUNNING" },
      include: { task: true },
    });
    const taskIds = new Set<string>();
    for (const batch of interrupted) {
      taskIds.add(batch.taskId);
      const run = await this.prisma.dmpAiRun.findUnique({
        where: { userId_clientRunId: { userId: batch.task.createdById, clientRunId: batch.clientRunId } },
      });
      if (run?.markdown) {
        await this.prisma.dmpCollectionBatch.update({ where: { id: batch.id }, data: { status: "RECOVERING", nextAttemptAt: new Date(), lastError: null } });
      } else if (run?.sessionId) {
        await this.prisma.dmpCollectionBatch.update({ where: { id: batch.id }, data: { status: "RECOVERING", nextAttemptAt: new Date(), lastError: "检测到服务重启，正在查询原 AI 会话。" } });
      } else {
        await this.prisma.dmpCollectionBatch.update({
          where: { id: batch.id },
          data: {
            status: "NEEDS_REVIEW",
            lastError: "任务执行期间服务中断，未找到可恢复的会话 ID。为避免重复请求，系统未自动重发；管理员可检查后人工重试。",
            completedAt: new Date(),
          },
        });
      }
    }
    for (const taskId of taskIds) await this.refreshTask(taskId);
  }

  private errorText(error: unknown) {
    if (error instanceof Error) return error.message;
    return String(error ?? "未知错误");
  }
}
