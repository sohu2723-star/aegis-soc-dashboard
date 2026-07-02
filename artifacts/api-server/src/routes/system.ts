import { Router } from "express";
import { db } from "@workspace/db";
import { systemStatusTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { broadcaster } from "../lib/broadcaster";

const router = Router();

const DEFAULT_COMPONENTS = [
  { component: "Suricata IDS/IPS", layer: "perimeter", status: "unknown", description: "Network intrusion detection — monitors all traffic for attack signatures (Snort rules, ET open ruleset)" },
  { component: "Snort IDS",        layer: "perimeter", status: "unknown", description: "Packet-level intrusion detection — complements Suricata with additional rule sets" },
  { component: "pfSense Firewall", layer: "perimeter", status: "unknown", description: "Edge firewall & router — enforces iptables/pf rules, blocks attacker IPs at network boundary" },
  { component: "Fail2ban",         layer: "perimeter", status: "unknown", description: "Adaptive ban daemon — auto-bans IPs after repeated SSH/FTP/web failures" },
  { component: "Cowrie Honeypot",  layer: "perimeter", status: "unknown", description: "SSH/Telnet honeypot — logs attacker commands & credentials, auto-triggers IP block on contact" },
  { component: "ModSecurity WAF",  layer: "perimeter", status: "unknown", description: "Web application firewall — blocks SQLi, XSS, LFI, RFI, path traversal on HTTP layer" },
  { component: "AEGIS API Server", layer: "brain",     status: "online",  description: "Central ingest & command server — receives sensor events, runs auto-defense engine, serves dashboard" },
  { component: "AEGIS Dashboard",  layer: "output",    status: "online",  description: "Real-time monitoring UI — Command Center, Security Events, Incidents, Defense Center" },
  { component: "Kali Linux (Red)", layer: "attacker",  status: "unknown", description: "Red Team attack machine — nmap, hydra, sqlmap, hping3, metasploit, gobuster" },
];

async function seedSystemStatus() {
  const existing = await db.select().from(systemStatusTable);
  if (existing.length > 0) return;
  for (const c of DEFAULT_COMPONENTS) {
    await db.insert(systemStatusTable).values(c);
  }
}

router.get("/system/status", async (_req, res) => {
  await seedSystemStatus();

  const statuses = await db
    .select()
    .from(systemStatusTable)
    .orderBy(asc(systemStatusTable.layer));

  res.json(statuses.map(s => ({
    ...s,
    lastCheck: s.lastCheck.toISOString(),
  })));
});

router.post("/system/status", async (req, res) => {
  const { component, layer, status, description, metrics } = req.body as {
    component: string; layer: string; status: string;
    description?: string; metrics?: string;
  };
  if (!component || !layer || !status) {
    res.status(400).json({ error: "component, layer, status required" });
    return;
  }

  const existing = await db.select().from(systemStatusTable);
  const match = existing.find(s => s.component === component);

  let result;
  if (match) {
    const prevStatus = match.status;
    const [updated] = await db
      .update(systemStatusTable)
      .set({ status, metrics: metrics ?? null, lastCheck: new Date() })
      .where(eq(systemStatusTable.id, match.id))
      .returning();
    result = { ...updated, lastCheck: updated.lastCheck.toISOString() };

    // Broadcast only when status actually changed
    if (prevStatus !== status) {
      broadcaster.broadcast("service_status_change", {
        component,
        status,
        prevStatus,
        layer,
        lastCheck: result.lastCheck,
      });
    }
  } else {
    const [row] = await db.insert(systemStatusTable).values({
      component, layer, status,
      description: description ?? component,
      metrics: metrics ?? null,
    }).returning();
    result = { ...row, lastCheck: row.lastCheck.toISOString() };

    broadcaster.broadcast("service_status_change", {
      component,
      status,
      prevStatus: "unknown",
      layer,
      lastCheck: result.lastCheck,
    });
  }

  res.json(result);
});

export default router;
