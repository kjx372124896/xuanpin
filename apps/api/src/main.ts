import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { config } from "dotenv";
import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./common/paths";
import { AppModule } from "./app.module";

async function bootstrap() {
  config({ path: path.join(getProjectRoot(), ".env") });
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api");
  app.use(cookieParser());
  const webOrigins = new Set((process.env.WEB_ORIGIN ?? "http://localhost:5173").split(",").map((value) => value.trim()).filter(Boolean));
  const extensionOrigin = process.env.DMP_EXTENSION_ID ? `chrome-extension://${process.env.DMP_EXTENSION_ID}` : "";
  app.enableCors({
    origin: (origin: string | undefined, callback: (error: Error | null, allowed?: boolean) => void) => callback(null, !origin || webOrigins.has(origin) || origin === extensionOrigin),
    credentials: true,
  });
  const trustProxy = process.env.TRUST_PROXY ?? "0";
  const trustProxySetting: boolean | number = trustProxy === "true" ? true : Number(trustProxy) || false;
  app.getHttpAdapter().getInstance().set("trust proxy", trustProxySetting);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  if (process.env.SERVE_WEB === "true") {
    const webDist = path.join(getProjectRoot(), "apps", "web", "dist");
    const indexFile = path.join(webDist, "index.html");
    if (!existsSync(indexFile)) {
      throw new Error(`前端构建产物不存在：${indexFile}。请先执行 pnpm -r build。`);
    }
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.use(express.static(webDist, {
      index: false,
      setHeaders: (response, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          response.setHeader("Cache-Control", "no-cache");
        }
      },
    }));
    expressApp.use((request: Request, response: Response, next: NextFunction) => {
      if (request.method !== "GET" && request.method !== "HEAD") return next();
      if (request.path === "/api" || request.path.startsWith("/api/")) return next();
      if (path.extname(request.path)) return next();
      if (!request.accepts("html")) return next();
      return response.sendFile(indexFile);
    });
    console.log(`Serving web app from ${webDist}`);
  }

  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? (process.env.NODE_ENV === "production" ? "127.0.0.1" : "0.0.0.0");
  await app.listen(port, host);
  console.log(`Selection API listening on http://127.0.0.1:${port}/api`);
}

void bootstrap();
