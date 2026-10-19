import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import router from "./routes";
import pilotRouter from "./routes/pilot";
import { logger } from "./lib/logger";
import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";

const app: Express = express();
const pilotAllowedOrigins = (process.env.PILOT_ALLOWED_ORIGINS || "")
  .split(",").map((value) => value.trim()).filter(Boolean);
const pilotConfigured = Boolean(process.env.DATABASE_URL && process.env.CLERK_SECRET_KEY &&
  process.env.CLERK_PUBLISHABLE_KEY && pilotAllowedOrigins.length);

// Clerk validates pilot requests before the application's other middleware.
if (pilotConfigured) {
  app.use("/api/pilot", clerkMiddleware({ authorizedParties: pilotAllowedOrigins }));
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({
  credentials: true,
  origin: pilotAllowedOrigins.length ? pilotAllowedOrigins : true,
}));
app.use("/api/pilot/scans/classify", express.raw({ type: "image/png", limit: "5mb" }));
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb" }));

app.use("/api", router);
if (pilotConfigured) {
  app.use("/api/pilot", pilotRouter);
} else {
  app.use("/api/pilot", (_req, res) => res.status(503).json({ error: "pilot_api_unconfigured" }));
}

export default app;
