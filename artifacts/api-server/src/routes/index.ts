import { Router, type IRouter } from "express";
import healthRouter from "./health";
import workoutRouter from "./workout";

const router: IRouter = Router();

router.use(healthRouter);
router.use(workoutRouter);

export default router;
