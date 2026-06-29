import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import busRouter from "./bus.js";
import mapRouter from "./mapRoutes.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(busRouter);
router.use(mapRouter);

export default router;
