import { useEffect, useRef, useState, useCallback } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Canvas dimensions ─────────────────────────────────────────────────────────
const VW = 960;
const VH = 520;

// ── Node definitions (matches real lab topology) ──────────────────────────────
const NODES = {
  kali: {
    x: 80,  y: 260,
    label: "Kali Linux", sub: "Attacker",
    ip: "192.168.122.132",
    color: "#ef4444", glow: "rgba(239,68,68,0.4)",
    icon: "👤",
  },
  internet: {
    x: 270, y: 110,
    label: "ISP / Internet", sub: "R1 · R2 Transit",
    ip: "192.168.122.0/24",
    color: "#818cf8", glow: "rgba(129,140,248,0.3)",
    icon: "🌐",
  },
  pfsense: {
    x: 460, y: 260,
    label: "pfSense", sub: "Suricata IDS",
    ip: "10.0.23.2",
    color: "#f59e0b", glow: "rgba(245,158,11,0.4)",
    icon: "🛡",
  },
  bankweb: {
    x: 680, y: 130,
    label: "bank-web", sub: "Apache · Fail2ban",
    ip: "10.10.10.10",
    color: "#22c55e", glow: "rgba(34,197,94,0.3)",
    icon: "🖥",
  },
  customerdb: {
    x: 680, y: 390,
    label: "customer-db", sub: "PostgreSQL",
    ip: "10.20.20.20",
    color: "#22c55e", glow: "rgba(34,197,94,0.3)",
    icon: "🗄",
  },
  aegis: {
    x: 870, y: 260,
    label: "AEGIS", sub: "Dashboard",
    ip: "10.30.30.10",
    color: "#06b6d4", glow: "rgba(6,182,212,0.3)",
    icon: "📊",
  },
} as const;

type NodeKey = keyof typeof NODES;

// ── Edges ─────────────────────────────────────────────────────────────────────
const EDGES: [NodeKey, NodeKey][] = [
  ["kali", "internet"],
  ["kali", "pfsense"],
  ["internet", "pfsense"],
  ["pfsense", "bankweb"],
  ["pfsense", "customerdb"],
  ["bankweb", "aegis"],
  ["customerdb", "aegis"],
];

// ── Attack path routing ────────────────────────────────────────────────────────
function getAttackPath(targetHost: string | null | undefined): NodeKey[] {
  const t = (targetHost ?? "").toLowerCase();
  if (t.includes("bank") || t.includes("web") || t === "10.10.10.10" || t.includes("apache") || t.includes("ftp")) {
    return ["kali", "internet", "pfsense", "bankweb"];
  }
  if (t.includes("db") || t.includes("customer") || t === "10.20.20.20" || t.includes("postgres")) {
    return ["kali", "internet", "pfsense", "customerdb"];
  }
  return ["kali", "internet", "pfsense"];
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
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AttackFlowPage() {
  const [packets, setPackets]       = useState<Packet[]>([]);
  const [log, setLog]               = useState<LogEntry[]>([]);
  const [alertNodes, setAlertNodes] = useState<Set<NodeKey>>(new Set());  // red border flash
  const [pulseNodes, setPulseNodes] = useState<Set<NodeKey>>(new Set());  // expanding ring
  const [stats, setStats]           = useState({ attacks: 0, blocked: 0 });

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
          };

          setPackets(prev => [...prev.slice(-40), pkt]);
          setStats(s => ({ ...s, attacks: s.attacks + 1 }));

          // Pulse attacker
          setPulseNodes(prev => new Set([...prev, "kali"]));
          setTimeout(() => setPulseNodes(prev => { const n = new Set(prev); n.delete("kali"); return n; }), 900);

          setLog(prev => [{
            id: pkt.id, ts: now(),
            evType: ev.type ?? "unknown",
            severity: ev.severity ?? "medium",
            srcIp: ev.sourceIp ?? "?",
            target: ev.targetHost ?? "?",
            desc: ev.description ?? "",
            defense: false,
          }, ...prev].slice(0, 60));
        } catch { /* skip malformed */ }
      });

      es.addEventListener("defense_action", (e) => {
        try {
          const ev = JSON.parse(e.data);

          // Block in-flight packets to this host
          const nowMs = Date.now();
          setPackets(prev => prev.map(p =>
            (!p.blocked && (p.targetHost === ev.targetIp || p.targetHost === ev.targetHost))
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
          }, ...prev].slice(0, 60));
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
            <span className="text-xs font-mono text-green-400 font-bold tracking-wider">SSE LIVE</span>
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
            AEGIS · Live Attack Flow · Lab Preview
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
              ATTACK ORIGIN
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

            {/* ── Packets ───────────────────────────────────────────────── */}
            {packets.map(p => {
              const { x, y } = pos(p);
              const col = p.blocked ? "#ef4444" : (SEV_COLOR[p.severity] ?? "#f59e0b");
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
                  <text x={n.x} y={n.y + 9} textAnchor="middle" fontSize="26" dominantBaseline="middle">
                    {n.icon}
                  </text>

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
                  <text x={n.x} y={n.y + 67} textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.2)" fontFamily="monospace">
                    {n.ip}
                  </text>
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
              Waiting for events from lab VMs…<br />
              <span className="opacity-50">Start an attack or run aegis_forwarder.py</span>
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
                  <div className="flex items-center justify-between">
                    <span style={{ color: col }} className="font-bold truncate max-w-[60%]">
                      {e.defense ? "🛡 DEFENSE" : "⚡ ATTACK"}
                    </span>
                    <span className="text-muted-foreground/60 shrink-0">{e.ts}</span>
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function now() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}
