import { Controller, Get } from "@nestjs/common";
import { Public } from "./auth/auth.decorators";

@Controller("health")
export class HealthController {
  @Public()
  @Get()
  health() { return { ok: true, service: "selection-api", time: new Date().toISOString() }; }
}
