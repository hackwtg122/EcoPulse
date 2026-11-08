import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { digitalAssetCatalog } from "../lib/digitalAssetRegistry";
import { loadPublicImpact } from "../lib/publicImpact";

const router: IRouter = Router();

router.use(healthRouter);
router.get("/public/impact", async (_req, res, next) => {
  try {
    const { pool } = await import("@workspace/db");
    const data = await loadPublicImpact(pool);
    // A short public cache prevents 20 simultaneous browsers from repeatedly
    // querying the database; no personal details are included in this response.
    res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    return res.json(data);
  } catch (error) {
    return next(error);
  }
});

// Public evidence describes actual bytes; it never exposes the reward file.
// Download still requires an administrator or an owner's fulfilled redemption.
router.get("/resources/digital/:key/:digest", (req, res) => {
  const asset = digitalAssetCatalog().find(item => item.key === req.params.key && item.sha256 === req.params.digest);
  if (!asset) return res.status(404).json({ error: "digital_asset_unavailable" });
  return res.json(asset);
});

export default router;
