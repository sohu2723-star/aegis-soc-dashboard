import { db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { securityEventsTable, alertsTable } from "@workspace/db";
import { broadcaster } from "./broadcaster";

const ATTACK_SCENARIOS = [
  {
    type: "web_attack", subtype: "SQL Injection", severity: "critical" as const,
    toolUsed: "sqlmap",
    description: "Automated SQL injection attack detected. Attacker probing authentication bypass vulnerabilities.",
    layer: "perimeter",
    targets: ["web-server-01", "web-server-02", "admin-portal"],
    sources: ["192.168.1.", "10.0.0.", "172.16.0."],
  },
  {
    type: "web_attack", subtype: "XSS Attack", severity: "high" as const,
    toolUsed: "burpsuite",
    description: "Cross-site scripting payload detected in request parameters. WAF rule triggered.",
    layer: "perimeter",
    targets: ["web-server-01", "web-server-02"],
    sources: ["10.0.0.", "192.168.2."],
  },
  {
    type: "network_attack", subtype: "Port Scan", severity: "medium" as const,
    toolUsed: "nmap",
    description: "TCP SYN scan across internal subnet. Reconnaissance activity detected.",
    layer: "perimeter",
    targets: ["internal-network", "firewall-01"],
    sources: ["172.16.0.", "10.10.0."],
  },
  {
    type: "network_attack", subtype: "DDoS Flood", severity: "critical" as const,
    toolUsed: "hping3",
    description: "High-volume UDP flood attack detected. Auto-mitigation rule triggered on perimeter.",
    layer: "perimeter",
    targets: ["firewall-01", "dns-server"],
    sources: ["203.0.113.", "198.51.100."],
  },
  {
    type: "network_attack", subtype: "ARP Spoofing", severity: "high" as const,
    toolUsed: "arpspoof",
    description: "ARP cache poisoning detected. Possible MITM attack in progress on LAN segment.",
    layer: "perimeter",
    targets: ["gateway-01", "switch-core"],
    sources: ["192.168.1.", "10.0.0."],
  },
  {
    type: "phishing", subtype: "Fake Login Page", severity: "high" as const,
    toolUsed: "gophish",
    description: "Phishing beacon triggered. Employee credential harvest attempt via fake VPN portal.",
    layer: "brain",
    targets: ["mail-server", "employee-devices"],
    sources: ["198.51.100.", "203.0.113."],
  },
  {
    type: "network_attack", subtype: "Brute Force", severity: "high" as const,
    toolUsed: "metasploit",
    description: "SSH brute force detected. Fail2ban auto-ban triggered after threshold exceeded.",
    layer: "perimeter",
    targets: ["ssh-server", "ubuntu-server"],
    sources: ["172.16.50.", "10.10.0."],
  },
  {
    type: "web_attack", subtype: "Directory Traversal", severity: "medium" as const,
    toolUsed: "nikto",
    description: "Path traversal sequences detected in HTTP requests. Multiple ../etc/passwd attempts.",
    layer: "perimeter",
    targets: ["web-server-01"],
    sources: ["10.0.0.", "192.168.1."],
  },
];

function randomIp(prefix: string) {
  return `${prefix}${Math.floor(Math.random() * 254) + 1}`;
}

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function simulateAttack() {
  const scenario    = randomFrom(ATTACK_SCENARIOS);
  const sourceIp    = randomIp(randomFrom(scenario.sources));
  const targetHost  = randomFrom(scenario.targets);

  const [row] = await db.insert(securityEventsTable).values({
    type:        scenario.type,
    subtype:     scenario.subtype,
    severity:    scenario.severity,
    sourceIp,
    targetHost,
    toolUsed:    scenario.toolUsed,
    description: scenario.description,
    status:      "detected",
    layer:       scenario.layer,
  }).$returningId();

  const [event] = await db.select().from(securityEventsTable).where(eq(securityEventsTable.id, row.id));
  const serialized = { ...event, createdAt: event.createdAt.toISOString() };
  broadcaster.broadcast("security_event", serialized);

  if (scenario.severity === "critical" || scenario.severity === "high") {
    const severity = scenario.severity;
    const message  = `${severity.toUpperCase()}: ${scenario.subtype} detected — source ${sourceIp} targeting ${targetHost}`;

    const [aRow] = await db.insert(alertsTable).values({
      message,
      severity,
      channel:      severity === "critical" ? "telegram" : "dashboard",
      acknowledged: false,
      eventId:      event.id,
    }).$returningId();

    const [alert] = await db.select().from(alertsTable).where(eq(alertsTable.id, aRow.id));
    broadcaster.broadcast("alert", { ...alert, createdAt: alert.createdAt.toISOString() });
  }

  broadcaster.broadcast("stats_update", { timestamp: new Date().toISOString() });
  return serialized;
}

let simulationTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;

function scheduleNext() {
  if (!isRunning) return;
  const delay = 4000 + Math.random() * 6000;
  simulationTimer = setTimeout(async () => {
    try { await simulateAttack(); } catch {}
    scheduleNext();
  }, delay);
}

export function startSimulation() {
  if (isRunning) return false;
  isRunning = true;
  scheduleNext();
  return true;
}

export function stopSimulation() {
  if (!isRunning) return false;
  isRunning = false;
  if (simulationTimer) { clearTimeout(simulationTimer); simulationTimer = null; }
  return true;
}

export function getSimulationStatus() {
  return { running: isRunning, connectedClients: broadcaster.clientCount };
}
