import { Router } from "express";
import { randomUUID } from "node:crypto";
import { broadcaster } from "../lib/broadcaster";

const router = Router();

router.get("/events/stream", (req, res) => {
  const clientId = randomUUID();
  const cleanup = broadcaster.addClient(clientId, res);

  req.on("close", cleanup);
  req.on("error", cleanup);
});

export default router;
