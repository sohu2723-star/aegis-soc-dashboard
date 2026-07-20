import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Copy, Terminal, Check, AlertTriangle } from "lucide-react";
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
        <p className="text-sm text-muted-foreground">GNS3 AEGIS-SecureBank lab — real device setup (hub mode).</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 flex-1 min-h-0">
        {/* Sidebar Nav */}
        <div className="hidden md:block col-span-1">
          <div className="sticky top-0 bg-card border border-border rounded-lg p-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Contents</h3>
            <nav className="space-y-2 text-sm font-mono flex flex-col">
              <a href="#overview"      className="text-primary hover:underline">1. Overview</a>
              <a href="#nodes"         className="text-foreground hover:underline hover:text-primary/80">2. GNS3 Nodes</a>
              <a href="#network"       className="text-foreground hover:underline hover:text-primary/80">3. Network Config</a>
              <a href="#aegis-vm"      className="text-foreground hover:underline hover:text-primary/80">4. AEGIS VM Hub Setup</a>
              <a href="#bank-vms"      className="text-foreground hover:underline hover:text-primary/80">5. Bank VM Setup</a>
              <a href="#firewall"      className="text-foreground hover:underline hover:text-primary/80">6. pfSense Config</a>
              <a href="#integration"   className="text-destructive hover:underline font-bold">7. Connect Live</a>
              <a href="#attack-tests"  className="text-foreground hover:underline hover:text-primary/80">8. Attack Tests</a>
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

              <div className="bg-yellow-950/20 border border-yellow-500/30 rounded p-3 flex gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0 mt-0.5" />
                <p className="text-yellow-200/80">
                  Attackers can come from <strong>any IP address</strong> — not just 192.168.122.x.
                  Any external or internal IP should be treated as a potential threat.
                </p>
              </div>

              <p className="text-foreground leading-relaxed">
                AEGIS-SecureBank is a real-device Red/Blue team cybersecurity lab built in GNS3.
                The AEGIS VM (10.30.30.10) runs in <strong>hub mode</strong> — it SSHes into bank-web and
                customer-db to tail their logs and forward all events to the dashboard.
                The dashboard at{" "}
                <code className="bg-muted px-1.5 rounded text-primary mx-1">aegis-soc-dashboard.vercel.app</code>
                is monitoring-only — all actual attack and defense happens on the GNS3 virtual machines.
              </p>

              <div className="bg-muted/20 p-4 rounded border border-border">
                <h4 className="text-sm font-bold mb-3 uppercase text-muted-foreground">Current Lab Topology (v3):</h4>
                <pre className="text-xs font-mono text-primary/80 leading-relaxed">{`[Internet / NAT cloud (virbr0)]
         │ direct cable
[Router — MikroTik CHR]
  ether1: 192.168.122.2/24  ← Internet
  ether2: 192.168.10.1/24   ← Kali (DHCP 192.168.10.x) — direct, no switch
  ether3: 10.0.23.1/30      ← pfSense WAN
         │ direct cable
[Kali]                      [pfSense 2.7.2]
  DHCP 192.168.10.x          WAN:         10.0.23.2/30
  no switch                  BANK_WEB:    10.10.10.1/24
                             CUSTOMER_DB: 10.20.20.1/24
                             MGMT:        10.30.30.1/24
                                       │
                     ┌─────────────────┼──────────────┐
                [DMZ Zone]        [INT Zone]      [MGMT Zone]
                     │                │                │
               [bank-web]      [customer-db]   [aegis-forwarder]
           10.10.10.10  10.10.10.20  10.20.20.10  10.20.20.20  10.30.30.10
           Apache       BIND9        MySQL        Flask ATM    Hub agent
           ModSecurity  Fail2ban     Fail2ban     Fail2ban     (SSH → VMs)

aegis-forwarder (hub): SSHes into all VMs → tails logs → POST to API`}</pre>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div className="bg-red-950/30 border border-red-500/30 rounded p-3">
                  <p className="font-bold text-red-400 mb-1">⚔ Attacker</p>
                  <p className="text-muted-foreground text-xs">Any IP — nmap, sqlmap, hydra, hping3, metasploit, nikto</p>
                </div>
                <div className="bg-cyan-950/30 border border-cyan-500/30 rounded p-3">
                  <p className="font-bold text-cyan-400 mb-1">🛡 Bank VMs</p>
                  <p className="text-muted-foreground text-xs">bank-web, customer-db — Suricata, Fail2ban, service logs</p>
                </div>
                <div className="bg-green-950/30 border border-green-500/30 rounded p-3">
                  <p className="font-bold text-green-400 mb-1">⊕ pfSense + R1</p>
                  <p className="text-muted-foreground text-xs">Firewall/Router — WAN block, NAT, inter-zone routing</p>
                </div>
              </div>
            </section>

            {/* ── 2. GNS3 Node Requirements ── */}
            <section id="nodes" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                2. GNS3 Node Requirements
              </h2>
              <p className="text-sm text-muted-foreground mb-4">Current topology (v4) — 7 VMs + 1 router + 2 OVS switches. Host PC: 8GB+ RAM, 80GB+ storage.</p>
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
                    <TableCell className="font-medium text-red-400">Attacker VM</TableCell>
                    <TableCell>Red Team (any IP)</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">192.168.10.x (DHCP, dynamic)</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">QEMU / any OS</TableCell>
                  </TableRow>
                  <TableRow className="border-border">
                    <TableCell className="font-medium text-muted-foreground">Router-1 (R1)</TableCell>
                    <TableCell>Edge Routing + NAT</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">eth1: 192.168.122.2 · eth2: 192.168.10.1 · eth3: 10.0.23.1</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">MikroTik CHR</TableCell>
                  </TableRow>
                  <TableRow className="border-border">
                    <TableCell className="font-medium text-green-400">pfSense</TableCell>
                    <TableCell>Firewall / Router</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">WAN: 10.0.23.2 · DMZ/INT/MGMT gateways</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">pfSense 2.7.x</TableCell>
                  </TableRow>
                  <TableRow className="border-border">
                    <TableCell className="font-medium text-cyan-400">bank-web</TableCell>
                    <TableCell>Web Server (DMZ)</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">10.10.10.10/24</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">Ubuntu 24.04</TableCell>
                  </TableRow>
                  <TableRow className="border-border">
                    <TableCell className="font-medium text-cyan-400">dns-server</TableCell>
                    <TableCell>DNS Server (Public)</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">10.10.10.20/24</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">Ubuntu 24.04</TableCell>
                  </TableRow>
                  <TableRow className="border-border">
                    <TableCell className="font-medium text-cyan-400">customer-db</TableCell>
                    <TableCell>Database (Internal)</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">10.20.20.10/24</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">Ubuntu 24.04</TableCell>
                  </TableRow>
                  <TableRow className="border-border">
                    <TableCell className="font-medium text-cyan-400">atm-server</TableCell>
                    <TableCell>ATM API (Internal)</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">10.20.20.20/24</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">Ubuntu 24.04</TableCell>
                  </TableRow>
                  <TableRow className="border-border">
                    <TableCell className="font-medium text-primary">aegis-forwarder</TableCell>
                    <TableCell>Hub Agent (MGMT)</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">10.30.30.10/24</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">Ubuntu 24.04</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground">
                💡 Full IP plan and routing config: <code className="text-primary">docs/ip-plan.md</code> and <code className="text-primary">docs/network-architecture.md</code>
              </p>
            </section>

            {/* ── 3. Network Config ── */}
            <section id="network" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                3. Network Configuration
              </h2>
              <p className="text-foreground leading-relaxed">
                pfSense manages 3 zones via OVS switches + direct MGMT cable. R2 removed. Public-Switch and Internal-Switch are OpenVSwitch nodes in GNS3.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                <div className="bg-muted/20 p-4 rounded border border-border">
                  <h4 className="text-sm font-bold mb-2 uppercase text-primary">pfSense WAN</h4>
                  <p className="text-sm text-muted-foreground font-mono">10.0.23.2/30</p>
                  <p className="text-xs mt-2">Upstream → R1 ether3 (10.0.23.1) → attacker/internet.</p>
                </div>
                <div className="bg-muted/20 p-4 rounded border border-border">
                  <h4 className="text-sm font-bold mb-2 uppercase text-primary">pfSense Zones</h4>
                  <p className="text-sm text-muted-foreground font-mono">PUBLIC · INTERNAL · MGMT</p>
                  <p className="text-xs mt-2">bank-web + dns-server (Public), customer-db + atm-server (Internal), aegis (MGMT).</p>
                </div>
              </div>
              <div className="bg-muted/20 p-4 rounded border border-border">
                <h4 className="text-sm font-bold mb-2 uppercase text-muted-foreground">IP Assignments:</h4>
                <div className="font-mono text-xs space-y-1 text-primary/80">
                  <p>192.168.122.2 — R1 ether1 (Internet/virbr0 side)</p>
                  <p>192.168.10.1  — R1 ether2 (Kali side — DHCP gateway)</p>
                  <p>192.168.10.x  — Kali (dynamic DHCP, pool .2–.100)</p>
                  <p>10.0.23.1     — R1 ether3 (pfSense WAN upstream)</p>
                  <p>10.0.23.2     — pfSense WAN</p>
                  <p>10.10.10.1    — pfSense PUBLIC gateway (OVS Public-Switch)</p>
                  <p>10.10.10.10   — bank-web (Apache, ModSecurity, Fail2ban)</p>
                  <p>10.10.10.20   — dns-server (BIND9)</p>
                  <p>10.20.20.1    — pfSense INTERNAL gateway (OVS Internal-Switch)</p>
                  <p>10.20.20.10   — customer-db (MySQL, Fail2ban)</p>
                  <p>10.20.20.20   — atm-server (Flask ATM API)</p>
                  <p>10.30.30.1    — pfSense MGMT gateway</p>
                  <p>10.30.30.10   — aegis-forwarder (hub)</p>
                </div>
              </div>
              <div className="bg-muted/20 p-4 rounded border border-border">
                <h4 className="text-sm font-bold mb-2 uppercase text-muted-foreground">R1 MikroTik Config:</h4>
                <CodeBlock language="routeros" code={`# R1 — ether1=Internet(virbr0), ether2=Kali(DHCP server), ether3=pfSense WAN
/ip address add address=192.168.122.2/24 interface=ether1
/ip address add address=192.168.10.1/24  interface=ether2
/ip address add address=10.0.23.1/30     interface=ether3
/ip route add dst-address=0.0.0.0/0 gateway=192.168.122.1
/ip route add dst-address=10.0.0.0/8 gateway=10.0.23.2
/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade
/ip firewall filter add chain=forward action=accept place-before=0
# DHCP server for Kali (ether2)
/ip pool add name=kali-pool ranges=192.168.10.2-192.168.10.100
/ip dhcp-server add name=kali-dhcp interface=ether2 address-pool=kali-pool disabled=no
/ip dhcp-server network add address=192.168.10.0/24 gateway=192.168.10.1 dns-server=8.8.8.8`} />
              </div>
              <div className="bg-muted/20 p-4 rounded border border-border">
                <h4 className="text-sm font-bold mb-2 uppercase text-muted-foreground">Attacker VM Route (add each session):</h4>
                <CodeBlock language="bash" code={`# /etc/network/interfaces (persistent — DHCP + auto route)
auto eth0
iface eth0 inet dhcp
    post-up ip route add 10.0.0.0/8 via 192.168.10.1 || true

# Or manually per session:
sudo dhclient eth0
sudo ip route add 10.0.0.0/8 via 192.168.10.1`} />
              </div>
            </section>

            {/* ── 4. AEGIS VM Hub Setup ── */}
            <section id="aegis-vm" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                4. AEGIS VM Hub Setup (10.30.30.10)
              </h2>
              <p className="text-foreground leading-relaxed">
                The AEGIS VM is the central hub. It SSHes into bank-web and customer-db to tail their logs,
                then forwards all events to the Render API. Only this VM needs outbound HTTPS to the internet.
              </p>

              <CodeBlock language="bash" code={`# 1. Install dependencies
sudo apt update && sudo apt install -y python3-pip python3-requests openssh-client
sudo pip3 install requests

# 2. Download hub script
sudo mkdir -p /opt/aegis/scripts/src
cd /opt/aegis/scripts/src
wget -O aegis_forwarder.py \\
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py
wget -O aegis_forwarder.local.conf.example \\
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.local.conf.example`} />

              <CodeBlock language="bash" code={`# 3. Create config
sudo cp aegis_forwarder.local.conf.example aegis_forwarder.local.conf
sudo nano aegis_forwarder.local.conf`} />

              <CodeBlock language="ini" code={`# aegis_forwarder.local.conf — AEGIS VM hub settings
AEGIS_URL=https://aegis-api-server-jp3b.onrender.com/api
AEGIS_KEY=your-ingest-key
AEGIS_ADMIN_KEY=your-admin-key

# Hub mode: SSH into bank VMs
VM_NAME=aegis
BANK_WEB_IP=10.10.10.10
BANK_WEB_SSH_USER=sithu
CUSTOMER_DB_IP=10.20.20.10
CUSTOMER_DB_SSH_USER=sithu

# pfSense (for defense block commands)
PFSENSE_IP=10.30.30.1
PFSENSE_API_KEY=your-pfsense-api-key-here`} />

              <CodeBlock language="bash" code={`# 4. Setup SSH key auth (AEGIS VM → bank-web, customer-db)
ssh-keygen -t ed25519 -f ~/.ssh/aegis_hub -N ""
ssh-copy-id -i ~/.ssh/aegis_hub.pub sithu@10.10.10.10
ssh-copy-id -i ~/.ssh/aegis_hub.pub sithu@10.10.10.20
ssh-copy-id -i ~/.ssh/aegis_hub.pub sithu@10.20.20.10
ssh-copy-id -i ~/.ssh/aegis_hub.pub sithu@10.20.20.20

# Test SSH (should connect without password)
ssh -i ~/.ssh/aegis_hub sithu@10.10.10.10 "echo OK"
ssh -i ~/.ssh/aegis_hub sithu@10.10.10.20 "echo OK"
ssh -i ~/.ssh/aegis_hub sithu@10.20.20.10 "echo OK"
ssh -i ~/.ssh/aegis_hub sithu@10.20.20.20 "echo OK"`} />

              <CodeBlock language="bash" code={`# 5. Test run (hub mode)
cd /opt/aegis/scripts/src
sudo python3 aegis_forwarder.py --mode hub

# Should see:
# ► remote service health thread started
# ► pfSense health thread started
# ► defense agent thread started
# bank-web : suricata ONLINE, fail2ban ONLINE
# customer-db: postgresql ONLINE`} />

              <CodeBlock language="bash" code={`# 6. Install as systemd service
sudo nano /etc/systemd/system/aegis-forwarder.service`} />
              <CodeBlock language="ini" code={`[Unit]
Description=AEGIS Hub Forwarder
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/aegis/scripts/src
ExecStart=/usr/bin/python3 /opt/aegis/scripts/src/aegis_forwarder.py --mode hub
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target`} />
              <CodeBlock language="bash" code={`sudo systemctl daemon-reload
sudo systemctl enable --now aegis-forwarder
sudo journalctl -u aegis-forwarder -f

# Update script later:
wget -O /opt/aegis/scripts/src/aegis_forwarder.py \\
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py
sudo systemctl restart aegis-forwarder`} />
            </section>

            {/* ── 5. Bank VM Setup ── */}
            <section id="bank-vms" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                5. Bank VM Defense Tools Setup
              </h2>
              <p className="text-foreground">Install IDS/IPS tools on each bank VM. No forwarder script needed on bank VMs — the hub handles log collection via SSH.</p>

              <h3 className="text-sm font-bold uppercase text-primary mt-4">bank-web (10.10.10.10) — DMZ</h3>
              <CodeBlock language="bash" code={`# Web server + security tools
sudo apt install -y fail2ban apache2 ufw iptables

# ModSecurity WAF
sudo apt install -y libapache2-mod-security2
sudo a2enmod security2
sudo cp /etc/modsecurity/modsecurity.conf-recommended /etc/modsecurity/modsecurity.conf
sudo sed -i 's/SecRuleEngine DetectionOnly/SecRuleEngine On/' /etc/modsecurity/modsecurity.conf
sudo systemctl enable --now fail2ban apache2
sudo systemctl restart apache2`} />

              <h3 className="text-sm font-bold uppercase text-primary mt-4">dns-server (10.10.10.20) — Public</h3>
              <CodeBlock language="bash" code={`# DNS + security tools
sudo apt install -y bind9 bind9utils fail2ban ufw iptables

sudo systemctl enable --now fail2ban bind9`} />

              <h3 className="text-sm font-bold uppercase text-primary mt-4">customer-db (10.20.20.10) — Internal</h3>
              <CodeBlock language="bash" code={`# Database + security tools
sudo apt install -y fail2ban mysql-server ufw iptables

sudo systemctl enable --now fail2ban mysql`} />

              <h3 className="text-sm font-bold uppercase text-primary mt-4">atm-server (10.20.20.20) — Internal</h3>
              <CodeBlock language="bash" code={`# ATM API + security
sudo apt install -y python3 python3-pip python3-flask python3-psycopg2 fail2ban ufw iptables

# ATM service (connects to customer-db 10.20.20.10:5432)
sudo systemctl enable --now fail2ban`} />

              <h3 className="text-sm font-bold uppercase text-primary mt-4">Verify SSH from AEGIS VM</h3>
              <CodeBlock language="bash" code={`# From AEGIS VM (10.30.30.10):
ssh sithu@10.10.10.10 "sudo tail -5 /var/log/suricata/eve.json"
ssh sithu@10.10.10.20 "sudo systemctl status bind9"
ssh sithu@10.20.20.10 "sudo tail -5 /var/log/auth.log"
ssh sithu@10.20.20.20 "sudo systemctl status atm"`} />
            </section>

            {/* ── 6. pfSense Config ── */}
            <section id="firewall" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                6. pfSense Configuration
              </h2>
              <p className="text-foreground">pfSense manages all zone routing and WAN firewall rules. AEGIS integrates via REST API for auto-block.</p>

              <div className="bg-muted/20 p-4 rounded border border-border space-y-3 text-sm">
                <div>
                  <p className="font-bold text-primary mb-1">Interfaces Setup</p>
                  <div className="font-mono text-xs space-y-1 text-muted-foreground">
                    <p>em0 (WAN)      → 10.0.23.2/30  — upstream: R1 ether3</p>
                    <p>em1 (PUBLIC)   → 10.10.10.1/24 — OVS Public-Switch (bank-web, dns-server)</p>
                    <p>em2 (INTERNAL) → 10.20.20.1/24 — OVS Internal-Switch (customer-db, atm-server)</p>
                    <p>em3 (MGMT)     → 10.30.30.1/24 — direct to aegis-forwarder</p>
                  </div>
                </div>
                <div>
                  <p className="font-bold text-primary mb-1">Firewall Rules (minimum)</p>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>• WAN → PUBLIC: Allow TCP 80,443,21 → 10.10.10.10; UDP 53 → 10.10.10.20</p>
                    <p>• WAN → INTERNAL: Block all (internal zone not exposed)</p>
                    <p>• MGMT → PUBLIC/INTERNAL: Allow TCP 22 (aegis SSHes into all VMs)</p>
                    <p>• MGMT → any: Allow TCP 443 (aegis-forwarder → Render API outbound)</p>
                  </div>
                </div>
                <div>
                  <p className="font-bold text-primary mb-1">REST API Key (for AEGIS auto-block)</p>
                  <p className="text-xs text-muted-foreground">pfSense → System → API → Generate key → copy to <code className="text-primary">PFSENSE_API_KEY</code> in config</p>
                </div>
              </div>
            </section>

            {/* ── 7. Connect Live ── */}
            <section id="integration" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-destructive/50 pb-2 flex items-center gap-2">
                <Terminal className="h-5 w-5 text-destructive" />
                7. Connect Real Attacks to Dashboard
              </h2>
              <div className="bg-destructive/10 border border-destructive/30 rounded p-4 text-sm">
                <p className="font-bold text-destructive uppercase tracking-wider mb-1">Real-Time Integration</p>
                <p className="text-foreground">With the hub running, attacks show up live on the dashboard within seconds.</p>
              </div>

              <div className="bg-muted/20 border border-border rounded p-4">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Data Flow</p>
                <pre className="text-xs font-mono text-primary/80 leading-relaxed">{`Attacker (any IP)
    │  network traffic → R1 → pfSense → bank-web / customer-db
    ▼
Suricata / Fail2ban / SSH auth detects
    │
aegis_forwarder.py (hub on 10.30.30.10)
    │  SSHes in every 15s, tails new log lines
    │
    POST https://aegis-api-server-jp3b.onrender.com/api/ingest/*
    │
Dashboard — live event appears + auto-defense fires`}</pre>
              </div>

              <h3 className="text-base font-bold uppercase text-primary mt-6">Connection Test</h3>
              <CodeBlock language="bash" code={`# From AEGIS VM — test API connection
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/event \\
  -H "Content-Type: application/json" \\
  -H "X-AEGIS-Key: your-ingest-key" \\
  -d '{
    "source":"test",
    "type":"network_attack",
    "subtype":"Connection Test",
    "severity":"low",
    "sourceIp":"10.30.30.10",
    "description":"AEGIS hub connection test"
  }'`} />

              <h3 className="text-base font-bold uppercase text-primary mt-6">Telegram Alerts Setup</h3>
              <p className="text-sm text-foreground">Add to Render environment variables for instant Telegram notifications on all high+ alerts:</p>
              <CodeBlock language="bash" code={`TELEGRAM_BOT_TOKEN=your-bot-token   # from @BotFather
TELEGRAM_CHAT_ID=your-chat-id       # your Telegram user/group ID`} />

              <div className="bg-primary/5 border border-primary/20 rounded p-4 text-sm mt-4">
                <p className="text-primary font-bold uppercase tracking-wider mb-2">API Endpoints</p>
                <div className="space-y-1 font-mono text-xs text-muted-foreground">
                  <p><span className="text-green-400">POST</span> /api/ingest/event    — Generic event</p>
                  <p><span className="text-green-400">POST</span> /api/ingest/suricata  — Suricata EVE JSON</p>
                  <p><span className="text-green-400">POST</span> /api/ingest/fail2ban  — Fail2ban ban action</p>
                  <p><span className="text-green-400">POST</span> /api/ingest/ssh       — SSH auth.log events</p>
                  <p><span className="text-green-400">POST</span> /api/network/hosts    — Register VM as host</p>
                </div>
                <p className="text-muted-foreground mt-3 text-xs">Header: <code className="text-primary">X-AEGIS-Key: your-ingest-key</code></p>
              </div>
            </section>

            {/* ── 8. Attack Tests ── */}
            <section id="attack-tests" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                8. Attack Test Commands
              </h2>
              <p className="text-foreground text-sm mb-2">Run from the attacker VM after adding route: <code className="text-primary text-xs">sudo ip route add 10.0.0.0/8 via 192.168.10.1</code></p>

              <div className="bg-muted/20 border border-border rounded p-4 space-y-4 text-sm">
                {[
                  {
                    label: "Port Scan",
                    cmd: "nmap -sS -p 1-65535 10.10.10.10",
                    result: "Suricata ET SCAN rule → medium/high event + auto-block"
                  },
                  {
                    label: "SSH Brute",
                    cmd: "hydra -l root -P /usr/share/wordlists/rockyou.txt ssh://10.10.10.10",
                    result: "Fail2ban 5 fails → IP ban → high event + Telegram alert"
                  },
                  {
                    label: "SQL Injection",
                    cmd: 'sqlmap -u "http://10.10.10.10/login.php" --forms --batch',
                    result: "Suricata SQLi rule → critical event + pfSense block"
                  },
                  {
                    label: "DDoS SYN",
                    cmd: "hping3 -S --flood -V -p 80 10.10.10.10",
                    result: "Suricata DOS rule → high event"
                  },
                  {
                    label: "Web Enum",
                    cmd: "nikto -h http://10.10.10.10",
                    result: "Suricata/ModSec → web_attack events"
                  },
                  {
                    label: "DB Brute",
                    cmd: "hydra -l postgres -P /usr/share/wordlists/rockyou.txt postgres://10.20.20.10",
                    result: "Fail2ban on customer-db → high event"
                  },
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

              <div className="bg-muted/20 border border-border rounded p-4">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Defense Agent Flow</p>
                <pre className="text-xs font-mono text-primary/80 leading-relaxed">{`Attack detected → API auto-defense rule fires
    │
    INSERT defense_commands {status: "pending", target_vm: "ubuntu"}
    │
aegis_forwarder.py (hub) defense_agent_loop — polls every 5s
    ├── iptables -I INPUT -s <ATTACKER_IP> -j DROP    (ubuntu)
    └── pfSense REST API block_ip                     (pfsense)
    │
    PATCH /api/defense/commands/:id/result
    │
Dashboard Defense Center — command history updates live`}</pre>
              </div>
            </section>

          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
