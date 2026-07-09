import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Copy, Terminal, Check } from "lucide-react";
import { useState } from "react";

const CodeBlock = ({ code, language = "bash" }: { code: string; language?: string }) => {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative rounded-md bg-muted/30 border border-border overflow-hidden my-4 group">
      <div className="flex items-center justify-between px-4 py-1.5 bg-muted/50 border-b border-border">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{language}</span>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary" onClick={onCopy}>
          {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <div className="p-4 overflow-x-auto text-sm font-mono text-primary/90">
        <pre><code>{code}</code></pre>
      </div>
    </div>
  );
};

export default function SetupGuide() {
  return (
    <div className="h-full flex flex-col max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary uppercase">AEGIS System Setup Guide</h1>
        <p className="text-sm text-muted-foreground">GNS3 AEGIS-SecureBank lab provisioning guide — Real device setup.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 flex-1 min-h-0">
        {/* Sidebar Nav */}
        <div className="hidden md:block col-span-1">
          <div className="sticky top-0 bg-card border border-border rounded-lg p-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Contents</h3>
            <nav className="space-y-2 text-sm font-mono flex flex-col">
              <a href="#overview"     className="text-primary hover:underline">1. Project Overview</a>
              <a href="#requirements" className="text-foreground hover:underline hover:text-primary/80">2. GNS3 Node Requirements</a>
              <a href="#network"      className="text-foreground hover:underline hover:text-primary/80">3. Network Config</a>
              <a href="#attack"       className="text-foreground hover:underline hover:text-primary/80">4. Attack Tools (Kali)</a>
              <a href="#defense"      className="text-foreground hover:underline hover:text-primary/80">5. Defense Tools (Bank VMs)</a>
              <a href="#firewall"     className="text-foreground hover:underline hover:text-primary/80">6. Firewall &amp; WAF</a>
              <a href="#integration"  className="text-destructive hover:underline font-bold">7. Connect Real Attacks</a>
              <a href="#defense-agent" className="text-foreground hover:underline hover:text-primary/80">8. Defense Agent</a>
            </nav>
          </div>
        </div>

        <ScrollArea className="col-span-1 md:col-span-3 bg-card border border-border rounded-lg">
          <div className="p-6 md:p-8 space-y-12">

            {/* ── 1. Overview ── */}
            <section id="overview" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2 flex items-center gap-2">
                <Terminal className="h-5 w-5" /> 1. Project Overview
              </h2>
              <p className="text-foreground leading-relaxed">
                AEGIS-SecureBank is a real-device Red/Blue team cybersecurity lab built in GNS3. Kali Linux performs
                attacks, four bank VMs (bank-web, bank-mail, teller-pc, customer-db) run their own local sensors,
                and pfSense (behind two MikroTik routers) controls the network perimeter. The dashboard at
                <code className="bg-muted px-1.5 rounded text-primary mx-1">aegis-soc-dashboard.vercel.app</code>
                is monitoring-only — all actual attack and defense happens on the GNS3 virtual machines.
              </p>
              <div className="bg-muted/20 p-4 rounded border border-border">
                <h4 className="text-sm font-bold mb-3 uppercase text-muted-foreground">Lab Architecture:</h4>
                <pre className="text-xs font-mono text-primary/80 leading-relaxed">{`Kali (Attacker) → Switch1 → Router-1 → Router-2 → pfSense
                                                              │
                              ┌────────────── DMZ ───────────┼────────── Internal ──────────┐
                              │                               │                              │
                          bank-web                        bank-mail                     teller-pc, customer-db
                       (Apache/ModSecurity/Suricata)    (Postfix/Fail2ban/Suricata)  (Cowrie/PostgreSQL/Fail2ban)
                              │                               │                              │
                              └──────────── each VM runs its OWN aegis_forwarder.py ─────────┘
                                                              │
                                              POST → API Server (Render) → Dashboard (Vercel)

aegis-forwarder VM (MGMT segment) also runs its own agent + nmap network scan + tcpdump traffic capture.`}</pre>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div className="bg-red-950/30 border border-red-500/30 rounded p-3">
                  <p className="font-bold text-red-400 mb-1">💀 Kali Linux</p>
                  <p className="text-muted-foreground text-xs">Attacker — nmap, sqlmap, hydra, hping3, nikto, metasploit</p>
                </div>
                <div className="bg-cyan-950/30 border border-cyan-500/30 rounded p-3">
                  <p className="font-bold text-cyan-400 mb-1">🛡 Bank VMs</p>
                  <p className="text-muted-foreground text-xs">bank-web, bank-mail, teller-pc, customer-db — each runs Suricata/Fail2ban/Cowrie + its own forwarder</p>
                </div>
                <div className="bg-green-950/30 border border-green-500/30 rounded p-3">
                  <p className="font-bold text-green-400 mb-1">⊕ pfSense + Routers</p>
                  <p className="text-muted-foreground text-xs">Firewall/Router — Network control, block rules, defense agent</p>
                </div>
              </div>
            </section>

            {/* ── 2. GNS3 Node Requirements ── */}
            <section id="requirements" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                2. GNS3 Node Requirements
              </h2>
              <p className="text-sm text-muted-foreground mb-4">Full topology — 9 GNS3 nodes. Host PC: 16GB+ RAM, 150GB+ storage recommended.</p>
              <Table className="border border-border">
                <TableHeader className="bg-muted/30">
                  <TableRow className="border-border">
                    <TableHead>Node</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="border-border">
                    <TableCell className="font-medium text-red-400">Attacker (Kali)</TableCell>
                    <TableCell>Red Team</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">192.168.122.132/24</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">QEMU VM</TableCell>
                  </TableRow>
                  <TableRow className="border-border">
                    <TableCell className="font-medium text-muted-foreground">Router-1 / Router-2</TableCell>
                    <TableCell>Edge Routing</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">10.0.12.x / 10.0.23.x</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">MikroTik CHR</TableCell>
                  </TableRow>
                  <TableRow className="border-border">
                    <TableCell className="font-medium text-green-400">pfSense</TableCell>
                    <TableCell>Firewall / Router</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">WAN/DMZ/INT/MGMT</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">QEMU VM</TableCell>
                  </TableRow>
                  <TableRow className="border-border">
                    <TableCell className="font-medium text-cyan-400">bank-web</TableCell>
                    <TableCell>Web Server (DMZ)</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">10.10.10.10/24</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">Ubuntu VM</TableCell>
                  </TableRow>
                  <TableRow className="border-border">
                    <TableCell className="font-medium text-cyan-400">bank-mail</TableCell>
                    <TableCell>Mail Server (DMZ)</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">10.10.10.20/24</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">Ubuntu VM</TableCell>
                  </TableRow>
                  <TableRow className="border-border">
                    <TableCell className="font-medium text-cyan-400">teller-pc</TableCell>
                    <TableCell>Workstation + Honeypot (Internal)</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">10.20.20.10/24</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">Ubuntu VM</TableCell>
                  </TableRow>
                  <TableRow className="border-border">
                    <TableCell className="font-medium text-cyan-400">customer-db</TableCell>
                    <TableCell>Database (Internal)</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">10.20.20.20/24</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">Ubuntu VM</TableCell>
                  </TableRow>
                  <TableRow className="border-border">
                    <TableCell className="font-medium text-primary">aegis-forwarder</TableCell>
                    <TableCell>Agent + Network Scanner (MGMT)</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">10.30.30.10/24</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">Ubuntu VM</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground">
                💡 Full IP plan, cabling, and MikroTik/pfSense configs are documented in <code className="text-primary">docs/GNS3_SETUP.md</code>.
              </p>
            </section>

            {/* ── 3. Network Config ── */}
            <section id="network" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                3. Network Configuration
              </h2>
              <p className="text-foreground leading-relaxed">
                pfSense manages three internal zones (DMZ, Internal, MGMT) behind two MikroTik routers that connect
                the lab to the GNS3 NAT cloud where Kali attacks from.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                <div className="bg-muted/20 p-4 rounded border border-border">
                  <h4 className="text-sm font-bold mb-2 uppercase text-primary">pfSense WAN</h4>
                  <p className="text-sm text-muted-foreground font-mono">10.0.23.2/30</p>
                  <p className="text-xs mt-2">Upstream toward Router-2 → Router-1 → GNS3 NAT cloud → Kali.</p>
                </div>
                <div className="bg-muted/20 p-4 rounded border border-border">
                  <h4 className="text-sm font-bold mb-2 uppercase text-primary">pfSense DMZ / INT / MGMT</h4>
                  <p className="text-sm text-muted-foreground font-mono">10.10.10.0/24 · 10.20.20.0/24 · 10.30.30.0/24</p>
                  <p className="text-xs mt-2">bank-web/bank-mail, teller-pc/customer-db, and aegis-forwarder each sit on their own zone.</p>
                </div>
              </div>
              <div className="bg-muted/20 p-4 rounded border border-border">
                <h4 className="text-sm font-bold mb-2 uppercase text-muted-foreground">IP Assignment:</h4>
                <div className="font-mono text-xs space-y-1 text-primary/80">
                  <p>10.10.10.1     — pfSense DMZ gateway</p>
                  <p>10.10.10.10    — bank-web</p>
                  <p>10.10.10.20    — bank-mail</p>
                  <p>10.20.20.1     — pfSense Internal gateway</p>
                  <p>10.20.20.10    — teller-pc</p>
                  <p>10.20.20.20    — customer-db</p>
                  <p>10.30.30.1     — pfSense MGMT gateway</p>
                  <p>10.30.30.10    — aegis-forwarder</p>
                </div>
              </div>
            </section>

            {/* ── 4. Attack Tools ── */}
            <section id="attack" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                4. Attack Tools (Kali Linux)
              </h2>
              <p className="text-foreground">Kali runs these tools and attacks the bank VMs across the routed GNS3 network.</p>
              <CodeBlock language="bash" code={`# System update
sudo apt update && sudo apt upgrade -y

# Core attack tools
sudo apt install -y nmap sqlmap nikto hydra hping3 metasploit-framework
sudo apt install -y wireshark dsniff arpwatch burpsuite

# Common attacks:
# Port scan:      nmap -sS -p 1-65535 10.10.10.10
# SSH brute:      hydra -l root -P /usr/share/wordlists/rockyou.txt ssh://10.20.20.10
# SQLi:           sqlmap -u "http://10.10.10.10/login.php" --forms --batch
# DDoS SYN:       hping3 -S --flood -V -p 80 10.10.10.10
# Web scan:       nikto -h http://10.10.10.10`} />
            </section>

            {/* ── 5. Defense Tools ── */}
            <section id="defense" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                5. Defense Tools (Bank VMs)
              </h2>
              <p className="text-foreground">Install IDS/IPS and honeypot tools on each bank VM, then run its own local forwarder — no SSH or central hub involved.</p>

              <CodeBlock language="bash" code={`# IDS/IPS tools (bank-web, bank-mail, teller-pc, customer-db)
sudo apt install -y suricata fail2ban ufw iptables tshark tcpdump

# Suricata community rules update
sudo suricata-update

# Cowrie honeypot setup (teller-pc only)
sudo apt install -y git python3-virtualenv libssl-dev libffi-dev build-essential python3-dev authbind
sudo useradd -m -s /bin/bash cowrie
sudo su - cowrie -c "
  git clone https://github.com/cowrie/cowrie.git
  cd cowrie
  python3 -m virtualenv cowrie-env
  source cowrie-env/bin/activate
  pip install -r requirements.txt
  cp etc/cowrie.cfg.dist etc/cowrie.cfg
  bin/cowrie start
"`} />

              <CodeBlock language="bash" code={`# AEGIS Forwarder install — run on EVERY VM (bank-web, bank-mail,
# teller-pc, customer-db, aegis-forwarder). Each VM gets its own copy.
sudo apt install -y python3-pip
pip3 install requests

# Download forwarder from GitHub
wget https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py -O /opt/aegis_forwarder.py
chmod +x /opt/aegis_forwarder.py`} />
            </section>

            {/* ── 6. Firewall & WAF ── */}
            <section id="firewall" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                6. Firewall &amp; WAF (bank-web)
              </h2>
              <p className="text-foreground">bank-web hosts a vulnerable web app behind ModSecurity for SQLi/XSS attack testing.</p>
              <CodeBlock language="bash" code={`# Apache + ModSecurity (on bank-web)
sudo apt install -y apache2 libapache2-mod-security2
sudo a2enmod security2
sudo cp /etc/modsecurity/modsecurity.conf-recommended /etc/modsecurity/modsecurity.conf
sudo sed -i 's/SecRuleEngine DetectionOnly/SecRuleEngine On/' /etc/modsecurity/modsecurity.conf

# OWASP Core Rule Set
cd /tmp
wget https://github.com/coreruleset/coreruleset/archive/v3.3.2.tar.gz
tar -xzf v3.3.2.tar.gz
sudo cp -r coreruleset-3.3.2/rules/ /etc/modsecurity/
sudo cp coreruleset-3.3.2/crs-setup.conf.example /etc/modsecurity/crs-setup.conf
sudo systemctl restart apache2

# Test: Kali runs a SQLi attack, ModSecurity blocks it and logs it — bank-web's own forwarder picks it up`} />
            </section>

            {/* ── 7. Connect Real Attacks ── */}
            <section id="integration" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-destructive/50 pb-2 flex items-center gap-2">
                <Terminal className="h-5 w-5 text-destructive" />
                7. Connect Real Attacks to AEGIS Dashboard
              </h2>
              <div className="bg-destructive/10 border border-destructive/30 rounded p-4 text-sm">
                <p className="font-bold text-destructive uppercase tracking-wider mb-1">Real-Time Integration</p>
                <p className="text-foreground">With each VM's forwarder running, an attack from Kali shows up live on the Dashboard within seconds — no central collector in the path.</p>
              </div>

              <div className="bg-muted/20 border border-border rounded p-4">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Data Flow</p>
                <pre className="text-xs font-mono text-primary/80 leading-relaxed">{`Kali (nmap / sqlmap / hydra / hping3)
    │  network traffic (routed via R1 → R2 → pfSense)
    ▼
Bank VM — Suricata / Fail2ban / Cowrie detects locally
    │
    that SAME VM's own aegis_forwarder.py reads its log files
    │
    POST https://aegis-api-server-jp3b.onrender.com/api/ingest/*
    │
Dashboard — live event appears`}</pre>
              </div>

              <h3 className="text-base font-bold uppercase text-primary mt-6">Step 1 — Environment Variables Set</h3>
              <CodeBlock language="bash" code={`# On each bank VM
export AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api"
export AEGIS_KEY="your-aegis-ingest-key"

# Connection test
curl -X POST "$AEGIS_URL/ingest/event" \\
  -H "Content-Type: application/json" \\
  -H "X-AEGIS-Key: $AEGIS_KEY" \\
  -d '{"source":"test","type":"web_attack","subtype":"Connection Test",
       "severity":"low","sourceIp":"192.168.122.132",
       "description":"AEGIS connection test from bank-web"}'`} />

              <h3 className="text-base font-bold uppercase text-primary mt-6">Step 2 — Suricata Integration</h3>
              <CodeBlock language="bash" code={`# Suricata runs on each bank VM's own interface
sudo suricata -c /etc/suricata/suricata.yaml -i ens3 -D

# That VM's own forwarder — Suricata mode
AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api" \\
AEGIS_KEY="your-aegis-ingest-key" \\
python3 /opt/aegis_forwarder.py --mode suricata`} />

              <h3 className="text-base font-bold uppercase text-primary mt-6">Step 3 — Fail2ban Integration</h3>
              <CodeBlock language="bash" code={`sudo nano /etc/fail2ban/action.d/aegis.conf`} />
              <CodeBlock language="ini" code={`[Definition]
actionban = curl -s -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/fail2ban \\
            -H "Content-Type: application/json" \\
            -H "X-AEGIS-Key: your-aegis-ingest-key" \\
            -d '{"ip":"<ip>","jail":"<name>","failures":"<failures>"}'`} />
              <CodeBlock language="bash" code={`# /etc/fail2ban/jail.local — [sshd] section
# action = %(action_)s
#          aegis
sudo systemctl restart fail2ban`} />

              <h3 className="text-base font-bold uppercase text-primary mt-6">Step 4 — Cowrie Honeypot Integration (teller-pc)</h3>
              <CodeBlock language="bash" code={`AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api" \\
AEGIS_KEY="your-aegis-ingest-key" \\
python3 /opt/aegis_forwarder.py --mode cowrie`} />

              <h3 className="text-base font-bold uppercase text-primary mt-6">Step 5 — All Modes at Once</h3>
              <CodeBlock language="bash" code={`# Suricata + Fail2ban + Cowrie (+ nmap/tcpdump on aegis-forwarder) together
AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api" \\
AEGIS_KEY="your-aegis-ingest-key" \\
python3 /opt/aegis_forwarder.py --mode all

# Recommended: run as a systemd service (see docs/GNS3_SETUP.md Step 8)
sudo systemctl enable --now aegis-forwarder`} />

              <h3 className="text-base font-bold uppercase text-primary mt-6">Attack Test Commands (from Kali)</h3>
              <div className="bg-muted/20 border border-border rounded p-4 space-y-3 text-sm">
                {[
                  { label: "Port Scan",     cmd: "nmap -sS -p 1-65535 10.10.10.10",                               result: "Suricata ET SCAN rule → Medium event" },
                  { label: "SSH Brute",     cmd: "hydra -l root -P /usr/share/wordlists/rockyou.txt ssh://10.20.20.10", result: "Fail2ban 5 fails → IP ban → Critical event" },
                  { label: "SQL Injection", cmd: 'sqlmap -u "http://10.10.10.10/login.php" --forms --batch',       result: "Suricata SQLi rule → Critical event" },
                  { label: "DDoS SYN",      cmd: "hping3 -S --flood -V -p 80 10.10.10.10",                         result: "Suricata DOS rule → High event" },
                ].map(({ label, cmd, result }) => (
                  <div key={label} className="flex gap-3 items-start">
                    <span className="text-destructive font-bold font-mono text-xs shrink-0 w-24">[{label}]</span>
                    <div>
                      <code className="text-xs text-primary/80 break-all">{cmd}</code>
                      <p className="text-muted-foreground mt-1 text-xs">→ {result}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-primary/5 border border-primary/20 rounded p-4 text-sm mt-4">
                <p className="text-primary font-bold uppercase tracking-wider mb-2">API Endpoints</p>
                <div className="space-y-1 font-mono text-xs text-muted-foreground">
                  <p><span className="text-green-400">POST</span> /api/ingest/event    — Generic event</p>
                  <p><span className="text-green-400">POST</span> /api/ingest/suricata  — Suricata EVE JSON</p>
                  <p><span className="text-green-400">POST</span> /api/ingest/fail2ban  — Fail2ban ban action</p>
                  <p><span className="text-green-400">POST</span> /api/ingest/cowrie    — Cowrie JSON log</p>
                  <p><span className="text-green-400">POST</span> /api/network/hosts    — Register VM as host</p>
                </div>
                <p className="text-muted-foreground mt-3 text-xs">Header: <code className="text-primary">X-AEGIS-Key: your-key</code></p>
              </div>
            </section>

            {/* ── 8. Defense Agent ── */}
            <section id="defense-agent" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                8. Defense Agent
              </h2>
              <p className="text-foreground">
                Dashboard defense commands (auto + manual) are executed on the bank VMs / pfSense by running
                <code className="bg-muted px-1.5 rounded text-primary mx-1">defense_agent.py</code>
                as root.
              </p>

              <div className="bg-muted/20 border border-border rounded p-4">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Flow</p>
                <pre className="text-xs font-mono text-primary/80 leading-relaxed">{`Dashboard (auto/manual rule)
    │
    POST defense command → PostgreSQL
    │
defense_agent.py polls every 5s (on the affected VM)
    │
    ├── Bank VM: iptables -I INPUT -s <ATTACKER_IP> -j DROP
    └── pfSense: API call → firewall block rule`}</pre>
              </div>

              <CodeBlock language="bash" code={`# Bank VM — Terminal 1: forwarder (sends its own attacks/events)
sudo AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api" \\
     AEGIS_KEY="your-aegis-ingest-key" \\
     python3 /opt/aegis_forwarder.py --mode all

# Bank VM — Terminal 2: defense agent (executes commands)
sudo AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api" \\
     AEGIS_KEY="your-aegis-ingest-key" \\
     AEGIS_ADMIN_KEY="your-aegis-admin-key" \\
     python3 /opt/defense_agent.py --vm bank-web`} />

              <div className="bg-muted/20 border border-border rounded p-4 text-sm">
                <p className="font-bold text-primary mb-2">Manual Defense (without Dashboard)</p>
                <p className="text-muted-foreground text-xs mb-2">You can also write rules directly from the pfSense GUI:</p>
                <p className="font-mono text-xs text-primary/80">pfSense → Firewall → Rules → Add → Block source IP</p>
              </div>
            </section>

          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
