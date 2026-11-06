import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { digitalAssetCatalog } from "../lib/digitalAssetRegistry";

const router: IRouter = Router();

router.use(healthRouter);
// Public evidence describes actual bytes; it never exposes the reward file.
// Download still requires an administrator or an owner's fulfilled redemption.
router.get("/resources/digital/:key/:digest", (req, res) => {
  const asset = digitalAssetCatalog().find(item => item.key === req.params.key && item.sha256 === req.params.digest);
  if (!asset) return res.status(404).json({ error: "digital_asset_unavailable" });
  return res.json(asset);
});

export default router;
