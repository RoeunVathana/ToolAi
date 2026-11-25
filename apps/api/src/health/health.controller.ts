import { Controller, Get } from "@nestjs/common";

export interface HealthResponse {
  status: "ok";
  service: "api";
  architecture: "nestjs";
  timestamp: string;
}

@Controller("health")
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return {
      status: "ok",
      service: "api",
      architecture: "nestjs",
      timestamp: new Date().toISOString(),
    };
  }
}
