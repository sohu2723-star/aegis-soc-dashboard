import { useEffect, useRef, useState, useCallback } from "react";
import { readLiveFeed, type StoredLiveFeedEntry } from "@/lib/live-feed";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Canvas dimensions ─────────────────────────────────────────────────────────
const VW = 960;
const VH = 580;

// ── Node definitions — real lab topology (v4 simplified) ─────────────────────
// Layout: 2-column VM zone so attack packets diverge clearly at pfSense
//   DMZ/Public (top):  companyweb (left)  · dnsserver (right)
//   MGMT (centre):     forwarder
//   Internal (bottom): customerdb (left)  · ldapserver (right)
const NODES = {
  attacker: {
    x: 55,  y: 285,
    label: "Attacker", sub: "Dynamic source",
    ip: "Any external IP",
    color: "#ef4444", glow: "rgba(239,68,68,0.4)",
    icon: "👤",
  },
  r1: {
    x: 200, y: 285,
    label: "R1 Router", sub: "MikroTik CHR",
    ip: "e1 · 192.168.10.1",
    color: "#818cf8", glow: "rgba(129,140,248,0.3)",
    icon: "⬡",
  },
  pfsense: {
    x: 368, y: 285,
    label: "pfSense", sub: "Firewall · Suricata",
    ip: "10.0.23.2",
    color: "#f59e0b", glow: "rgba(245,158,11,0.45)",
    icon: "🛡",
  },
  // ── DMZ / Public zone (top row) ──────────────────────────────────────────
  companyweb: {
    x: 565, y: 108,
    label: "company-web-server", sub: "Apache · Fail2ban",
    ip: "10.10.10.10 (Public)",
    color: "#22c55e", glow: "rgba(34,197,94,0.3)",
    icon: "🖥",
  },
  dnsserver: {
    x: 708, y: 108,
    label: "dns-server", sub: "BIND9 · DNS",
    ip: "10.10.10.20 (Public)",
    color: "#22c55e", glow: "rgba(34,197,94,0.3)",
    icon: "🌐",
  },
  // ── MGMT zone (centre) ────────────────────────────────────────────────────
  forwarder: {
    x: 636, y: 285,
    label: "aegis-forwarder", sub: "Hub · SSH agent",
    ip: "10.30.30.10 (MGMT)",
    color: "#06b6d4", glow: "rgba(6,182,212,0.3)",
    icon: "⬡",
  },
  // ── Internal zone (bottom row) ────────────────────────────────────────────
  customerdb: {
    x: 565, y: 462,
    label: "company-customer-db", sub: "MySQL · Fail2ban",
    ip: "10.20.20.10 (Internal)",
    color: "#22c55e", glow: "rgba(34,197,94,0.3)",
    icon: "🗄",
  },
  ldapserver: {
    x: 708, y: 462,
    label: "ldap-server", sub: "OpenLDAP · slapd",
    ip: "10.20.20.20 (Internal)",
    color: "#22c55e", glow: "rgba(34,197,94,0.3)",
    icon: "📂",
  },
  // ── Monitoring / notification ─────────────────────────────────────────────
  aegis: {
    x: 858, y: 195,
    label: "AEGIS", sub: "SOC Dashboard",
    ip: "Render · Vercel",
    color: "#06b6d4", glow: "rgba(6,182,212,0.25)",
    icon: "📊",
  },
  telegram: {
    x: 858, y: 420,
    label: "Telegram", sub: "Alert Channel",
    ip: "api.telegram.org",
    color: "#29b6f6", glow: "rgba(41,182,246,0.4)",
    icon: "📱",
  },
} as const;

type NodeKey = keyof typeof NODES;

// ── Edges — exact lab connections only ────────────────────────────────────────
// Attack / network topology edges (white dashed)
const EDGES: [NodeKey, NodeKey][] = [
  ["attacker",  "r1"],         // Attacker → R1 ether1 (192.168.122.x)
  ["r1",        "pfsense"],    // R1 ether3 (10.0.23.1) → pfSense WAN (10.0.23.2)
  ["pfsense",   "companyweb"], // pfSense → Public-Switch → company-web-server (10.10.10.10)
  ["pfsense",   "dnsserver"],  // pfSense → Public-Switch → dns-server (10.10.10.20)
  ["pfsense",   "forwarder"],  // pfSense MGMT → aegis-forwarder (10.30.30.10)
  ["pfsense",   "customerdb"], // pfSense → Internal-Switch → company-customer-db (10.20.20.10)
  ["pfsense",   "ldapserver"], // pfSense → Internal-Switch → ldap-server (10.20.20.20)
];

// SSH management / reporting bus (cyan dotted) — forwarder SSH-tails each VM's logs
const MGMT_EDGES: [NodeKey, NodeKey][] = [
  ["companyweb", "forwarder"], // company-web-server SSH → aegis-forwarder
  ["dnsserver",  "forwarder"], // dns-server SSH → aegis-forwarder
  ["customerdb", "forwarder"], // company-customer-db SSH → aegis-forwarder
  ["ldapserver", "forwarder"], // ldap-server SSH → aegis-forwarder
  ["forwarder",  "aegis"],     // aegis-forwarder → AEGIS Dashboard (Render API POST)
];

// ── Notification edges — AEGIS → Telegram (alert channel, styled differently) ─
const NOTIFY_EDGES: [NodeKey, NodeKey][] = [
  ["aegis", "telegram"],
];

// ── Attack path routing ────────────────────────────────────────────────────────
// Full attack path: Attacker → R1 → pfSense → Target VM → Forwarder → AEGIS
// Mirrors real lab data flow: attack hits VM → fail2ban/SSH watcher logs it →
// forwarder SSH-tails the log → POSTs to Render API → AEGIS dashboard shows it.
function getAttackPath(targetHost: string | null | undefined): NodeKey[] {
  const t = (targetHost ?? "").toLowerCase();
  if (t.includes("company") || t.includes("web") || t === "10.10.10.10" || t.includes("apache") || t.includes("dvwa")) {
    return ["attacker", "r1", "pfsense", "companyweb", "forwarder", "aegis"];
  }
  if (t.includes("dns") || t === "10.10.10.20" || t.includes("bind")) {
    return ["attacker", "r1", "pfsense", "dnsserver", "forwarder", "aegis"];
  }
  if (t.includes("ldap") || t === "10.20.20.20" || t.includes("slapd") || t.includes("openldap")) {
    return ["attacker", "r1", "pfsense", "ldapserver", "forwarder", "aegis"];
  }
  if (t.includes("db") || t.includes("customer") || t === "10.20.20.10" || t.includes("postgres") || t.includes("sql")) {
    return ["attacker", "r1", "pfsense", "customerdb", "forwarder", "aegis"];
  }
  // Generic / pfsense-only event (Suricata IDS — no specific VM target)
  return ["attacker", "r1", "pfsense", "forwarder", "aegis"];
}

// ── Severity → colour ─────────────────────────────────────────────────────────
const SEV_COLOR: Record<string, string> = {
  critical: "#ef4444",
  high:     "#f97316",
  medium:   "#f59e0b",
  low:      "#22c55e",
  info:     "#06b6d4",
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface Packet {
  id: string;
  path: NodeKey[];
  seg: number;        // current segment
  t: number;          // progress 0–1 within segment
  speed: number;      // t-units per ms
  blocked: boolean;
  blockedAt: number;  // timestamp when blocked
  severity: string;
  evType: string;
  targetHost: string;
  sourceIp: string;   // attacker IP — used to match defense_action block
  isTg?: boolean;     // true = AEGIS→Telegram notification packet
}

interface LogEntry {
  id: string;
  eventId?: number;
  ts: string;
  tsMs: number;          // epoch ms — used for 24 h auto-cleanup
  evType: string;
  severity: string;
  srcIp: string;
  target: string;
  desc: string;
  defense: boolean;
  telegram: boolean;     // true = Telegram alert was sent for this event
  toolUsed?: string;     // fail2ban | suricata | ssh_watcher | modsecurity | …
  signatureText?: string;// detection rule / signature snippet
  ruleName?: string;     // defense rule name (defense_action events)
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AttackFlowPage() {
  const [packets, setPackets]       = useState<Packet[]>([]);
  const [log, setLog]               = useState<LogEntry[]>(() => readLiveFeed().map(toLogEntry));
  const [alertNodes, setAlertNodes] = useState<Set<NodeKey>>(new Set());  // red border flash
  const [pulseNodes, setPulseNodes] = useState<Set<NodeKey>>(new Set());  // expanding ring
  const [stats, setStats]           = useState({ attacks: 0, blocked: 0 });
  const [tgToasts, setTgToasts]     = useState<{ id: string; sev: string; ts: string }[]>([]);
  // Dynamic attacker IP — updated live from incoming security_event sourceIp
  const [attackerIp, setAttackerIp] = useState<string>("* / any");
  // Data flow diagram toggle
  const [showDataFlow, setShowDataFlow] = useState(false);
  // Increments each time a real SSE security_event arrives — drives DataFlowDiagram
  const [lastEventTs, setLastEventTs] = useState(0);

  const rafRef           = useRef<number | null>(null);
  const prevNowRef       = useRef<number>(0);
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const prevPktSegsRef   = useRef<Map<string, number>>(new Map());

  // The database is authoritative. Hydrate recent events so changing browser,
  // clearing localStorage, or opening the map after an SSE disconnect does not
  // produce an empty feed.
  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/events?limit=100`)
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((rows: any[]) => {
        if (cancelled || !Array.isArray(rows)) return;
        const serverLog: LogEntry[] = rows.map(row => ({
          id: `event-${row.id}`,
          eventId: row.id,
          ts: row.createdAt,
          tsMs: Date.parse(row.createdAt) || Date.now(),
          evType: row.type ?? "unknown",
          severity: row.severity ?? "medium",
          srcIp: row.sourceIp ?? "?",
          target: row.targetHost ?? "?",
          desc: row.description ?? "",
          defense: false,
          telegram: false,
          toolUsed: row.toolUsed ?? undefined,
          signatureText: row.signatureText ?? undefined,
        }));
        setLog(previous => {
          const byId = new Map(serverLog.map(entry => [entry.id, entry]));
          for (const entry of previous) if (!byId.has(entry.id)) byId.set(entry.id, entry);
          return [...byId.values()].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, 200);
        });
        const latestSource = serverLog.find(entry => entry.srcIp !== "?")?.srcIp;
        if (latestSource) setAttackerIp(latestSource);
      })
      .catch(() => { /* SSE and local cache remain available during API downtime */ });
    return () => { cancelled = true; };
  }, []);

  // ── Audio: play a short tone when a packet arrives at a node ────────────
  const playNodeSound = useCallback((nodeKey: NodeKey, severity: string, evType: string, isTg?: boolean) => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") ctx.resume();

      // Frequency by attack type — each service has its own tone
      let freq = 480;
      if (isTg)                              freq = 880;  // Telegram: high chirp
      else if (evType.includes("ssh"))       freq = 330;  // SSH: low
      else if (evType.includes("web"))       freq = 550;  // Web: mid
      else if (evType.includes("dns"))       freq = 440;  // DNS: A4
      else if (evType.includes("db"))        freq = 220;  // DB: deep
      else if (evType.includes("ldap"))      freq = 380;  // LDAP: low-mid
      else if (evType.includes("ddos") || evType.includes("port")) freq = 260;

      // Volume by severity
      const vol = severity === "critical" ? 0.18 : severity === "high" ? 0.12 : 0.07;

      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.22);
    } catch { /* AudioContext not available */ }
  }, []);

  // ── Detect node arrivals: compare packet segment against previous render ──
  useEffect(() => {
    const prev = prevPktSegsRef.current;
    for (const p of packets) {
      if (p.blocked || p.isTg === true) continue;
      const prevSeg = prev.get(p.id);
      if (prevSeg !== undefined && p.seg > prevSeg) {
        // Packet advanced — it just arrived at p.path[p.seg]
        const arrivedAt = p.path[p.seg];
        if (arrivedAt) playNodeSound(arrivedAt, p.severity, p.evType, p.isTg);
      }
      prev.set(p.id, p.seg);
    }
    // Telegram packets: play sound when they reach telegram node
    for (const p of packets) {
      if (!p.isTg) continue;
      const prevSeg = prev.get(p.id);
      if (prevSeg !== undefined && p.seg > prevSeg && p.path[p.seg] === "telegram") {
        playNodeSound("telegram", p.severity, "telegram", true);
      }
      prev.set(p.id, p.seg);
    }
    // Prune removed packets
    const liveIds = new Set(packets.map(p => p.id));
    for (const id of prev.keys()) if (!liveIds.has(id)) prev.delete(id);
  }, [packets, playNodeSound]);

  const addPacket = useCallback((ev: {
    id?: string;
    severity?: string;
    type?: string;
    targetHost?: string;
    sourceIp?: string;
  }, replay = false) => {
    const path = getAttackPath(ev.targetHost);
    const pkt: Packet = {
      id: ev.id ?? `pkt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      path,
      seg: 0,
      t: 0,
      // Slow enough to follow the full path. Replay uses the same pace.
      speed: replay ? 0.00018 : 0.00020 + Math.random() * 0.00008,
      blocked: false,
      blockedAt: 0,
      severity: ev.severity ?? "medium",
      evType: ev.type ?? "unknown",
      targetHost: ev.targetHost ?? "",
      sourceIp: ev.sourceIp ?? "",
    };
    setPackets(prev => [...prev.slice(-40), pkt]);
    return pkt;
  }, []);

  const replayEntry = useCallback((entry: LogEntry) => {
    if (entry.defense) return;
    addPacket({
      id: `replay-${entry.id}-${Date.now()}`,
      severity: entry.severity,
      type: entry.evType,
      targetHost: entry.target,
      sourceIp: entry.srcIp,
    }, true);
    setPulseNodes(prev => new Set([...prev, "attacker"]));
    window.setTimeout(() => setPulseNodes(prev => {
      const next = new Set(prev);
      next.delete("attacker");
      return next;
    }), 1400);
  }, [addPacket]);

  // ── rAF animation loop ───────────────────────────────────────────────────
  const animate = useCallback((now: number) => {
    const dt = now - prevNowRef.current;
    prevNowRef.current = now;

    setPackets(prev => {
      const next: Packet[] = [];
      const nowMs = Date.now();
      for (const p of prev) {
        if (p.blocked) {
          // Remove blocked packets after 1.2 s
          if (nowMs - p.blockedAt < 1200) next.push(p);
          continue;
        }
        const newT = p.t + p.speed * dt;
        if (newT >= 1) {
          const nextSeg = p.seg + 1;
          if (nextSeg >= p.path.length - 1) continue; // reached end
          next.push({ ...p, seg: nextSeg, t: newT - 1 });
        } else {
          next.push({ ...p, t: newT });
        }
      }
      return next;
    });

    rafRef.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    prevNowRef.current = performance.now();
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [animate]);

  // ── 24 h auto-cleanup of log entries ─────────────────────────────────────
  useEffect(() => {
    const prune = () => {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      setLog(prev => prev.filter(e => e.tsMs >= cutoff));
    };
    const timer = setInterval(prune, 5 * 60 * 1000); // every 5 min
    return () => clearInterval(timer);
  }, []);

  // ── SSE connection ───────────────────────────────────────────────────────
  useEffect(() => {
    let es: EventSource;
    let reconnect: ReturnType<typeof setTimeout>;

    function connect() {
      es = new EventSource(`${BASE}/api/events/stream`);

      es.addEventListener("security_event", (e) => {
        try {
          const ev = JSON.parse(e.data);
          const pkt = addPacket(ev);
          setStats(s => ({ ...s, attacks: s.attacks + 1 }));
          setLastEventTs(ts => ts + 1);

          // Update live attacker IP on the node
          if (ev.sourceIp) setAttackerIp(ev.sourceIp);

          // Pulse attacker
          setPulseNodes(prev => new Set([...prev, "attacker"]));
           setTimeout(() => setPulseNodes(prev => { const n = new Set(prev); n.delete("attacker"); return n; }), 1400);

          const sev = ev.severity ?? "medium";
           setLog(prev => [{
             id: pkt.id, eventId: ev.id, ts: now(), tsMs: Date.now(),
            evType: ev.type ?? "unknown",
            severity: sev,
            srcIp: ev.sourceIp ?? "?",
            target: ev.targetHost ?? "?",
            desc: ev.description ?? "",
            defense: false,
             telegram: false,
            toolUsed: ev.toolUsed ?? undefined,
            signatureText: ev.signatureText ?? undefined,
          }, ...prev]);
        } catch { /* skip malformed */ }
      });

      es.addEventListener("defense_action", (e) => {
        try {
          const ev = JSON.parse(e.data);

          if (ev.status !== "executed") {
            setLog(prev => [{
              id: `defq-${ev.commandId ?? Date.now()}`, ts: now(), tsMs: Date.now(),
              evType: ev.action ?? "defense_queued", severity: "info",
              srcIp: ev.targetIp ?? "?", target: ev.targetHost ?? ev.targetVm ?? "?",
              desc: `Defense queued${ev.ruleName ? ` by ${ev.ruleName}` : ""}`,
              defense: true, telegram: false, ruleName: ev.ruleName ?? undefined,
            }, ...prev]);
            return;
          }

          // Block in-flight packets to this host
          const nowMs = Date.now();
          // Match in-flight packets whose *victim* (targetHost) or *attacker* (sourceIp)
          // corresponds to this defense action.  ev.targetHost = victim; ev.targetIp = attacker.
          setPackets(prev => prev.map(p =>
            (!p.blocked && (
              p.targetHost === ev.targetHost ||
              p.targetHost === ev.targetIp   ||   // legacy fallback
              p.sourceIp   === ev.targetIp        // if packet carries sourceIp later
            ))
              ? { ...p, blocked: true, blockedAt: nowMs }
              : p
          ));
          setStats(s => ({ ...s, blocked: s.blocked + 1 }));

          // Flash pfSense red
          setAlertNodes(prev => new Set([...prev, "pfsense"]));
          setTimeout(() => setAlertNodes(prev => { const n = new Set(prev); n.delete("pfsense"); return n; }), 2000);

          setLog(prev => [{
            id: `def-${Date.now()}`, ts: now(), tsMs: Date.now(),
            evType: ev.action ?? "block",
            severity: "info",
            srcIp: ev.targetIp ?? "?",
            target: ev.targetHost ?? "?",
            desc: ev.reason ?? "Defense executed",
            defense: true,
            telegram: false,
            ruleName: ev.ruleName ?? undefined,
          }, ...prev]);
        } catch { /* skip */ }
      });

      es.addEventListener("defense_result", (e) => {
        try {
          const ev = JSON.parse(e.data);
          const executed = ev.status === "executed";
          if (executed && ev.targetIp) {
            const nowMs = Date.now();
            setPackets(prev => prev.map(p => !p.blocked && p.sourceIp === ev.targetIp
              ? { ...p, blocked: true, blockedAt: nowMs } : p));
            setStats(s => ({ ...s, blocked: s.blocked + 1 }));
          }
          setLog(prev => [{
            id: `defr-${ev.commandId ?? Date.now()}`, ts: ev.timestamp ?? now(), tsMs: Date.now(),
            evType: executed ? "defense_executed" : "defense_failed",
            severity: executed ? "info" : "high", srcIp: ev.targetIp ?? "?",
            target: ev.commandType ?? "?",
            desc: executed ? "Defense command executed" : (ev.error ?? "Defense command failed"),
            defense: true, telegram: false,
          }, ...prev]);
        } catch { /* skip */ }
      });

      // ── Telegram alert notification (real SSE "alert" event) ──────────
      es.addEventListener("alert", (e) => {
        try {
          const ev = JSON.parse(e.data);
           const sev = ev.severity ?? "high";
           // Animate Telegram only when the server confirmed actual delivery.
           if ((sev !== "critical" && sev !== "high") || ev.telegramSent !== true) return;
          const toastId = `tg-${Date.now()}`;

          // 1. Mark latest high/critical entry in live feed
           setLog(prev => {
             const idx = ev.eventId
               ? prev.findIndex(l => l.eventId === ev.eventId)
               : -1;
            if (idx !== -1) {
              const next = [...prev];
              next[idx] = { ...next[idx], telegram: true };
              return next;
            }
            return [{
              id: toastId, ts: now(), tsMs: Date.now(),
              evType: "telegram_alert",
              severity: sev,
              srcIp: "AEGIS", target: "Telegram",
              desc: "Alert dispatched via Telegram",
              defense: false, telegram: true,
            }, ...prev];
          });

          // 2. Spawn animated packet: AEGIS → Telegram node
          const tgPkt: Packet = {
            id: toastId,
            path: ["aegis", "telegram"],
            seg: 0, t: 0,
             speed: 0.00035,
            blocked: false, blockedAt: 0,
            severity: sev,
            evType: "telegram",
            targetHost: "telegram",
            sourceIp: "aegis",
            isTg: true,
          };
          setPackets(prev => [...prev.slice(-40), tgPkt]);

          // 3. Pulse Telegram node for 1.2 s
          setPulseNodes(prev => new Set([...prev, "telegram"]));
           setTimeout(() => setPulseNodes(prev => { const n = new Set(prev); n.delete("telegram"); return n; }), 1600);

          // 4. Floating toast (auto-dismiss 4 s)
          setTgToasts(prev => [{ id: toastId, sev, ts: now() }, ...prev.slice(0, 3)]);
          setTimeout(() => setTgToasts(prev => prev.filter(t => t.id !== toastId)), 4000);

        } catch { /* skip */ }
      });

      es.onerror = () => {
        es.close();
        reconnect = setTimeout(connect, 4000);
      };
    }

    connect();
    return () => { es?.close(); clearTimeout(reconnect); };
  }, []);

  // ── Packet position ──────────────────────────────────────────────────────
  function pos(p: Packet) {
    const a = NODES[p.path[p.seg]];
    const b = NODES[p.path[p.seg + 1]];
    if (!a || !b) return { x: -100, y: -100 };
    return { x: a.x + (b.x - a.x) * p.t, y: a.y + (b.y - a.y) * p.t };
  }

  const liveCount    = packets.filter(p => !p.blocked).length;
  const blockedCount = packets.filter(p => p.blocked).length;

  // Compute which nodes have in-flight packets approaching (t > 0.6 in current segment)
  // Used to render ghost attacker IP indicators at the destination node.
  const nodeVisitors = new Map<NodeKey, { ip: string; severity: string }>();
  for (const p of packets) {
    if (!p.blocked && !p.isTg && p.t > 0.60) {
      const destKey = p.path[p.seg + 1] as NodeKey | undefined;
      if (destKey && !nodeVisitors.has(destKey)) {
        nodeVisitors.set(destKey, { ip: p.sourceIp || "?", severity: p.severity });
      }
    }
  }

  // ── Node attack glow: track which nodes are being actively hit ──────────
  // When a packet is in-transit toward a node, glow that node with attack color.
  // When t < 0.25 the source node also stays lit (packet just left).
  const nodeAttackColors = new Map<NodeKey, string>();
  for (const p of packets) {
    if (p.blocked || p.isTg) continue;
    const col = SEV_COLOR[p.severity] ?? "#f59e0b";
    // Current destination — glow as soon as packet sets off
    const dest = p.path[p.seg + 1] as NodeKey | undefined;
    if (dest && !nodeAttackColors.has(dest)) nodeAttackColors.set(dest, col);
    // Source node stays lit briefly after packet departs
    if (p.t < 0.28) {
      const src = p.path[p.seg] as NodeKey | undefined;
      if (src && !nodeAttackColors.has(src)) nodeAttackColors.set(src, col);
    }
  }

  return (
    <div className="flex h-full bg-background text-foreground overflow-hidden">

      {/* ── SVG canvas ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-card/40 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs font-mono text-green-400 font-bold tracking-wider">STREAMING</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <span className="text-xs font-mono text-muted-foreground">
            ATTACKS: <span className="text-red-400 font-bold">{stats.attacks}</span>
          </span>
          <span className="text-xs font-mono text-muted-foreground">
            BLOCKED: <span className="text-green-400 font-bold">{stats.blocked}</span>
          </span>
          <span className="text-xs font-mono text-muted-foreground">
            IN-FLIGHT: <span className="text-yellow-400 font-bold">{liveCount}</span>
          </span>
          <div className="flex-1" />
          <span className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest">
            AEGIS · Live Threat Map
          </span>
        </div>

        {/* SVG */}
        <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
          <svg
            viewBox={`0 0 ${VW} ${VH}`}
            className="w-full h-full"
            style={{ maxHeight: "calc(100vh - 10rem)" }}
          >
            <defs>
              {/* Grid */}
              <pattern id="af-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M40 0L0 0 0 40" fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth="1" />
              </pattern>
              {/* Glows per node colour */}
              {(Object.entries(NODES) as [NodeKey, typeof NODES[NodeKey]][]).map(([k, n]) => (
                <radialGradient key={k} id={`glow-${k}`} cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor={n.glow} />
                  <stop offset="100%" stopColor="transparent" />
                </radialGradient>
              ))}
              {/* Packet glow filter */}
              <filter id="pkt-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              {/* Blocked X marker */}
              <marker id="blocked-mark" markerWidth="6" markerHeight="6" refX="3" refY="3">
                <circle cx="3" cy="3" r="3" fill="#ef4444" />
              </marker>
            </defs>

            {/* Background */}
            <rect width={VW} height={VH} fill="rgba(5,8,20,0.95)" rx="8" />
            <rect width={VW} height={VH} fill="url(#af-grid)" rx="8" />

            {/* Zone labels */}
            <text x={16} y={20} fontSize="8" fill="rgba(239,68,68,0.35)" fontFamily="monospace" fontWeight="bold" letterSpacing="2">ORIGIN</text>
            <text x={308} y={20} fontSize="8" fill="rgba(245,158,11,0.35)" fontFamily="monospace" fontWeight="bold" letterSpacing="2">PERIMETER</text>
            <text x={490} y={20} fontSize="7" fill="rgba(34,197,94,0.30)" fontFamily="monospace" fontWeight="bold" letterSpacing="1">DMZ · PUBLIC</text>
            <text x={490} y={570} fontSize="7" fill="rgba(34,197,94,0.30)" fontFamily="monospace" fontWeight="bold" letterSpacing="1">INTERNAL</text>
            <text x={585} y={295} fontSize="7" fill="rgba(6,182,212,0.28)" fontFamily="monospace" fontWeight="bold" letterSpacing="1">MGMT</text>

            {/* Zone divider lines */}
            <line x1={285} y1={28} x2={285} y2={VH - 10} stroke="rgba(255,255,255,0.04)" strokeWidth="1" strokeDasharray="4 6" />
            <line x1={458} y1={28} x2={458} y2={VH - 10} stroke="rgba(255,255,255,0.04)" strokeWidth="1" strokeDasharray="4 6" />
            {/* Horizontal dividers inside VM zone */}
            <line x1={460} y1={215} x2={VW - 10} y2={215} stroke="rgba(255,255,255,0.03)" strokeWidth="1" strokeDasharray="3 8" />
            <line x1={460} y1={355} x2={VW - 10} y2={355} stroke="rgba(255,255,255,0.03)" strokeWidth="1" strokeDasharray="3 8" />

            {/* ── Attack / network topology edges (white dashed) ───────── */}
            {EDGES.map(([a, b]) => {
              const na = NODES[a], nb = NODES[b];
              return (
                <line
                  key={`e-${a}-${b}`}
                  x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                  stroke="rgba(255,255,255,0.10)"
                  strokeWidth="1.5"
                  strokeDasharray="6 5"
                />
              );
            })}

            {/* ── SSH management / reporting bus (cyan dotted) ─────────── */}
            {/* Forwarder SSH-tails logs from each VM; events flow VM → Forwarder → AEGIS */}
            {MGMT_EDGES.map(([a, b]) => {
              const na = NODES[a], nb = NODES[b];
              return (
                <g key={`me-${a}-${b}`}>
                  <line
                    x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                    stroke="rgba(6,182,212,0.22)"
                    strokeWidth="1.2"
                    strokeDasharray="2 5"
                  />
                </g>
              );
            })}

            {/* ── Notification edges (AEGIS → Telegram) — blue solid ─────── */}
            {NOTIFY_EDGES.map(([a, b]) => {
              const na = NODES[a], nb = NODES[b];
              return (
                <g key={`ne-${a}-${b}`}>
                  <line
                    x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                    stroke="rgba(41,182,246,0.18)"
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                  />
                  {/* mid-label */}
                  <text
                    x={(na.x + nb.x) / 2 + 6}
                    y={(na.y + nb.y) / 2 - 6}
                    fontSize="7" fill="rgba(41,182,246,0.45)"
                    fontFamily="monospace" textAnchor="middle"
                  >
                    NOTIFY
                  </text>
                </g>
              );
            })}

            {/* ── Packets ───────────────────────────────────────────────── */}
            {packets.map(p => {
              const { x, y } = pos(p);
              const col = p.isTg ? "#29b6f6" : p.blocked ? "#ef4444" : (SEV_COLOR[p.severity] ?? "#f59e0b");
              const r   = p.blocked ? 9 : 5;
              return (
                <g key={p.id} filter="url(#pkt-glow)">
                  {/* Outer glow */}
                  <circle cx={x} cy={y} r={r + 8} fill={col} opacity={0.12} />
                  {/* Core */}
                  <circle cx={x} cy={y} r={r} fill={col} opacity={p.blocked ? 0.6 : 1} />
                  {/* Label above */}
                  <text
                    x={x} y={y - r - 4}
                    textAnchor="middle"
                    fontSize="7"
                    fill={col}
                    fontFamily="monospace"
                    opacity={0.85}
                  >
                    {p.blocked ? "✕" : p.isTg ? "ALERT" : (p.sourceIp ? p.sourceIp.slice(-13) : p.evType.slice(0, 10))}
                  </text>
                </g>
              );
            })}

            {/* ── Nodes ─────────────────────────────────────────────────── */}
            {(Object.entries(NODES) as [NodeKey, typeof NODES[NodeKey]][]).map(([key, n]) => {
              const isAlert    = alertNodes.has(key);
              const isPulse    = pulseNodes.has(key);
              const attackCol  = nodeAttackColors.get(key);   // live attack glow color
              const strokeCol  = isAlert ? "#ef4444" : attackCol ?? n.color;
              const strokeW    = isAlert ? 2.5 : attackCol ? 2.0 : 1.5;

              return (
                <g key={key}>
                  {/* Ambient glow disc — brightened when under attack */}
                  <circle cx={n.x} cy={n.y} r={52} fill={`url(#glow-${key})`} opacity={isAlert ? 1.2 : attackCol ? 1.0 : 0.8} />
                  {/* Extra attack glow halo */}
                  {attackCol && !isAlert && (
                    <circle cx={n.x} cy={n.y} r={44} fill={attackCol} opacity={0.08} />
                  )}

                  {/* Pulse ring (animated) */}
                  {isPulse && (
                    <circle cx={n.x} cy={n.y} r={38} fill="none" stroke={strokeCol} strokeWidth="1.5" opacity="0.5">
                      <animate attributeName="r" from="34" to="58" dur="0.85s" repeatCount="indefinite" />
                      <animate attributeName="opacity" from="0.6" to="0" dur="0.85s" repeatCount="indefinite" />
                    </circle>
                  )}

                  {/* Attack pulse ring — shown while packet is en-route */}
                  {attackCol && !isAlert && !isPulse && (
                    <circle cx={n.x} cy={n.y} r={36} fill="none" stroke={attackCol} strokeWidth="1.2" opacity="0.4">
                      <animate attributeName="r" from="32" to="52" dur="1.1s" repeatCount="indefinite" />
                      <animate attributeName="opacity" from="0.5" to="0" dur="1.1s" repeatCount="indefinite" />
                    </circle>
                  )}

                  {/* Alert ring (defense block) */}
                  {isAlert && (
                    <>
                      <circle cx={n.x} cy={n.y} r={40} fill="none" stroke="#ef4444" strokeWidth="2" opacity="0.35">
                        <animate attributeName="r" from="36" to="50" dur="0.5s" repeatCount="indefinite" />
                        <animate attributeName="opacity" from="0.5" to="0" dur="0.5s" repeatCount="indefinite" />
                      </circle>
                    </>
                  )}

                  {/* Node card */}
                  <rect
                    x={n.x - 34} y={n.y - 34} width={68} height={68}
                    rx={12}
                    fill="rgba(8,12,28,0.92)"
                    stroke={strokeCol}
                    strokeWidth={strokeW}
                  />

                  {/* Icon */}
                  <NodeIcon nodeKey={key} x={n.x} y={n.y} color={strokeCol} />

                  {/* BLOCKED badge */}
                  {isAlert && (
                    <g>
                      <rect x={n.x - 28} y={n.y - 52} width={56} height={14} rx={3} fill="#7f1d1d" />
                      <text x={n.x} y={n.y - 44} textAnchor="middle" fontSize="7.5" fill="#fca5a5" fontFamily="monospace" fontWeight="bold">
                        ⛔ BLOCKED
                      </text>
                    </g>
                  )}

                  {/* Label block below node */}
                  <text x={n.x} y={n.y + 44} textAnchor="middle" fontSize="9.5" fill={strokeCol} fontFamily="monospace" fontWeight="bold">
                    {n.label}
                  </text>
                  <text x={n.x} y={n.y + 56} textAnchor="middle" fontSize="7.5" fill="rgba(255,255,255,0.38)" fontFamily="monospace">
                    {n.sub}
                  </text>
                  {/* Attacker node: show live Kali IP; others show static IP */}
                  {key === "attacker" ? (
                    <>
                      <text x={n.x} y={n.y + 67} textAnchor="middle" fontSize="7.5"
                        fill={attackerIp === "* / any" ? "rgba(255,255,255,0.2)" : "#ef4444"}
                        fontFamily="monospace" fontWeight={attackerIp === "* / any" ? "normal" : "bold"}>
                        {attackerIp}
                      </text>
                      {attackerIp !== "* / any" && (
                        <>
                          <rect x={n.x - 14} y={n.y + 71} width={28} height={9} rx={2} fill="rgba(239,68,68,0.15)" />
                          <text x={n.x} y={n.y + 78} textAnchor="middle" fontSize="6" fill="#ef4444"
                            fontFamily="monospace" fontWeight="bold" letterSpacing="1">
                            LIVE
                          </text>
                        </>
                      )}
                    </>
                  ) : (
                    <text x={n.x} y={n.y + 67} textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.2)" fontFamily="monospace">
                      {n.ip}
                    </text>
                  )}

                  {/* ── Ghost attacker indicator — shown when a packet is approaching this node ── */}
                  {nodeVisitors.has(key) && (() => {
                    const v = nodeVisitors.get(key)!;
                    const vc = SEV_COLOR[v.severity] ?? "#f59e0b";
                    return (
                      <g>
                        {/* Red pill behind node card (top-left corner) */}
                        <rect x={n.x - 34} y={n.y - 52} width={68} height={13} rx={3}
                          fill="rgba(239,68,68,0.12)" stroke="rgba(239,68,68,0.45)" strokeWidth="0.8" />
                        {/* Mini person silhouette */}
                        <circle cx={n.x - 22} cy={n.y - 47} r={3} fill="none" stroke="#ef4444" strokeWidth="1.2" />
                        <path
                          d={`M${n.x - 27},${n.y - 42} Q${n.x - 27},${n.y - 45} ${n.x - 22},${n.y - 45} Q${n.x - 17},${n.y - 45} ${n.x - 17},${n.y - 42}`}
                          fill="none" stroke="#ef4444" strokeWidth="1.2" strokeLinecap="round"
                        />
                        {/* Attacker IP */}
                        <text
                          x={n.x - 12} y={n.y - 43}
                          fontSize="6.5" fill={vc}
                          fontFamily="monospace" fontWeight="bold"
                        >
                          {v.ip.length > 14 ? v.ip.slice(-14) : v.ip}
                        </text>
                      </g>
                    );
                  })()}
                </g>
              );
            })}

            {/* Legend */}
            <g transform={`translate(16,${VH - 18})`}>
              {[
                { col: "#ef4444", label: "Critical" },
                { col: "#f97316", label: "High" },
                { col: "#f59e0b", label: "Medium" },
                { col: "#22c55e", label: "Low / Defense" },
                { col: "#06b6d4", label: "Info" },
              ].map((l, i) => (
                <g key={l.label} transform={`translate(${i * 115}, 0)`}>
                  <circle cx={5} cy={5} r={5} fill={l.col} opacity={0.9} />
                  <text x={14} y={9} fontSize="8" fill="rgba(255,255,255,0.4)" fontFamily="monospace">{l.label}</text>
                </g>
              ))}
            </g>

            {/* ── Telegram toast notifications on SVG canvas ─────────────── */}
            {tgToasts.map((t, i) => {
              const sevCol = t.sev === "critical" ? "#ef4444" : "#f97316";
              return (
                <g key={t.id} transform={`translate(${VW - 210}, ${40 + i * 52})`}>
                  <rect width={200} height={44} rx={6}
                    fill="rgba(0,10,25,0.92)"
                    stroke="#29b6f6"
                    strokeWidth="1.2"
                  />
                  {/* Blue left accent bar */}
                  <rect width={4} height={44} rx={2} fill="#29b6f6" />
                  {/* Telegram icon circle */}
                  <circle cx={20} cy={22} r={11} fill="rgba(0,136,204,0.2)" stroke="#29b6f6" strokeWidth="1" />
                  <text x={20} y={27} textAnchor="middle" fontSize="13">📱</text>
                  {/* Text */}
                  <text x={38} y={16} fontSize="8.5" fill="#29b6f6" fontFamily="monospace" fontWeight="bold">
                    TELEGRAM ALERT SENT
                  </text>
                  <text x={38} y={28} fontSize="8" fontFamily="monospace" fill={sevCol} fontWeight="bold">
                    {t.sev.toUpperCase()}
                  </text>
                  <text x={38} y={39} fontSize="7.5" fontFamily="monospace" fill="rgba(255,255,255,0.35)">
                    {t.ts}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* ── Right panel: Live Feed / Data Flow tabs ──────────────────────── */}
      <div className="w-72 shrink-0 border-l border-border flex flex-col bg-card/30">

        {/* Tab header */}
        <div className="px-2 py-1.5 border-b border-border flex items-center gap-1 shrink-0">
          <button
            onClick={() => setShowDataFlow(false)}
            className={`flex-1 text-[10px] font-mono font-bold py-1 px-2 rounded transition-colors ${
              !showDataFlow
                ? "bg-primary/20 text-primary border border-primary/30"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            ⚡ LIVE FEED
          </button>
          <button
            onClick={() => setShowDataFlow(true)}
            className={`flex-1 text-[10px] font-mono font-bold py-1 px-2 rounded transition-colors ${
              showDataFlow
                ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            🔄 DATA FLOW
          </button>
          {!showDataFlow && (
            <span className="text-[9px] font-mono text-muted-foreground pl-1 shrink-0">{log.length}</span>
          )}
        </div>

        {showDataFlow ? (
          <DataFlowDiagram lastEventTs={lastEventTs} />
        ) : log.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-[11px] font-mono text-muted-foreground text-center px-4">
              No events yet — monitoring active.
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
            {log.map(e => {
              const col = e.defense ? "#22c55e" : (SEV_COLOR[e.severity] ?? "#f59e0b");
              return (
                <div
                  key={e.id}
                   onClick={() => replayEntry(e)}
                   onKeyDown={(event) => {
                     if (!e.defense && (event.key === "Enter" || event.key === " ")) {
                       event.preventDefault();
                       replayEntry(e);
                     }
                   }}
                  title={e.defense ? "Defense log" : "Click to replay attack animation"}
                  role={e.defense ? undefined : "button"}
                  tabIndex={e.defense ? undefined : 0}
                  className="rounded px-2 py-1.5 text-[10px] font-mono space-y-0.5"
                  style={{
                    borderLeft: `2px solid ${col}`,
                    background: `${col}0d`,
                  }}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span style={{ color: col }} className="font-bold truncate max-w-[55%]">
                      {e.defense ? "🛡 DEFENSE" : "⚡ ATTACK"}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      {e.telegram && (
                        <span
                          className="text-[9px] font-mono font-bold px-1 rounded"
                          style={{ background: "rgba(0,136,204,0.2)", color: "#29b6f6", border: "1px solid rgba(0,136,204,0.35)" }}
                          title="Telegram alert sent"
                        >
                          📱 TG
                        </span>
                      )}
                      <span className="text-muted-foreground/60 text-[9px]">{e.ts}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap min-w-0">
                    {e.toolUsed && (
                      <span
                        className="text-[8px] px-1 rounded font-bold shrink-0"
                        style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.3)" }}
                      >
                        {e.toolUsed}
                      </span>
                    )}
                    <span className="text-white/75 truncate">{({
                        network_attack: "Network Attack",
                        web_attack:     "Web Attack",
                        ssh_brute:      "SSH Brute Force",
                        db_attack:      "DB Attack",
                        dns_attack:     "DNS Attack",
                        ldap_attack:    "LDAP Attack",
                        ldap_brute:     "LDAP Brute Force",
                        ldap_enum:      "LDAP Enumeration",
                        ddos:           "DDoS",
                        port_scan:      "Port Scan",
                        mitm:           "MitM / ARP Spoof",
                        auth_event:     "Auth Event",
                        api_attack:     "API Attack",
                      } as Record<string,string>)[e.evType] ?? e.evType.replace(/_/g," ").replace(/\b\w/g,(c:string)=>c.toUpperCase())}</span>
                  </div>
                  <div className="text-white/40 truncate">
                    <RdnsLabel ip={e.srcIp} /> <span className="opacity-50">→</span> {e.target}
                  </div>
                  {e.ruleName && (
                    <div className="text-[9px] font-bold truncate" style={{ color: "#4ade80" }}>
                      🛡 {e.ruleName}
                    </div>
                  )}
                  {e.signatureText && (
                    <div className="text-white/20 truncate text-[8.5px] font-mono">{e.signatureText}</div>
                  )}
                  {e.desc && !e.signatureText && (
                    <div className="text-white/25 truncate">{e.desc}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Reverse DNS label — fetches PTR record and shows hostname ─────────────────
const _rdnsMem = new Map<string, string>();

function RdnsLabel({ ip }: { ip: string }) {
  const [hostname, setHostname] = useState<string>(() => _rdnsMem.get(ip) ?? "");
  useEffect(() => {
    if (!ip || ip === "?" || ip === "AEGIS" || ip === "aegis") return;
    if (_rdnsMem.has(ip)) { setHostname(_rdnsMem.get(ip)!); return; }
    fetch(`${BASE}/api/rdns/${encodeURIComponent(ip)}`)
      .then(r => r.json())
      .then((d: { hostname: string }) => {
        const h = d.hostname && d.hostname !== ip ? d.hostname : "";
        _rdnsMem.set(ip, h);
        setHostname(h);
      })
      .catch(() => { _rdnsMem.set(ip, ""); });
  }, [ip]);

  return (
    <span className="font-mono text-cyan-400" title={hostname ? `${hostname} (${ip})` : ip}>
      {hostname || ip}
    </span>
  );
}

// ── Data Flow Diagram — explains the full sensor → dashboard pipeline ─────────
// Steps: VM Sensor → Forwarder → API Server → PostgreSQL → SSE Stream → Dashboard

const FLOW_STEPS = [
  {
    icon: "🖥",
    title: "VM Sensor",
    color: "#22c55e",
    lines: ["fail2ban", "ssh watcher", "BIND9 / slapd"],
    desc: "Company VMs တွင် log တွေကို real-time monitor လုပ်သည်",
  },
  {
    icon: "⬡",
    title: "Forwarder Hub",
    color: "#06b6d4",
    lines: ["SSH agent", "10.30.30.10", "log tailer"],
    desc: "VM log တွေကို SSH မှတဆင့် ဖတ်ပြီး API သို့ POST လုပ်သည်",
  },
  {
    icon: "⚡",
    title: "API Server",
    color: "#818cf8",
    lines: ["Express 5", "Node.js 20", "/ingest/*"],
    desc: "Event validate + DB save + auto-defense rule evaluate",
  },
  {
    icon: "🗄",
    title: "PostgreSQL",
    color: "#f59e0b",
    lines: ["Supabase", "Drizzle ORM", "security_events"],
    desc: "Event persistence — query, filter, 24h report မှ ဖတ်သည်",
  },
  {
    icon: "📡",
    title: "SSE Stream",
    color: "#a78bfa",
    lines: ["/api/events", "/stream", "text/event-stream"],
    desc: "DB save ပြီးနောက် broadcaster မှတဆင့် dashboard ကို push",
  },
  {
    icon: "📊",
    title: "Dashboard",
    color: "#06b6d4",
    lines: ["React + Vite", "EventSource", "Threat Map"],
    desc: "SSE event receive → packet animation → live feed update",
  },
] as const;

// ── SVG icons for each DataFlow step (no emoji) ──────────────────────────────
function FlowStepSvg({ index, color, active }: { index: number; color: string; active: boolean }) {
  const op = active ? 1 : 0.45;
  const s = color;
  switch (index) {
    // 0 – VM Sensor: monitor screen
    case 0:
      return (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style={{ opacity: op, flexShrink: 0 }}>
          <rect x="1" y="2" width="18" height="12" rx="2" stroke={s} strokeWidth="1.6" />
          <line x1="6" y1="14" x2="5" y2="18" stroke={s} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="14" y1="14" x2="15" y2="18" stroke={s} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="4" y1="18" x2="16" y2="18" stroke={s} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="1" y1="11" x2="19" y2="11" stroke={s} strokeWidth="1.2" />
          <circle cx="10" cy="6" r="2" fill={s} opacity="0.5" />
        </svg>
      );
    // 1 – Forwarder Hub: relay hub
    case 1:
      return (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style={{ opacity: op, flexShrink: 0 }}>
          <circle cx="10" cy="10" r="3" fill={s} opacity="0.3" />
          <circle cx="10" cy="10" r="3" stroke={s} strokeWidth="1.6" />
          <line x1="10" y1="7" x2="10" y2="1" stroke={s} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="10" y1="13" x2="10" y2="19" stroke={s} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="7" y1="10" x2="1" y2="10" stroke={s} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="13" y1="10" x2="19" y2="10" stroke={s} strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="10" cy="1" r="1.5" fill={s} />
          <circle cx="10" cy="19" r="1.5" fill={s} />
          <circle cx="1" cy="10" r="1.5" fill={s} />
          <circle cx="19" cy="10" r="1.5" fill={s} />
        </svg>
      );
    // 2 – API Server: lightning bolt
    case 2:
      return (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style={{ opacity: op, flexShrink: 0 }}>
          <path d="M12 1 L5 11 H10 L8 19 L15 9 H10 Z" stroke={s} strokeWidth="1.6" strokeLinejoin="round" fill={s} fillOpacity="0.15" />
        </svg>
      );
    // 3 – PostgreSQL: database cylinder
    case 3:
      return (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style={{ opacity: op, flexShrink: 0 }}>
          <ellipse cx="10" cy="4"  rx="8" ry="2.5" stroke={s} strokeWidth="1.5" />
          <ellipse cx="10" cy="10" rx="8" ry="2.5" stroke={s} strokeWidth="1.5" />
          <ellipse cx="10" cy="16" rx="8" ry="2.5" stroke={s} strokeWidth="1.5" />
          <line x1="2"  y1="4"  x2="2"  y2="16" stroke={s} strokeWidth="1.5" />
          <line x1="18" y1="4"  x2="18" y2="16" stroke={s} strokeWidth="1.5" />
        </svg>
      );
    // 4 – SSE Stream: broadcast waves
    case 4:
      return (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style={{ opacity: op, flexShrink: 0 }}>
          <circle cx="10" cy="13" r="2" fill={s} />
          <path d="M6 10 Q10 5 14 10" stroke={s} strokeWidth="1.6" strokeLinecap="round" fill="none" />
          <path d="M3 7 Q10 0 17 7"  stroke={s} strokeWidth="1.6" strokeLinecap="round" fill="none" />
          <line x1="10" y1="15" x2="10" y2="19" stroke={s} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    // 5 – Dashboard: bar chart on screen
    default:
      return (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style={{ opacity: op, flexShrink: 0 }}>
          <rect x="1" y="2" width="18" height="13" rx="2" stroke={s} strokeWidth="1.5" />
          <rect x="3"  y="10" width="2.5" height="4" fill={s} opacity="0.55" />
          <rect x="7"  y="7"  width="2.5" height="7" fill={s} opacity="0.55" />
          <rect x="11" y="9"  width="2.5" height="5" fill={s} opacity="0.55" />
          <rect x="15" y="5"  width="2.5" height="9" fill={s} opacity="0.55" />
          <line x1="7"  y1="15" x2="6"  y2="18" stroke={s} strokeWidth="1.3" strokeLinecap="round" />
          <line x1="13" y1="15" x2="14" y2="18" stroke={s} strokeWidth="1.3" strokeLinecap="round" />
          <line x1="4"  y1="18" x2="16" y2="18" stroke={s} strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
  }
}

// ── DataFlowDiagram — event-driven: lights up each stage as a real event flows ─
// lastEventTs increments each time a real SSE security_event arrives.
function DataFlowDiagram({ lastEventTs }: { lastEventTs: number }) {
  // activeStep = which pipeline stage is currently highlighted (-1 = idle)
  const [activeStep, setActiveStep] = useState(-1);
  // dotProgress = 0–1 progress of connector dot between stages
  const [dotProgress, setDotProgress] = useState(0);
  const animRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Kick off sequential stage animation whenever a new event arrives
  useEffect(() => {
    if (lastEventTs === 0) return; // skip initial mount

    // Clear any in-flight timers from previous event
    for (const t of animRef.current) clearTimeout(t);
    animRef.current = [];

    const STAGE_MS = 650; // ms each stage stays lit
    const timers: ReturnType<typeof setTimeout>[] = [];

    FLOW_STEPS.forEach((_, i) => {
      timers.push(setTimeout(() => {
        setActiveStep(i);
        setDotProgress(0);
        // Animate connector dot from 0→1 while this stage is active
        const DOT_TICKS = 20;
        for (let tick = 1; tick <= DOT_TICKS; tick++) {
          timers.push(setTimeout(() => setDotProgress(tick / DOT_TICKS), (tick / DOT_TICKS) * (STAGE_MS - 60)));
        }
      }, i * STAGE_MS));
    });

    // Return to idle after all stages complete
    timers.push(setTimeout(() => { setActiveStep(-1); setDotProgress(0); }, FLOW_STEPS.length * STAGE_MS + 200));

    animRef.current = timers;
    return () => { for (const t of animRef.current) clearTimeout(t); };
  }, [lastEventTs]);

  const isIdle = activeStep === -1;

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-0">
      {/* Title */}
      <div className="text-center mb-3">
        <p className="text-[10px] font-mono font-bold text-cyan-400 tracking-widest uppercase">
          Attack → Detection → Alert
        </p>
        <p className="text-[9px] text-muted-foreground mt-0.5 flex items-center justify-center gap-1.5">
          {isIdle ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 inline-block" />
              Waiting for events…
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse inline-block" />
              Live event flowing
            </>
          )}
        </p>
      </div>

      {FLOW_STEPS.map((step, i) => {
        const isActive = activeStep === i;
        const isDone   = activeStep > i;
        return (
          <div key={step.title}>
            {/* Step card */}
            <div
              className="rounded-lg p-2.5 border transition-all duration-200"
              style={{
                borderColor: isActive ? step.color : isDone ? `${step.color}40` : "rgba(255,255,255,0.08)",
                background:  isActive ? `${step.color}14` : "rgba(255,255,255,0.02)",
                boxShadow:   isActive ? `0 0 12px ${step.color}35` : "none",
              }}
            >
              <div className="flex items-start gap-2">
                <FlowStepSvg index={i} color={step.color} active={isActive || isDone} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span
                      className="text-[10px] font-mono font-bold transition-colors duration-200"
                      style={{ color: isActive ? step.color : isDone ? `${step.color}99` : "rgba(255,255,255,0.5)" }}
                    >
                      {step.title}
                    </span>
                    {isActive && (
                      <span
                        className="text-[8px] px-1 rounded font-bold animate-pulse"
                        style={{ background: `${step.color}25`, color: step.color, border: `1px solid ${step.color}50` }}
                      >
                        ACTIVE
                      </span>
                    )}
                    {isDone && (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5 L4 7 L8 3" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {step.lines.map(l => (
                      <span
                        key={l}
                        className="text-[8px] px-1 rounded font-mono"
                        style={{
                          background: isActive ? `${step.color}18` : "rgba(255,255,255,0.06)",
                          color: isActive ? step.color : "rgba(255,255,255,0.4)",
                          border: `1px solid ${isActive ? step.color + "40" : "rgba(255,255,255,0.1)"}`,
                        }}
                      >
                        {l}
                      </span>
                    ))}
                  </div>
                  <p className="text-[9px] text-muted-foreground/70 leading-relaxed">{step.desc}</p>
                </div>
              </div>
            </div>

            {/* Connector between steps with animated dot */}
            {i < FLOW_STEPS.length - 1 && (
              <div className="relative mx-4 my-1 h-4 flex items-center">
                <div className="w-full h-px" style={{ background: "rgba(255,255,255,0.07)" }} />
                {isActive && (
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
                    style={{
                      left: `${Math.round(dotProgress * 96)}%`,
                      background: step.color,
                      boxShadow: `0 0 6px ${step.color}, 0 0 12px ${step.color}80`,
                    }}
                  />
                )}
                <svg
                  className="absolute right-0"
                  width="8" height="8" viewBox="0 0 8 8"
                  style={{ opacity: isDone || isActive ? 0.5 : 0.2 }}
                >
                  <path d="M1 1 L7 4 L1 7" fill="none" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}
          </div>
        );
      })}

      {/* Severity legend */}
      <div className="mt-4 pt-3 border-t border-border/50">
        <p className="text-[9px] font-mono text-muted-foreground/60 mb-2 uppercase tracking-widest">Severity → Alert threshold</p>
        {[
          { sev: "Critical", col: "#ef4444", desc: "Telegram + DB + active alert" },
          { sev: "High",     col: "#f97316", desc: "Telegram + DB + active alert" },
          { sev: "Medium",   col: "#f59e0b", desc: "DB + active alert (no Telegram)" },
          { sev: "Low",      col: "#22c55e", desc: "DB only — event log မြင်ရသည်" },
        ].map(s => (
          <div key={s.sev} className="flex items-center gap-2 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.col }} />
            <span className="text-[9px] font-mono shrink-0" style={{ color: s.col, width: 44 }}>{s.sev}</span>
            <span className="text-[8.5px] text-muted-foreground/50 truncate">{s.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Node icon renderer — custom SVG paths per node type ───────────────────────
function NodeIcon({ nodeKey, x, y, color }: { nodeKey: NodeKey; x: number; y: number; color: string }) {
  const c = color;
  const s = 12; // half-size reference

  switch (nodeKey) {
    // 👤 Person silhouette — attacker
    case "attacker":
      return (
        <g transform={`translate(${x},${y - 2})`}>
          <circle cx={0} cy={-10} r={6} fill="none" stroke={c} strokeWidth="2" />
          <path d="M-10 10 Q-10 2 0 2 Q10 2 10 10" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" />
        </g>
      );

    // 🔀 Router box with ports — R1 MikroTik
    case "r1":
      return (
        <g transform={`translate(${x - s},${y - 10})`} fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round">
          {/* Router body */}
          <rect x={0} y={4} width={24} height={12} rx={2} />
          {/* Ports */}
          <rect x={3}  y={7} width={3} height={3} rx={0.5} fill={c} opacity={0.7} />
          <rect x={8}  y={7} width={3} height={3} rx={0.5} fill={c} opacity={0.7} />
          <rect x={13} y={7} width={3} height={3} rx={0.5} fill={c} opacity={0.7} />
          <rect x={18} y={7} width={3} height={3} rx={0.5} fill={c} opacity={0.7} />
          {/* Antenna */}
          <line x1={6}  y1={4} x2={4}  y2={-3} />
          <line x1={18} y1={4} x2={20} y2={-3} />
          <circle cx={4}  cy={-4} r={1.2} fill={c} />
          <circle cx={20} cy={-4} r={1.2} fill={c} />
        </g>
      );

    // 🛡 Shield — pfSense firewall
    case "pfsense":
      return (
        <g transform={`translate(${x},${y - 2})`} fill="none" stroke={c} strokeWidth="1.8">
          <path d="M0,-13 L11,-8 L11,2 Q11,10 0,14 Q-11,10 -11,2 L-11,-8 Z" />
          <path d="M-4,0 L-1,4 L5,-4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );

    // 🖥 Server/monitor — company-web-server
    case "companyweb":
      return (
        <g transform={`translate(${x - 11},${y - 13})`} fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round">
          <rect x={0} y={0} width={22} height={15} rx={2} />
          <line x1={7} y1={15} x2={5}  y2={20} />
          <line x1={15} y1={15} x2={17} y2={20} />
          <line x1={3} y1={20} x2={19} y2={20} />
          <line x1={0} y1={11} x2={22} y2={11} />
          <circle cx={11} cy={5} r={2} fill={c} opacity={0.6} />
        </g>
      );

    // 📡 Relay hub — aegis-forwarder
    case "forwarder":
      return (
        <g transform={`translate(${x},${y - 2})`} fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round">
          {/* Center node */}
          <circle cx={0} cy={0} r={4} fill={c} opacity={0.3} />
          <circle cx={0} cy={0} r={4} />
          {/* Radiating lines */}
          <line x1={0}    y1={-4}  x2={0}    y2={-11} />
          <line x1={0}    y1={4}   x2={0}    y2={11}  />
          <line x1={-4}   y1={0}   x2={-11}  y2={0}   />
          <line x1={4}    y1={0}   x2={11}   y2={0}   />
          {/* End dots */}
          <circle cx={0}   cy={-11} r={1.8} fill={c} />
          <circle cx={0}   cy={11}  r={1.8} fill={c} />
          <circle cx={-11} cy={0}   r={1.8} fill={c} />
          <circle cx={11}  cy={0}   r={1.8} fill={c} />
        </g>
      );

    // 🗄 Database stack — company-customer-db
    case "customerdb":
      return (
        <g transform={`translate(${x - 9},${y - 13})`} fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round">
          <ellipse cx={9} cy={3}  rx={9} ry={3} />
          <ellipse cx={9} cy={10} rx={9} ry={3} />
          <ellipse cx={9} cy={17} rx={9} ry={3} />
          <line x1={0} y1={3}  x2={0}  y2={17} />
          <line x1={18} y1={3} x2={18} y2={17} />
        </g>
      );

    // 📊 Dashboard screen — AEGIS
    case "aegis":
      return (
        <g transform={`translate(${x - 12},${y - 12})`} fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round">
          <rect x={0} y={0} width={24} height={16} rx={2} />
          {/* Bar chart inside */}
          <rect x={3}  y={10} width={3} height={4} fill={c} opacity={0.5} />
          <rect x={8}  y={6}  width={3} height={8} fill={c} opacity={0.5} />
          <rect x={13} y={8}  width={3} height={6} fill={c} opacity={0.5} />
          <rect x={18} y={4}  width={3} height={10} fill={c} opacity={0.5} />
          {/* Stand */}
          <line x1={8}  y1={16} x2={6}  y2={22} />
          <line x1={16} y1={16} x2={18} y2={22} />
          <line x1={4}  y1={22} x2={20} y2={22} />
        </g>
      );

    // ✈ Paper plane — Telegram alert channel
    case "telegram":
      return (
        <g transform={`translate(${x},${y - 2})`} fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {/* Plane body */}
          <path d="M-13,0 L13,-6 L5,12 L-1,5 Z" />
          {/* Wing fold line */}
          <line x1={-1} y1={5} x2={5} y2={-2} />
          {/* Signal dots */}
          <circle cx={10}  cy={-11} r={1.5} fill={c} opacity={0.7} />
          <circle cx={13}  cy={-11} r={1.5} fill={c} opacity={0.5} />
          <circle cx={16}  cy={-11} r={1.5} fill={c} opacity={0.3} />
        </g>
      );

    // 🌐 Globe with meridians — dns-server (BIND9)
    case "dnsserver":
      return (
        <g transform={`translate(${x},${y - 2})`} fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round">
          {/* Globe outline */}
          <circle cx={0} cy={0} r={11} />
          {/* Central meridian ellipse */}
          <ellipse cx={0} cy={0} rx={5} ry={11} />
          {/* Latitude bands */}
          <path d={`M-${Math.round(11 * Math.sin(Math.acos(4/11)))},${-4} Q0,${-4 * 1.15} ${Math.round(11 * Math.sin(Math.acos(4/11)))},${-4}`} />
          <path d={`M-${Math.round(11 * Math.sin(Math.acos(4/11)))},${4}  Q0,${4  * 1.15} ${Math.round(11 * Math.sin(Math.acos(4/11)))},${4}`}  />
          {/* Top/bottom poles */}
          <line x1={-9} y1={-5} x2={9} y2={-5} strokeWidth="1" opacity="0.5" />
          <line x1={-9} y1={5}  x2={9} y2={5}  strokeWidth="1" opacity="0.5" />
        </g>
      );

    // 📖 Directory book with person — ldap-server (OpenLDAP)
    case "ldapserver":
      return (
        <g transform={`translate(${x},${y - 2})`} fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round">
          {/* Book body */}
          <rect x={-11} y={-4} width={18} height={14} rx={2} />
          {/* Book spine */}
          <line x1={-11} y1={-4} x2={-11} y2={10} strokeWidth="3.5" strokeLinecap="butt" />
          {/* Page lines */}
          <line x1={-7} y1={0}  x2={5} y2={0}  strokeWidth="1.2" />
          <line x1={-7} y1={3}  x2={5} y2={3}  strokeWidth="1.2" />
          <line x1={-7} y1={6}  x2={2} y2={6}  strokeWidth="1.2" />
          {/* Person head (directory entry) */}
          <circle cx={10} cy={-9} r={4} />
          {/* Person shoulders */}
          <path d="M4,-5 Q4,-2 10,-2 Q16,-2 16,-5" strokeLinecap="round" />
        </g>
      );

    default:
      return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function now() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function toLogEntry(entry: StoredLiveFeedEntry): LogEntry {
  return {
    id: entry.id,
    eventId: entry.eventId,
    ts: new Date(entry.createdAt).toLocaleTimeString("en-US", { hour12: false }),
    tsMs: Date.parse(entry.createdAt) || Date.now(),
    evType: entry.evType,
    severity: entry.severity,
    srcIp: entry.srcIp,
    target: entry.target,
    desc: entry.desc,
    defense: entry.defense,
    telegram: entry.telegram,
    toolUsed: entry.toolUsed,
    signatureText: entry.signatureText,
    ruleName: entry.ruleName,
  };
}
