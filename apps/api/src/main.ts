import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.setGlobalPrefix("api/v1");

  const port = Number(process.env.API_PORT || 8788);
  const host = process.env.API_HOST || "127.0.0.1";
  await app.listen(port, host);
}

void bootstrap();
