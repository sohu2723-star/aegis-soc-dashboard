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
        <p className="text-sm text-muted-foreground">Red/Blue team cybersecurity lab provisioning guide — Real device setup.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 flex-1 min-h-0">
        {/* Sidebar Nav */}
        <div className="hidden md:block col-span-1">
          <div className="sticky top-0 bg-card border border-border rounded-lg p-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Contents</h3>
            <nav className="space-y-2 text-sm font-mono flex flex-col">
              <a href="#overview"     className="text-primary hover:underline">1. Project Overview</a>
              <a href="#requirements" className="text-foreground hover:underline hover:text-primary/80">2. VM Requirements</a>
              <a href="#network"      className="text-foreground hover:underline hover:text-primary/80">3. Network Config</a>
              <a href="#attack"       className="text-foreground hover:underline hover:text-primary/80">4. Attack Tools (Kali)</a>
              <a href="#defense"      className="text-foreground hover:underline hover:text-primary/80">5. Defense Tools (Ubuntu)</a>
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
                AEGIS is a real-device Red/Blue team cybersecurity lab. Kali Linux performs attacks, Ubuntu Server
                detects and defends, pfSense controls the network perimeter. The dashboard at
                <code className="bg-muted px-1.5 rounded text-primary mx-1">aegis-soc-dashboard.vercel.app</code>
                is monitoring-only — all actual attack and defense happens on the physical/virtual machines.
              </p>
              <div className="bg-muted/20 p-4 rounded border border-border">
                <h4 className="text-sm font-bold mb-3 uppercase text-muted-foreground">Lab Architecture:</h4>
                <pre className="text-xs font-mono text-primary/80 leading-relaxed">{`Internet
    │
pfSense  ── Firewall / Router / Defense execution
    │
    ├── Kali Linux   💀  Attacker  — runs attack tools
    ├── Ubuntu Server 🛡  Defender  — runs Snort/Suricata/Fail2ban/Cowrie
    │       └── aegis_forwarder.py → Dashboard (Vercel)
    └── Windows (optional) 🪟  Extra victim target`}</pre>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div className="bg-red-950/30 border border-red-500/30 rounded p-3">
                  <p className="font-bold text-red-400 mb-1">💀 Kali Linux</p>
                  <p className="text-muted-foreground text-xs">Attacker — nmap, sqlmap, hydra, hping3, nikto, metasploit</p>
                </div>
                <div className="bg-cyan-950/30 border border-cyan-500/30 rounded p-3">
                  <p className="font-bold text-cyan-400 mb-1">🛡 Ubuntu Server</p>
                  <p className="text-muted-foreground text-xs">Defender/Brain — Snort, Suricata, Fail2ban, Cowrie, forwarder</p>
                </div>
                <div className="bg-green-950/30 border border-green-500/30 rounded p-3">
                  <p className="font-bold text-green-400 mb-1">⊕ pfSense</p>
                  <p className="text-muted-foreground text-xs">Firewall/Router — Network control, block rules, defense agent</p>
                </div>
              </div>
            </section>

            {/* ── 2. VM Requirements ── */}
            <section id="requirements" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                2. VM Requirements
              </h2>
              <p className="text-sm text-muted-foreground mb-4">Core setup — 3 VMs. Host PC: 16GB+ RAM, 150GB+ storage recommended.</p>
              <Table className="border border-border">
                <TableHeader className="bg-muted/30">
                  <TableRow className="border-border">
                    <TableHead>VM</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>RAM</TableHead>
                    <TableHead>Storage</TableHead>
                    <TableHead>Required</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="border-border">
                    <TableCell className="font-medium text-red-400">VM1: Kali Linux</TableCell>
                    <TableCell>Attacker</TableCell>
                    <TableCell className="font-mono text-muted-foreground">4GB</TableCell>
                    <TableCell className="font-mono text-muted-foreground">40GB</TableCell>
                    <TableCell className="text-green-400 text-xs font-bold">✅ YES</TableCell>
                  </TableRow>
                  <TableRow className="border-border">
                    <TableCell className="font-medium text-cyan-400">VM2: Ubuntu Server</TableCell>
                    <TableCell>Defender / Brain</TableCell>
                    <TableCell className="font-mono text-muted-foreground">4GB+</TableCell>
                    <TableCell className="font-mono text-muted-foreground">40GB</TableCell>
                    <TableCell className="text-green-400 text-xs font-bold">✅ YES</TableCell>
                  </TableRow>
                  <TableRow className="border-border">
                    <TableCell className="font-medium text-green-400">VM3: pfSense</TableCell>
                    <TableCell>Firewall / Router</TableCell>
                    <TableCell className="font-mono text-muted-foreground">1GB</TableCell>
                    <TableCell className="font-mono text-muted-foreground">10GB</TableCell>
                    <TableCell className="text-green-400 text-xs font-bold">✅ YES</TableCell>
                  </TableRow>
                  <TableRow className="border-border opacity-60">
                    <TableCell className="font-medium text-gray-400">VM4: Windows (optional)</TableCell>
                    <TableCell>Extra Victim</TableCell>
                    <TableCell className="font-mono text-muted-foreground">4GB</TableCell>
                    <TableCell className="font-mono text-muted-foreground">60GB</TableCell>
                    <TableCell className="text-yellow-400 text-xs">⬜ OPTIONAL</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground">
                💡 Windows ထည့်ရင် Kali က Ubuntu အစား Windows ကို attack target လုပ်လို့ ရတယ်။
                Ubuntu ကိုတော့ network detection အတွက် ဆက်ထားဖို့ လိုတယ်။
              </p>
            </section>

            {/* ── 3. Network Config ── */}
            <section id="network" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                3. Network Configuration
              </h2>
              <p className="text-foreground leading-relaxed">
                pfSense က network ကို manage လုပ်တယ်။ VirtualBox Host-Only adapter ကနေ VM တွေ တချင်းချင်း communicate လုပ်နိုင်တယ်။
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                <div className="bg-muted/20 p-4 rounded border border-border">
                  <h4 className="text-sm font-bold mb-2 uppercase text-primary">pfSense WAN</h4>
                  <p className="text-sm text-muted-foreground font-mono">NAT Network</p>
                  <p className="text-xs mt-2">Internet access ရဖို့ — lab ကို outside ကနေ isolate လုပ်ထားသည်။</p>
                </div>
                <div className="bg-muted/20 p-4 rounded border border-border">
                  <h4 className="text-sm font-bold mb-2 uppercase text-primary">pfSense LAN</h4>
                  <p className="text-sm text-muted-foreground font-mono">Host-Only: 192.168.56.0/24</p>
                  <p className="text-xs mt-2">Kali, Ubuntu, (Windows) တွေ ဒီ network မှာ ရှိသည်။</p>
                </div>
              </div>
              <div className="bg-muted/20 p-4 rounded border border-border">
                <h4 className="text-sm font-bold mb-2 uppercase text-muted-foreground">Suggested IP Assignment:</h4>
                <div className="font-mono text-xs space-y-1 text-primary/80">
                  <p>192.168.56.1    — pfSense (LAN gateway)</p>
                  <p>192.168.56.101  — Kali Linux (attacker)</p>
                  <p>192.168.56.102  — Ubuntu Server (defender)</p>
                  <p>192.168.56.103  — Windows (optional victim)</p>
                </div>
              </div>
            </section>

            {/* ── 4. Attack Tools ── */}
            <section id="attack" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                4. Attack Tools (Kali Linux)
              </h2>
              <p className="text-foreground">Kali မှာ ဒီ tools တွေ install ပြီး Ubuntu ကို attack လုပ်မည်။</p>
              <CodeBlock language="bash" code={`# System update
sudo apt update && sudo apt upgrade -y

# Core attack tools
sudo apt install -y nmap sqlmap nikto hydra hping3 metasploit-framework
sudo apt install -y wireshark dsniff arpwatch burpsuite

# Common attacks:
# Port scan:      nmap -sS -p 1-65535 192.168.56.102
# SSH brute:      hydra -l root -P /usr/share/wordlists/rockyou.txt ssh://192.168.56.102
# SQLi:           sqlmap -u "http://192.168.56.102/login.php" --forms --batch
# DDoS SYN:       hping3 -S --flood -V -p 80 192.168.56.102
# Web scan:       nikto -h http://192.168.56.102`} />
            </section>

            {/* ── 5. Defense Tools ── */}
            <section id="defense" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                5. Defense Tools (Ubuntu Server)
              </h2>
              <p className="text-foreground">Ubuntu မှာ IDS/IPS, honeypot tools install လုပ်ပြီး forwarder ချိတ်ဆွဲမည်။</p>

              <CodeBlock language="bash" code={`# IDS/IPS tools
sudo apt install -y snort suricata fail2ban ufw iptables tshark tcpdump

# Suricata community rules update
sudo suricata-update

# Cowrie honeypot setup
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

              <CodeBlock language="bash" code={`# AEGIS Forwarder install
sudo apt install -y python3-pip
pip3 install requests

# Download forwarder from GitHub
wget https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py -O /opt/aegis_forwarder.py
chmod +x /opt/aegis_forwarder.py`} />
            </section>

            {/* ── 6. Firewall & WAF ── */}
            <section id="firewall" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                6. Firewall &amp; WAF (Optional — Web Attack Testing)
              </h2>
              <p className="text-foreground">Web server ထားပြီး SQLi/XSS attack test ချင်ရင် ModSecurity ထည့်ပါ။</p>
              <CodeBlock language="bash" code={`# Apache + ModSecurity (Ubuntu မှာ)
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

# Test: Kali က SQLi attack လုပ်လိုက်ရင် ModSecurity block လုပ်ပြီး log ကို forwarder ဆီ ပို့မည်`} />
            </section>

            {/* ── 7. Connect Real Attacks ── */}
            <section id="integration" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-destructive/50 pb-2 flex items-center gap-2">
                <Terminal className="h-5 w-5 text-destructive" />
                7. Connect Real Attacks to AEGIS Dashboard
              </h2>
              <div className="bg-destructive/10 border border-destructive/30 rounded p-4 text-sm">
                <p className="font-bold text-destructive uppercase tracking-wider mb-1">Real-Time Integration</p>
                <p className="text-foreground">Ubuntu VM မှာ forwarder run ထားရင် Kali က attack လုပ်တာနဲ့ Dashboard မှာ live ပေါ်မည်။</p>
              </div>

              <div className="bg-muted/20 border border-border rounded p-4">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Data Flow</p>
                <pre className="text-xs font-mono text-primary/80 leading-relaxed">{`Kali (nmap / sqlmap / hydra / hping3)
    │  network traffic
    ▼
Ubuntu — Snort / Suricata / Fail2ban detects
    │
    aegis_forwarder.py reads log files
    │
    POST https://aegis-api-server-jp3b.onrender.com/api/ingest/*
    │
Dashboard — live event ပေါ်သည်`}</pre>
              </div>

              <h3 className="text-base font-bold uppercase text-primary mt-6">Step 1 — Environment Variables Set</h3>
              <CodeBlock language="bash" code={`# Ubuntu VM မှာ
export AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api"
export AEGIS_KEY="your-aegis-ingest-key"

# Connection test
curl -X POST "$AEGIS_URL/ingest/event" \\
  -H "Content-Type: application/json" \\
  -H "X-AEGIS-Key: $AEGIS_KEY" \\
  -d '{"source":"test","type":"web_attack","subtype":"Connection Test",
       "severity":"low","sourceIp":"192.168.56.101",
       "description":"AEGIS connection test from Ubuntu"}'`} />

              <h3 className="text-base font-bold uppercase text-primary mt-6">Step 2 — Suricata ချိတ်ဆွဲ</h3>
              <CodeBlock language="bash" code={`# Suricata ကို lab network interface မှာ run
sudo suricata -c /etc/suricata/suricata.yaml -i enp0s8 -D

# Forwarder — Suricata mode
AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api" \\
AEGIS_KEY="your-aegis-ingest-key" \\
python3 /opt/aegis_forwarder.py --mode suricata`} />

              <h3 className="text-base font-bold uppercase text-primary mt-6">Step 3 — Fail2ban ချိတ်ဆွဲ</h3>
              <CodeBlock language="bash" code={`sudo nano /etc/fail2ban/action.d/aegis.conf`} />
              <CodeBlock language="ini" code={`[Definition]
actionban = curl -s -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/fail2ban \\
            -H "Content-Type: application/json" \\
            -H "X-AEGIS-Key: your-aegis-ingest-key" \\
            -d '{"ip":"<ip>","jail":"<name>","failures":"<failures>"}'`} />
              <CodeBlock language="bash" code={`# /etc/fail2ban/jail.local — [sshd] section မှာ ထည့်
# action = %(action_)s
#          aegis
sudo systemctl restart fail2ban`} />

              <h3 className="text-base font-bold uppercase text-primary mt-6">Step 4 — Cowrie Honeypot ချိတ်ဆွဲ</h3>
              <CodeBlock language="bash" code={`AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api" \\
AEGIS_KEY="your-aegis-ingest-key" \\
python3 /opt/aegis_forwarder.py --mode cowrie`} />

              <h3 className="text-base font-bold uppercase text-primary mt-6">Step 5 — All Modes တပြိုင်တည်း</h3>
              <CodeBlock language="bash" code={`# Snort + Suricata + Fail2ban + Cowrie တပြိုင်တည်း
AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api" \\
AEGIS_KEY="your-aegis-ingest-key" \\
python3 /opt/aegis_forwarder.py --mode all

# Background service (systemd မသုံးဘဲ)
nohup python3 /opt/aegis_forwarder.py --mode all \\
  > /var/log/aegis-forwarder.log 2>&1 &`} />

              <h3 className="text-base font-bold uppercase text-primary mt-6">Attack Test Commands (Kali မှ)</h3>
              <div className="bg-muted/20 border border-border rounded p-4 space-y-3 text-sm">
                {[
                  { label: "Port Scan",     cmd: "nmap -sS -p 1-65535 192.168.56.102",                               result: "Suricata ET SCAN rule → Medium event" },
                  { label: "SSH Brute",     cmd: "hydra -l root -P /usr/share/wordlists/rockyou.txt ssh://192.168.56.102", result: "Fail2ban 5 fails → IP ban → Critical event" },
                  { label: "SQL Injection", cmd: 'sqlmap -u "http://192.168.56.102/login.php" --forms --batch',       result: "Suricata SQLi rule → Critical event" },
                  { label: "DDoS SYN",      cmd: "hping3 -S --flood -V -p 80 192.168.56.102",                         result: "Suricata DOS rule → High event" },
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
                  <p><span className="text-green-400">POST</span> /api/ingest/snort     — Snort alert_fast</p>
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
                Dashboard မှ defense commands (auto + manual) တွေကို Ubuntu/pfSense မှာ execute လုပ်ဖို့
                <code className="bg-muted px-1.5 rounded text-primary mx-1">defense_agent.py</code>
                ကို root အဖြစ် run ရတယ်။
              </p>

              <div className="bg-muted/20 border border-border rounded p-4">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Flow</p>
                <pre className="text-xs font-mono text-primary/80 leading-relaxed">{`Dashboard (auto/manual rule)
    │
    POST defense command → PostgreSQL
    │
defense_agent.py polls every 5s
    │
    ├── Ubuntu: iptables -I INPUT -s <ATTACKER_IP> -j DROP
    └── pfSense: API call → firewall block rule`}</pre>
              </div>

              <CodeBlock language="bash" code={`# Ubuntu VM — Terminal 1: forwarder (attacks ပို့)
sudo AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api" \\
     AEGIS_KEY="your-aegis-ingest-key" \\
     python3 /opt/aegis_forwarder.py --mode all

# Ubuntu VM — Terminal 2: defense agent (commands execute)
sudo AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api" \\
     AEGIS_KEY="your-aegis-ingest-key" \\
     AEGIS_ADMIN_KEY="your-aegis-admin-key" \\
     python3 /opt/defense_agent.py --vm ubuntu`} />

              <div className="bg-muted/20 border border-border rounded p-4 text-sm">
                <p className="font-bold text-primary mb-2">Manual Defense (Dashboard မပါဘဲ)</p>
                <p className="text-muted-foreground text-xs mb-2">pfSense GUI ကနေ တိုက်ရိုက်လဲ rules ရေးလို့ ရတယ်:</p>
                <p className="font-mono text-xs text-primary/80">pfSense → Firewall → Rules → Add → Block source IP</p>
              </div>
            </section>

          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
