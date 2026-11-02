import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/version", (_req, res) => {
  res.set("Cache-Control", "no-store");
  const sha = process.env.ECOPULSE_BUILD_COMMIT || process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || "";
  return res.json({ service: "ecopulse-api", commit: /^[a-f0-9]{40}$/i.test(sha) ? sha : null });
});

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
