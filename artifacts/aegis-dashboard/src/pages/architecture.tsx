import { useState } from "react";
import { X, ChevronRight, ArrowDown } from "lucide-react";

interface BlockDetail {
  id: string;
  title: string;
  subtitle: string;
  color: string;
  borderColor: string;
  bgColor: string;
  textColor: string;
  subBlocks: { name: string; tools: string[]; color: string }[];
  workflow: { step: number; action: string; detail: string; arrow?: boolean }[];
  description: string;
}

const BLOCKS: BlockDetail[] = [
  {
    id: "attacker",
    title: "Attacker Zone",
    subtitle: "Kali Linux VM — 192.168.122.153",
    color: "#ef4444",
    borderColor: "border-red-500",
    bgColor: "bg-red-950/40",
    textColor: "text-red-400",
    subBlocks: [
      { name: "Web Attacks", tools: ["SQLi", "XSS", "CSRF", "Nikto", "SQLmap", "Dirb", "Gobuster"], color: "border-red-400/50 bg-red-900/30" },
      { name: "Network Attacks", tools: ["Port Scan (nmap)", "DDoS (hping3)", "ARP Spoof", "MITM", "Wireshark"], color: "border-red-400/50 bg-red-900/30" },
      { name: "Credential Attacks", tools: ["Hydra", "SSH Brute Force", "FTP Brute Force", "Medusa", "Metasploit"], color: "border-red-400/50 bg-red-900/30" },
    ],
    workflow: [
      { step: 1, action: "Reconnaissance", detail: "nmap -sV -A 10.10.10.10 — Port scan, OS detection, service version" },
      { step: 2, action: "Vulnerability Scan", detail: "nikto -h http://10.10.10.10 — Web vulnerability scanning" },
      { step: 3, action: "Exploitation", detail: "sqlmap -u 'http://10.10.10.10/login?id=1' --batch — SQL injection attack" },
      { step: 4, action: "Brute Force", detail: "hydra -l root -P rockyou.txt ssh://10.10.10.10 — SSH password attack on Ubuntu VM" },
      { step: 5, action: "Network Attack", detail: "hping3 --flood -S 10.10.10.10 — SYN flood DDoS attack on Ubuntu VM" },
      { step: 6, action: "ARP Spoofing", detail: "arpspoof -i eth0 -t 10.10.10.10 192.168.122.1 — MITM positioning" },
      { step: 7, action: "FTP Attack", detail: "medusa -u admin -P wordlist.txt -h 10.10.10.10 -M ftp — FTP brute force" },
    ],
    description: "Red Team လုပ်ဆောင်ချက်တွေ — Kali Linux (192.168.122.153) မှ attack vector အမျိုးမျိုးသုံးပြီး Ubuntu VM (10.10.10.10) ကို attack လုပ်သည်"
  },
  {
    id: "defense",
    title: "AEGIS Defense Perimeter",
    subtitle: "Ubuntu VM (10.10.10.10) — IDS/IPS/Honeypot Layer",
    color: "#22c55e",
    borderColor: "border-green-500",
    bgColor: "bg-green-950/40",
    textColor: "text-green-400",
    subBlocks: [
      { name: "IDS/IPS", tools: ["Snort", "Suricata", "Auto Block IP", "iptables DROP", "Rule-based Detection"], color: "border-green-400/50 bg-green-900/30" },
      { name: "Encryption", tools: ["AES-256", "RSA-2048", "PKI", "TLS/SSL", "Data Protection"], color: "border-green-400/50 bg-green-900/30" },
    ],
    workflow: [
      { step: 1, action: "Packet Capture", detail: "Suricata monitors network interface — captures all incoming/outgoing packets" },
      { step: 2, action: "Signature Match", detail: "Compare packet against 30,000+ Suricata rules — ET Open ruleset" },
      { step: 3, action: "Alert Generate", detail: "Match found → write to /var/log/suricata/eve.json — EVE JSON format" },
      { step: 4, action: "Auto Block", detail: "Fail2ban reads auth.log → 5 failed SSH attempts → iptables -A INPUT -s ATTACKER_IP -j DROP" },
      { step: 5, action: "Forwarder Sends", detail: "aegis_forwarder.py reads logs → POST /api/ingest/suricata with X-AEGIS-Key header" },
      { step: 6, action: "Dashboard Update", detail: "API stores to PostgreSQL → SSE broadcasts → Dashboard live update" },
    ],
    description: "Blue Team defense layer — Attack ဝင်လာတာကို detect, block, trap လုပ်ပြီး AEGIS Brain ဆီ log ပို့သည်"
  },
  {
    id: "brain",
    title: "AEGIS Brain",
    subtitle: "SOC Engine — Log Analysis & Response",
    color: "#818cf8",
    borderColor: "border-indigo-400",
    bgColor: "bg-indigo-950/40",
    textColor: "text-indigo-400",
    subBlocks: [
      { name: "PostgreSQL Database", tools: ["security_events", "network_hosts", "defense_actions", "incidents", "alerts", "Drizzle ORM"], color: "border-indigo-400/50 bg-indigo-900/30" },
      { name: "Auto-Defense Engine", tools: ["Rule Matching", "IP Block", "iptables command", "pfSense API", "Severity Scoring", "Auto Incident"], color: "border-indigo-400/50 bg-indigo-900/30" },
      { name: "Incident Response", tools: ["Incident Creation", "Severity Classification", "Alert Generation", "SSE Broadcast", "Admin Review"], color: "border-indigo-400/50 bg-indigo-900/30" },
    ],
    workflow: [
      { step: 1, action: "Log Ingest", detail: "Events arrive via POST /api/ingest/* — authenticated with X-AEGIS-Key header" },
      { step: 2, action: "Parse & Normalize", detail: "API parses Snort/Suricata/Fail2ban formats → normalized SecurityEvent object" },
      { step: 3, action: "Store to DB", detail: "INSERT INTO security_events → Supabase PostgreSQL via connection pooler (port 6543)" },
      { step: 4, action: "Auto-Defense Check", detail: "Event matches defense rule? → queue iptables/pfSense command → defense_agent.py picks up within 5s" },
      { step: 5, action: "Severity Score", detail: "Auto-classify: critical (exploit) / high (brute-force) / medium (scan) / low (probe)" },
      { step: 6, action: "Alert Generate", detail: "Critical/High events → auto-create Alert record → Active Alerts page badge update" },
      { step: 7, action: "SSE Broadcast", detail: "broadcaster.ts sends event to all connected dashboard clients → real-time update" },
      { step: 8, action: "Response Action", detail: "Admin reviews → Acknowledge / Resolve alert → manual block IP in Defense Center" },
    ],
    description: "AEGIS Dashboard ရဲ့ core engine — Events analyze, correlate, classify ပြီး team ကို alert ပေးသည်"
  },
  {
    id: "output",
    title: "Output & Intelligence",
    subtitle: "Real-time Visibility & Reporting",
    color: "#94a3b8",
    borderColor: "border-slate-400",
    bgColor: "bg-slate-900/40",
    textColor: "text-slate-300",
    subBlocks: [
      { name: "Live Dashboard", tools: ["Command Center", "Security Events", "Network Map", "Defense Center", "Real-time SSE"], color: "border-slate-400/50 bg-slate-800/30" },
      { name: "Telegram Alerts", tools: ["Bot Notifications", "Attack Alerts", "IP Block Alerts", "Admin Commands", "Real-time Push"], color: "border-slate-400/50 bg-slate-800/30" },
      { name: "Auto Reports", tools: ["PDF Export", "HTML Summary", "Event Statistics", "Incident Timeline", "Scheduled Reports"], color: "border-slate-400/50 bg-slate-800/30" },
    ],
    workflow: [
      { step: 1, action: "Live Dashboard", detail: "Browser connects to /api/events/stream via SSE → auto-refresh every 5-8s" },
      { step: 2, action: "Command Center", detail: "Total Events, Critical Threats, Active Alerts, Systems Online counters update live" },
      { step: 3, action: "Network Monitor", detail: "Network topology map, traffic chart (12h), connected hosts from VMs" },
      { step: 4, action: "Defense Center", detail: "Auto-block log (Fail2ban/Suricata) + Manual admin block/unblock IP form" },
      { step: 5, action: "Telegram Alert", detail: "Attack detected → Telegram Bot sends: 🚨 ALERT: SQLi from 192.168.122.153 → bank-web" },
      { step: 6, action: "Admin Commands", detail: "Admin replies to Telegram Bot: /block 192.168.122.153 → API auto-blocks IP" },
      { step: 7, action: "Report Generate", detail: "Reports page → Generate → PDF/HTML with event summary, incident count, top attackers" },
    ],
    description: "Security team ကို real-time visibility, instant alerts, detailed reports ပေးသည်"
  },
];

const FLOW_ARROWS = [
  { from: "Internet", to: "Attacker Zone", label: "HTTP/HTTPS/SSH/TCP packets" },
  { from: "Attacker Zone", to: "AEGIS Defense Perimeter", label: "Attack traffic → Network interface" },
  { from: "AEGIS Defense Perimeter", to: "AEGIS Brain", label: "Logs + Events via forwarder script" },
  { from: "AEGIS Brain", to: "Output & Intelligence", label: "Analyzed events → Dashboard SSE" },
];

export default function Architecture() {
  const [selected, setSelected] = useState<BlockDetail | null>(null);
  const [activeStep, setActiveStep] = useState<number | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary uppercase">System Architecture</h1>
        <p className="text-sm text-muted-foreground">Block တစ်ခုချင်းစီကို click ပြီး detailed workflow ကြည့်ပါ</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT — Flowchart */}
        <div className="space-y-2">
          {/* Internet Node */}
          <div className="flex flex-col items-center">
            <div className="w-20 h-20 rounded-full border-2 border-gray-400 bg-background flex items-center justify-center">
              <span className="text-xs font-bold text-gray-300 text-center leading-tight">🌐<br/>INTERNET</span>
            </div>
          </div>

          {/* Arrow */}
          <div className="flex flex-col items-center">
            <div className="flex flex-col items-center">
              <div className="w-0.5 h-6 bg-gray-500" />
              <ArrowDown className="w-4 h-4 text-gray-500 -mt-1" />
              <span className="text-xs text-gray-500 font-mono">Attack traffic</span>
            </div>
          </div>

          {/* Block 1 — Attacker */}
          {BLOCKS.map((block, i) => (
            <div key={block.id}>
              <button
                onClick={() => { setSelected(block); setActiveStep(null); }}
                className={`w-full rounded-xl border-2 ${block.borderColor} ${block.bgColor} p-4 text-left transition-all hover:scale-[1.01] hover:shadow-lg ${selected?.id === block.id ? "ring-2 ring-offset-1 ring-offset-background ring-primary" : ""}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className={`font-bold text-sm uppercase tracking-wider ${block.textColor}`}>{block.title}</h3>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">{block.subtitle}</p>
                  </div>
                  <ChevronRight className={`w-4 h-4 ${block.textColor} transition-transform ${selected?.id === block.id ? "rotate-90" : ""}`} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {block.subBlocks.map(sub => (
                    <div key={sub.name} className={`rounded-lg border ${sub.color} p-2`}>
                      <p className="text-xs font-semibold text-foreground/80 mb-1">{sub.name}</p>
                      <div className="flex flex-wrap gap-0.5">
                        {sub.tools.slice(0, 3).map(t => (
                          <span key={t} className="text-[9px] text-muted-foreground font-mono">{t}</span>
                        ))}
                        {sub.tools.length > 3 && <span className="text-[9px] text-muted-foreground">+{sub.tools.length - 3}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </button>

              {/* Arrow between blocks */}
              {i < BLOCKS.length - 1 && (
                <div className="flex flex-col items-center py-1">
                  <div className="w-0.5 h-4 bg-primary/40" />
                  <ArrowDown className="w-4 h-4 text-primary/40 -mt-1" />
                  <span className="text-[10px] text-primary/60 font-mono">{FLOW_ARROWS[i + 1]?.label}</span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* RIGHT — Detail Panel */}
        <div className="lg:sticky lg:top-0">
          {selected ? (
            <div className={`rounded-xl border-2 ${selected.borderColor} ${selected.bgColor} h-full`}>
              <div className="p-4 border-b border-white/10 flex items-start justify-between">
                <div>
                  <h2 className={`text-lg font-bold uppercase tracking-wider ${selected.textColor}`}>{selected.title}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">{selected.description}</p>
                </div>
                <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Sub-blocks detail */}
              <div className="p-4 border-b border-white/10">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Components & Tools</p>
                <div className="space-y-3">
                  {selected.subBlocks.map(sub => (
                    <div key={sub.name} className={`rounded-lg border ${sub.color} p-3`}>
                      <p className="text-xs font-bold text-foreground mb-2">{sub.name}</p>
                      <div className="flex flex-wrap gap-1">
                        {sub.tools.map(t => (
                          <span key={t} className="text-[10px] bg-black/30 rounded px-1.5 py-0.5 font-mono text-muted-foreground border border-white/10">{t}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Workflow Steps */}
              <div className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Step-by-Step Workflow</p>
                <div className="space-y-2">
                  {selected.workflow.map((step, i) => (
                    <button
                      key={step.step}
                      onClick={() => setActiveStep(activeStep === i ? null : i)}
                      className={`w-full text-left rounded-lg border p-3 transition-all ${activeStep === i ? `border-current ${selected.bgColor} ${selected.borderColor}` : "border-white/10 bg-black/20 hover:bg-black/30"}`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${activeStep === i ? `bg-current/20 ${selected.textColor}` : "bg-white/10 text-muted-foreground"}`} style={activeStep === i ? { color: selected.color, background: `${selected.color}20` } : {}}>
                          {step.step}
                        </span>
                        <div className="flex-1">
                          <p className={`text-xs font-semibold ${activeStep === i ? selected.textColor : "text-foreground/80"}`}>{step.action}</p>
                          {activeStep === i && (
                            <p className="text-xs text-muted-foreground mt-1 font-mono leading-relaxed">{step.detail}</p>
                          )}
                        </div>
                        <ChevronRight className={`w-3 h-3 text-muted-foreground shrink-0 transition-transform ${activeStep === i ? "rotate-90" : ""}`} />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card/50 h-full flex flex-col items-center justify-center p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                <ChevronRight className="w-8 h-8 text-primary/50" />
              </div>
              <p className="text-sm font-semibold text-muted-foreground">Block တစ်ခုကို click ပါ</p>
              <p className="text-xs text-muted-foreground mt-1">Detailed workflow နဲ့ tools တွေ ပေါ်လာမည်</p>
              <div className="mt-6 space-y-2 text-left w-full max-w-xs">
                {BLOCKS.map(b => (
                  <div key={b.id} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm shrink-0" style={{ background: b.color }} />
                    <span className="text-xs text-muted-foreground">{b.title}</span>
                    <span className="text-xs text-muted-foreground/50 ml-auto">{b.workflow.length} steps</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom — Full Data Flow */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">Complete Data Flow — End to End</h3>
        <div className="overflow-x-auto">
          <div className="flex items-start gap-0 min-w-max">
            {[
              { label: "Kali Linux", sub: "Attack tools", color: "#ef4444", icon: "💀", steps: ["nmap scan", "hydra brute", "sqlmap inject", "hping3 flood"] },
              { label: "Network", sub: "TCP/IP packets", color: "#f97316", icon: "📡", steps: ["SYN packets", "HTTP requests", "SSH attempts", "ICMP flood"] },
              { label: "Suricata / Snort", sub: "IDS detection", color: "#22c55e", icon: "🛡", steps: ["Signature match", "Alert generate", "eve.json write", "Rule triggered"] },
              { label: "Fail2ban", sub: "Auto block", color: "#22c55e", icon: "🔒", steps: ["auth.log watch", "5 fails = ban", "iptables DROP", "Jail activated"] },
              { label: "Forwarder", sub: "aegis_forwarder.py", color: "#22d3ee", icon: "🔄", steps: ["Read eve.json", "Parse format", "POST /api/ingest", "Auth with key"] },
              { label: "AEGIS API", sub: "Express server", color: "#818cf8", icon: "⚡", steps: ["Validate input", "Store to DB", "Score severity", "Create alert"] },
              { label: "Dashboard", sub: "React frontend", color: "#94a3b8", icon: "📊", steps: ["SSE receives", "UI updates", "Charts refresh", "Alert badge"] },
              { label: "Admin", sub: "SOC Analyst", color: "#f59e0b", icon: "👤", steps: ["Reviews alert", "Block IP", "Create report", "Close incident"] },
            ].map((node, i, arr) => (
              <div key={node.label} className="flex items-start">
                <div className="flex flex-col items-center w-32">
                  <div className="w-full rounded-lg border p-2 text-center" style={{ borderColor: `${node.color}50`, background: `${node.color}15` }}>
                    <div className="text-lg mb-1">{node.icon}</div>
                    <p className="text-xs font-bold" style={{ color: node.color }}>{node.label}</p>
                    <p className="text-[9px] text-muted-foreground">{node.sub}</p>
                    <div className="mt-2 space-y-0.5">
                      {node.steps.map(s => (
                        <p key={s} className="text-[9px] font-mono text-muted-foreground bg-black/20 rounded px-1">{s}</p>
                      ))}
                    </div>
                  </div>
                </div>
                {i < arr.length - 1 && (
                  <div className="flex items-center mt-8 w-6 shrink-0">
                    <div className="flex-1 h-0.5 bg-primary/30" />
                    <div className="w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[6px] border-l-primary/50" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
