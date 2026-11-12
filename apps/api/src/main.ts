import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { config } from "dotenv";
import path from "node:path";
import { getProjectRoot } from "./common/paths";
import { AppModule } from "./app.module";

async function bootstrap() {
  config({ path: path.join(getProjectRoot(), ".env") });
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api");
  app.use(cookieParser());
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? "http://localhost:5173").split(","),
    credentials: true,
  });
  const trustProxy = process.env.TRUST_PROXY ?? "0";
  const trustProxySetting: boolean | number = trustProxy === "true" ? true : Number(trustProxy) || false;
  app.getHttpAdapter().getInstance().set("trust proxy", trustProxySetting);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, "0.0.0.0");
  console.log(`Selection API listening on http://127.0.0.1:${port}/api`);
}

void bootstrap();
