import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { verifyToken } from "../lib/jwt-auth";
import healthRouter from "./health";
import eventsRouter from "./events";
import alertsRouter from "./alerts";
import systemRouter from "./system";
import reportsRouter from "./reports";
import dashboardRouter from "./dashboard";
import streamRouter from "./stream";
import ingestRouter from "./ingest";
import networkRouter from "./network";
import defenseRouter from "./defense";
import connectionsRouter from "./connections";
import defenseRulesRouter from "./defense-rules";
import uiRulesRouter from "./ui-rules";
import aiRouter from "./ai";
import ttsRouter from "./tts";
import settingsRouter from "./settings";

const router: IRouter = Router();

// Block write operations (POST/PATCH/PUT/DELETE) for demo-role tokens.
// Ingest routes use AEGIS_INGEST_KEY (not Bearer), so they are unaffected.
// Auth routes have no Bearer token, so they are unaffected.
router.use((req: Request, res: Response, next: NextFunction) => {
  const WRITE_METHODS = ["POST", "PATCH", "PUT", "DELETE"];
  if (!WRITE_METHODS.includes(req.method)) { next(); return; }

  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { next(); return; }

  const payload = verifyToken(auth.slice(7));
  if (payload?.role === "demo") {
    res.status(403).json({ error: "Demo mode — read only" });
    return;
  }
  next();
});

router.use(healthRouter);
router.use(dashboardRouter);
router.use(streamRouter);
router.use(ingestRouter);
router.use(eventsRouter);
router.use(alertsRouter);
router.use(systemRouter);
router.use(reportsRouter);
router.use(networkRouter);
router.use(defenseRouter);
router.use(connectionsRouter);
router.use(defenseRulesRouter);
router.use(uiRulesRouter);
router.use(aiRouter);
router.use(ttsRouter);
router.use(settingsRouter);

export default router;
