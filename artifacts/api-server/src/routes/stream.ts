import { Router } from "express";
import { randomUUID } from "node:crypto";
import { broadcaster } from "../lib/broadcaster";
import {
  simulateAttack,
  startSimulation,
  stopSimulation,
  getSimulationStatus,
} from "../lib/simulator";

const router = Router();

router.get("/events/stream", (req, res) => {
  const clientId = randomUUID();
  const cleanup = broadcaster.addClient(clientId, res);

  req.on("close", cleanup);
  req.on("error", cleanup);
});

router.post("/simulate/attack", async (req, res) => {
  const event = await simulateAttack();
  res.json(event);
});

router.post("/simulate/start", (req, res) => {
  const started = startSimulation();
  res.json({ started, status: getSimulationStatus() });
});

router.post("/simulate/stop", (req, res) => {
  const stopped = stopSimulation();
  res.json({ stopped, status: getSimulationStatus() });
});

router.get("/simulate/status", (req, res) => {
  res.json(getSimulationStatus());
});

export default router;
