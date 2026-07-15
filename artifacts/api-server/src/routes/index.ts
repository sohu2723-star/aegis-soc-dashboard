import { Router, type IRouter } from "express";
import healthRouter from "./health";
import eventsRouter from "./events";
import incidentsRouter from "./incidents";
import alertsRouter from "./alerts";
import systemRouter from "./system";
import reportsRouter from "./reports";
import dashboardRouter from "./dashboard";
import streamRouter from "./stream";
import ingestRouter from "./ingest";
import networkRouter from "./network";
import defenseRouter from "./defense";
import firewallRouter from "./firewall";
import connectionsRouter from "./connections";
import defenseRulesRouter from "./defense-rules";
import uiRulesRouter from "./ui-rules";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(streamRouter);
router.use(ingestRouter);
router.use(eventsRouter);
router.use(incidentsRouter);
router.use(alertsRouter);
router.use(systemRouter);
router.use(reportsRouter);
router.use(networkRouter);
router.use(defenseRouter);
router.use(firewallRouter);
router.use(connectionsRouter);
router.use(defenseRulesRouter);
router.use(uiRulesRouter);

export default router;
