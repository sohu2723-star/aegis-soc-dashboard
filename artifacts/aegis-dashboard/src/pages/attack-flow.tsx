import { useEffect, useRef, useState, useCallback } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Canvas dimensions ─────────────────────────────────────────────────────────
const VW = 960;
const VH = 520;

// ── Node definitions — real lab topology (v4 simplified) ─────────────────────
// Path: Attacker → R1 → pfSense (OVS switches) → bank-web / dns-server / customer-db / atm-server
//       → MGMT: aegis-forwarder (10.30.30.10) → AEGIS Dashboard
const NODES = {
  attacker: {
    x: 55,  y: 260,
    label: "Attacker", sub: "Any Source IP",
    ip: "* / any",
    color: "#ef4444", glow: "rgba(239,68,68,0.4)",
    icon: "👤",
  },
  r1: {
    x: 205, y: 260,
    label: "R1 Router", sub: "MikroTik CHR",
    ip: "192.168.122.2",
    color: "#818cf8", glow: "rgba(129,140,248,0.3)",
    icon: "⬡",
  },
  pfsense: {
    x: 380, y: 260,
    label: "pfSense", sub: "Firewall / OVS",
    ip: "10.0.23.2",
    color: "#f59e0b", glow: "rgba(245,158,11,0.45)",
    icon: "🛡",
  },
  bankweb: {
    x: 570, y: 80,
    label: "bank-web", sub: "Apache · Fail2ban",
    ip: "10.10.10.10 (Public)",
    color: "#22c55e", glow: "rgba(34,197,94,0.3)",
    icon: "🖥",
  },
  dnsserver: {
    x: 570, y: 190,
    label: "dns-server", sub: "BIND9 · DNS",
    ip: "10.10.10.20 (Public)",
    color: "#22c55e", glow: "rgba(34,197,94,0.3)",
    icon: "🌐",
  },
  forwarder: {
    x: 570, y: 300,
    label: "aegis-forwarder", sub: "Hub · SSH agent",
    ip: "10.30.30.10 (MGMT)",
    color: "#06b6d4", glow: "rgba(6,182,212,0.3)",
    icon: "⬡",
  },
  customerdb: {
    x: 570, y: 400,
    label: "customer-db", sub: "PostgreSQL",
    ip: "10.20.20.10 (Internal)",
    color: "#22c55e", glow: "rgba(34,197,94,0.3)",
    icon: "🗄",
  },
  atmserver: {
    x: 570, y: 490,
    label: "atm-server", sub: "Flask ATM API",
    ip: "10.20.20.20 (Internal)",
    color: "#22c55e", glow: "rgba(34,197,94,0.3)",
    icon: "🏧",
  },
  aegis: {
    x: 790, y: 300,
    label: "AEGIS", sub: "SOC Dashboard",
    ip: "Render · Vercel",
    color: "#06b6d4", glow: "rgba(6,182,212,0.25)",
    icon: "📊",
  },
  telegram: {
    x: 900, y: 450,
    label: "Telegram", sub: "Alert Channel",
    ip: "api.telegram.org",
    color: "#29b6f6", glow: "rgba(41,182,246,0.4)",
    icon: "📱",
  },
} as const;

type NodeKey = keyof typeof NODES;

// ── Edges — exact lab connections only ────────────────────────────────────────
const EDGES: [NodeKey, NodeKey][] = [
  ["attacker",  "r1"],         // Attacker → R1 ether1 (192.168.122.x)
  ["r1",        "pfsense"],    // R1 ether3 (10.0.23.1) → pfSense WAN (10.0.23.2)
  ["pfsense",   "bankweb"],    // pfSense → Public-Switch → bank-web (10.10.10.10)
  ["pfsense",   "dnsserver"],  // pfSense → Public-Switch → dns-server (10.10.10.20)
  ["pfsense",   "forwarder"],  // pfSense MGMT → aegis-forwarder (10.30.30.10)
  ["pfsense",   "customerdb"], // pfSense → Internal-Switch → customer-db (10.20.20.10)
  ["pfsense",   "atmserver"],  // pfSense → Internal-Switch → atm-server (10.20.20.20)
  ["forwarder", "aegis"],      // aegis-forwarder → AEGIS Dashboard (via Render API)
];

// ── Notification edges — AEGIS → Telegram (alert channel, styled differently) ─
const NOTIFY_EDGES: [NodeKey, NodeKey][] = [
  ["aegis", "telegram"],
];

// ── Attack path routing ────────────────────────────────────────────────────────
function getAttackPath(targetHost: string | null | undefined): NodeKey[] {
  const t = (targetHost ?? "").toLowerCase();
  if (t.includes("bank") || t.includes("web") || t === "10.10.10.10" || t.includes("apache") || t.includes("dvwa")) {
    return ["attacker", "r1", "pfsense", "bankweb"];
  }
  if (t.includes("dns") || t === "10.10.10.20" || t.includes("bind")) {
    return ["attacker", "r1", "pfsense", "dnsserver"];
  }
  if (t.includes("atm") || t === "10.20.20.20" || t.includes("flask")) {
    return ["attacker", "r1", "pfsense", "atmserver"];
  }
  if (t.includes("db") || t.includes("customer") || t === "10.20.20.10" || t.includes("postgres") || t.includes("sql")) {
    return ["attacker", "r1", "pfsense", "customerdb"];
  }
  return ["attacker", "r1", "pfsense"];
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
  ts: string;
  evType: string;
  severity: string;
  srcIp: string;
  target: string;
  desc: string;
  defense: boolean;
  telegram: boolean;   // true = Telegram alert was sent for this event
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AttackFlowPage() {
  const [packets, setPackets]       = useState<Packet[]>([]);
  const [log, setLog]               = useState<LogEntry[]>([]);
  const [alertNodes, setAlertNodes] = useState<Set<NodeKey>>(new Set());  // red border flash
  const [pulseNodes, setPulseNodes] = useState<Set<NodeKey>>(new Set());  // expanding ring
  const [stats, setStats]           = useState({ attacks: 0, blocked: 0 });
  const [tgToasts, setTgToasts]     = useState<{ id: string; sev: string; ts: string }[]>([]);
  // Dynamic attacker IP — updated live from incoming security_event sourceIp
  const [attackerIp, setAttackerIp] = useState<string>("* / any");

  const rafRef      = useRef<number | null>(null);
  const prevNowRef  = useRef<number>(0);

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

  // ── SSE connection ───────────────────────────────────────────────────────
  useEffect(() => {
    let es: EventSource;
    let reconnect: ReturnType<typeof setTimeout>;

    function connect() {
      es = new EventSource(`${BASE}/api/events/stream`);

      es.addEventListener("security_event", (e) => {
        try {
          const ev = JSON.parse(e.data);
          const path = getAttackPath(ev.targetHost);

          const pkt: Packet = {
            id: `pkt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            path,
            seg: 0,
            t: 0,
            speed: 0.00045 + Math.random() * 0.00025,
            blocked: false,
            blockedAt: 0,
            severity: ev.severity ?? "medium",
            evType: ev.type ?? "unknown",
            targetHost: ev.targetHost ?? "",
            sourceIp: ev.sourceIp ?? "",
          };

          setPackets(prev => [...prev.slice(-40), pkt]);
          setStats(s => ({ ...s, attacks: s.attacks + 1 }));

          // Update live attacker IP on the node
          if (ev.sourceIp) setAttackerIp(ev.sourceIp);

          // Pulse attacker
          setPulseNodes(prev => new Set([...prev, "attacker"]));
          setTimeout(() => setPulseNodes(prev => { const n = new Set(prev); n.delete("attacker"); return n; }), 900);

          const sev = ev.severity ?? "medium";
          setLog(prev => [{
            id: pkt.id, ts: now(),
            evType: ev.type ?? "unknown",
            severity: sev,
            srcIp: ev.sourceIp ?? "?",
            target: ev.targetHost ?? "?",
            desc: ev.description ?? "",
            defense: false,
            telegram: sev === "critical" || sev === "high",
          }, ...prev].slice(0, 60));
        } catch { /* skip malformed */ }
      });

      es.addEventListener("defense_action", (e) => {
        try {
          const ev = JSON.parse(e.data);

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
            id: `def-${Date.now()}`, ts: now(),
            evType: ev.action ?? "block",
            severity: "info",
            srcIp: ev.targetIp ?? "?",
            target: ev.targetHost ?? "?",
            desc: ev.reason ?? "Defense executed",
            defense: true,
            telegram: false,
          }, ...prev].slice(0, 60));
        } catch { /* skip */ }
      });

      // ── Telegram alert notification (real SSE "alert" event) ──────────
      es.addEventListener("alert", (e) => {
        try {
          const ev = JSON.parse(e.data);
          const sev = ev.severity ?? "high";
          const toastId = `tg-${Date.now()}`;

          // 1. Mark latest high/critical entry in live feed
          setLog(prev => {
            const idx = prev.findIndex(l => !l.telegram && (l.severity === "critical" || l.severity === "high"));
            if (idx !== -1) {
              const next = [...prev];
              next[idx] = { ...next[idx], telegram: true };
              return next;
            }
            return [{
              id: toastId, ts: now(),
              evType: "telegram_alert",
              severity: sev,
              srcIp: "AEGIS", target: "Telegram",
              desc: "Alert dispatched via Telegram",
              defense: false, telegram: true,
            }, ...prev].slice(0, 60);
          });

          // 2. Spawn animated packet: AEGIS → Telegram node
          const tgPkt: Packet = {
            id: toastId,
            path: ["aegis", "telegram"],
            seg: 0, t: 0,
            speed: 0.0008,           // faster — short hop
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
          setTimeout(() => setPulseNodes(prev => { const n = new Set(prev); n.delete("telegram"); return n; }), 1200);

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
            <text x={16} y={22} fontSize="8" fill="rgba(239,68,68,0.35)" fontFamily="monospace" fontWeight="bold" letterSpacing="2">
              ORIGIN
            </text>
            <text x={400} y={22} fontSize="8" fill="rgba(245,158,11,0.35)" fontFamily="monospace" fontWeight="bold" letterSpacing="2">
              PERIMETER DEFENSE
            </text>
            <text x={620} y={22} fontSize="8" fill="rgba(34,197,94,0.35)" fontFamily="monospace" fontWeight="bold" letterSpacing="2">
              PROTECTED ZONE
            </text>

            {/* Zone divider lines */}
            <line x1={330} y1={30} x2={330} y2={VH - 20} stroke="rgba(255,255,255,0.04)" strokeWidth="1" strokeDasharray="4 6" />
            <line x1={590} y1={30} x2={590} y2={VH - 20} stroke="rgba(255,255,255,0.04)" strokeWidth="1" strokeDasharray="4 6" />

            {/* ── Edges ─────────────────────────────────────────────────── */}
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
                    {p.blocked ? "✕" : p.evType.slice(0, 10)}
                  </text>
                </g>
              );
            })}

            {/* ── Nodes ─────────────────────────────────────────────────── */}
            {(Object.entries(NODES) as [NodeKey, typeof NODES[NodeKey]][]).map(([key, n]) => {
              const isAlert = alertNodes.has(key);
              const isPulse = pulseNodes.has(key);
              const strokeCol = isAlert ? "#ef4444" : n.color;
              const strokeW   = isAlert ? 2.5 : 1.5;

              return (
                <g key={key}>
                  {/* Ambient glow disc */}
                  <circle cx={n.x} cy={n.y} r={52} fill={`url(#glow-${key})`} opacity={isAlert ? 1.2 : 0.8} />

                  {/* Pulse ring (animated) */}
                  {isPulse && (
                    <circle cx={n.x} cy={n.y} r={38} fill="none" stroke={strokeCol} strokeWidth="1.5" opacity="0.5">
                      <animate attributeName="r" from="34" to="58" dur="0.85s" repeatCount="indefinite" />
                      <animate attributeName="opacity" from="0.6" to="0" dur="0.85s" repeatCount="indefinite" />
                    </circle>
                  )}

                  {/* Alert ring */}
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
                </g>
              );
            })}

            {/* Legend */}
            <g transform={`translate(16,${VH - 30})`}>
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

      {/* ── Event log panel ──────────────────────────────────────────────── */}
      <div className="w-72 shrink-0 border-l border-border flex flex-col bg-card/30">
        <div className="px-3 py-2.5 border-b border-border flex items-center justify-between shrink-0">
          <span className="text-[11px] font-mono font-bold text-primary tracking-widest uppercase">
            Live Feed
          </span>
          <span className="text-[9px] font-mono text-muted-foreground">{log.length} events</span>
        </div>

        {log.length === 0 ? (
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
                  <div className="text-white/75 truncate">{e.evType}</div>
                  <div className="text-white/40 truncate">
                    {e.srcIp} <span className="opacity-50">→</span> {e.target}
                  </div>
                  {e.desc && (
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

    // 🖥 Server/monitor — bank-web
    case "bankweb":
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

    // 🗄 Database stack — customer-db
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

    default:
      return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function now() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}
