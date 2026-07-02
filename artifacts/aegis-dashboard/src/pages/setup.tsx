import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Copy, Terminal, Check } from "lucide-react";
import { useState } from "react";

const CodeBlock = ({ code, language = "bash" }: { code: string, language?: string }) => {
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
        <p className="text-sm text-muted-foreground">Documentation for provisioning the Red/Blue team cybersecurity lab.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 flex-1 min-h-0">
        <div className="hidden md:block col-span-1">
          <div className="sticky top-0 bg-card border border-border rounded-lg p-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Contents</h3>
            <nav className="space-y-2 text-sm font-mono flex flex-col">
              <a href="#overview" className="text-primary hover:underline hover:text-primary/80">1. Project Overview</a>
              <a href="#requirements" className="text-foreground hover:underline hover:text-primary/80">2. VM Requirements</a>
              <a href="#network" className="text-foreground hover:underline hover:text-primary/80">3. Network Config</a>
              <a href="#attack" className="text-foreground hover:underline hover:text-primary/80">4. Attack Tools (Kali)</a>
              <a href="#defense" className="text-foreground hover:underline hover:text-primary/80">5. Defense Tools</a>
              <a href="#elk" className="text-foreground hover:underline hover:text-primary/80">6. ELK Stack</a>
              <a href="#firewall" className="text-foreground hover:underline hover:text-primary/80">7. Firewall & WAF</a>
              <a href="#output" className="text-foreground hover:underline hover:text-primary/80">8. Output Tools</a>
              <a href="#integration" className="text-destructive hover:underline hover:text-destructive/80 font-bold">9. Connect Real Attacks</a>
            </nav>
          </div>
        </div>

        <ScrollArea className="col-span-1 md:col-span-3 bg-card border border-border rounded-lg">
          <div className="p-6 md:p-8 space-y-12">
            
            <section id="overview" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2 flex items-center gap-2">
                <Terminal className="h-5 w-5" /> 1. Project Overview
              </h2>
              <p className="text-foreground leading-relaxed">
                AEGIS is a comprehensive Red/Blue team cybersecurity lab designed for a 5-person security team. 
                It provides a realistic environment for simulating attacks (Red Team) and monitoring/defending against them (Blue Team).
              </p>
              <div className="bg-muted/20 p-4 rounded border border-border">
                <h4 className="text-sm font-bold mb-2 uppercase text-muted-foreground">Environments Used:</h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-foreground ml-4">
                  <li>Kali Linux (Attacker)</li>
                  <li>Ubuntu Server (Defense / Brain)</li>
                  <li>Windows (Victim / Honeypot)</li>
                  <li>pfSense (Firewall / Router)</li>
                </ul>
              </div>
            </section>

            <section id="requirements" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                2. VM Requirements
              </h2>
              <p className="text-sm text-muted-foreground mb-4">Minimum specifications for the lab environment. Host PC requires 16GB RAM, 100GB storage.</p>
              <Table className="border border-border">
                <TableHeader className="bg-muted/30">
                  <TableRow className="border-border">
                    <TableHead>Virtual Machine</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>RAM</TableHead>
                    <TableHead>Storage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="border-border">
                    <TableCell className="font-medium text-primary">VM1: Kali Linux</TableCell>
                    <TableCell>Attacker</TableCell>
                    <TableCell className="font-mono text-muted-foreground">4GB</TableCell>
                    <TableCell className="font-mono text-muted-foreground">40GB</TableCell>
                  </TableRow>
                  <TableRow className="border-border">
                    <TableCell className="font-medium text-primary">VM2: Ubuntu Server</TableCell>
                    <TableCell>Defense/Brain</TableCell>
                    <TableCell className="font-mono text-muted-foreground">8GB</TableCell>
                    <TableCell className="font-mono text-muted-foreground">80GB</TableCell>
                  </TableRow>
                  <TableRow className="border-border">
                    <TableCell className="font-medium text-primary">VM3: Windows</TableCell>
                    <TableCell>Victim</TableCell>
                    <TableCell className="font-mono text-muted-foreground">4GB</TableCell>
                    <TableCell className="font-mono text-muted-foreground">60GB</TableCell>
                  </TableRow>
                  <TableRow className="border-border">
                    <TableCell className="font-medium text-primary">VM4: pfSense</TableCell>
                    <TableCell>Firewall</TableCell>
                    <TableCell className="font-mono text-muted-foreground">1GB</TableCell>
                    <TableCell className="font-mono text-muted-foreground">10GB</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </section>

            <section id="network" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                3. Network Configuration
              </h2>
              <p className="text-foreground leading-relaxed">
                The lab uses an isolated virtual network managed by pfSense.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                <div className="bg-muted/20 p-4 rounded border border-border">
                  <h4 className="text-sm font-bold mb-2 uppercase text-primary">pfSense Adapter 1 (WAN)</h4>
                  <p className="text-sm text-muted-foreground font-mono">NAT Network</p>
                  <p className="text-xs mt-2">Provides internet access to the lab while keeping it isolated from the host network.</p>
                </div>
                <div className="bg-muted/20 p-4 rounded border border-border">
                  <h4 className="text-sm font-bold mb-2 uppercase text-primary">pfSense Adapter 2 (LAN)</h4>
                  <p className="text-sm text-muted-foreground font-mono">Host-Only Adapter</p>
                  <p className="text-xs mt-2">The internal lab network where all other VMs reside (Kali, Ubuntu, Windows).</p>
                </div>
              </div>
            </section>

            <section id="attack" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                4. Attack Tools (Kali Linux)
              </h2>
              <p className="text-foreground">Tools used by the Red Team to simulate various attack vectors.</p>
              
              <CodeBlock 
                language="bash"
                code={`# Update system first
sudo apt update && sudo apt upgrade -y

# Install core attack toolset
sudo apt install -y nmap sqlmap nikto metasploit-framework hping3 dsniff burpsuite

# Install GoPhish for phishing simulation
wget https://github.com/gophish/gophish/releases/download/v0.12.1/gophish-v0.12.1-linux-64bit.zip
unzip gophish-v0.12.1-linux-64bit.zip -d gophish
cd gophish && chmod +x gophish`} 
              />
            </section>

            <section id="defense" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                5. Defense Tools (Ubuntu Server)
              </h2>
              <p className="text-foreground">Intrusion detection, prevention, and network monitoring tools.</p>
              
              <CodeBlock 
                language="bash"
                code={`# Install IDS/IPS and network tools
sudo apt install -y snort suricata fail2ban ufw iptables tshark tcpdump openssl

# Configure Cowrie Honeypot
sudo apt install -y git python3-virtualenv libssl-dev libffi-dev build-essential libpython3-dev python3-minimal authbind
sudo adduser --disabled-password cowrie
sudo su - cowrie
git clone http://github.com/cowrie/cowrie
cd cowrie
virtualenv --python=python3 cowrie-env
source cowrie-env/bin/activate
pip install upgrade pip
pip install -r requirements.txt`} 
              />
            </section>

            <section id="elk" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                6. ELK Stack (Ubuntu Server)
              </h2>
              <p className="text-foreground">Centralized logging and visualization for the Blue Team.</p>
              
              <CodeBlock 
                language="bash"
                code={`# Import Elasticsearch PGP Key and add repo
wget -qO - https://artifacts.elastic.co/GPG-KEY-elasticsearch | sudo gpg --dearmor -o /usr/share/keyrings/elasticsearch-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/elasticsearch-keyring.gpg] https://artifacts.elastic.co/packages/8.x/apt stable main" | sudo tee /etc/apt/sources.list.d/elastic-8.x.list

# Install Elasticsearch, Logstash, Kibana, Filebeat
sudo apt update
sudo apt install -y elasticsearch logstash kibana filebeat

# Enable and start services
sudo systemctl daemon-reload
sudo systemctl enable --now elasticsearch.service
sudo systemctl enable --now kibana.service
sudo systemctl enable --now logstash.service`} 
              />
              <div className="bg-muted/20 p-4 rounded border border-border mt-2">
                <h4 className="text-sm font-bold mb-2 uppercase text-muted-foreground">Default Ports:</h4>
                <ul className="list-disc list-inside space-y-1 text-sm font-mono text-primary ml-4">
                  <li>Elasticsearch: 9200</li>
                  <li>Logstash: 5044</li>
                  <li>Kibana: 5601</li>
                </ul>
              </div>
            </section>

            <section id="firewall" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                7. Firewall + WAF
              </h2>
              <p className="text-foreground">Network perimeter defense configuration.</p>
              
              <CodeBlock 
                language="bash"
                code={`# Install ModSecurity for Apache/Nginx on Ubuntu (if hosting web services)
sudo apt install -y libapache2-mod-security2
sudo a2enmod security2
sudo systemctl restart apache2

# Download OWASP Core Rule Set
sudo mv /etc/modsecurity/modsecurity.conf-recommended /etc/modsecurity/modsecurity.conf
cd /tmp
wget https://github.com/coreruleset/coreruleset/archive/v3.3.2.zip
unzip v3.3.2.zip
sudo mv coreruleset-3.3.2/crs-setup.conf.example /etc/modsecurity/crs-setup.conf
sudo mv coreruleset-3.3.2/rules/ /etc/modsecurity/`} 
              />
            </section>

            <section id="output" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-border/50 pb-2">
                8. Output & Reporting Tools
              </h2>
              <p className="text-foreground">Tools for alerting and generating PDF reports.</p>
              <CodeBlock
                language="bash"
                code={`# Install Python dependencies for Telegram bot and PDF generation
pip install python-telegram-bot fpdf reportlab

# Example Telegram Bot Setup (save as bot.py)
# import telegram
# bot = telegram.Bot(token='YOUR_BOT_TOKEN')
# bot.send_message(chat_id='YOUR_CHAT_ID', text='AEGIS Alert: Critical Event Detected')`}
              />
            </section>

            {/* ── REAL INTEGRATION ── */}
            <section id="integration" className="space-y-4">
              <h2 className="text-xl font-bold uppercase text-primary border-b border-destructive/50 pb-2 flex items-center gap-2">
                <Terminal className="h-5 w-5 text-destructive" />
                9. Connect Real Attacks to AEGIS Dashboard
              </h2>
              <div className="bg-destructive/10 border border-destructive/30 rounded p-4 text-sm">
                <p className="font-bold text-destructive uppercase tracking-wider mb-1">Real-Time Integration</p>
                <p className="text-foreground">ဒီ section မှာ Kali က real attack လုပ်လိုက်တဲ့အချိန် Ubuntu ရှိ Snort/Suricata/Fail2ban တွေ detect လုပ်ပြီး AEGIS Dashboard မှာ live ပေါ်လာစေဖို့ setup လုပ်နည်း step-by-step ဖော်ပြထားပါသည်။</p>
              </div>

              <div className="bg-muted/20 border border-border rounded p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Flow Diagram</p>
                <pre className="text-xs font-mono text-primary/80 leading-relaxed">{`Kali Linux (sqlmap / nmap / hping3)
        │
        │  network traffic (VirtualBox Host-Only)
        ▼
Ubuntu Server — Snort / Suricata detects alert
        │
        │  aegis_forwarder.py watches log files
        ▼
AEGIS API  POST /api/ingest/suricata
        │
        │  SSE broadcast to all browsers
        ▼
Dashboard — live event appears in real-time`}</pre>
              </div>

              <h3 className="text-base font-bold uppercase text-primary mt-6">Step 1 — AEGIS API URL ရယူပါ</h3>
              <p className="text-sm text-foreground">API server URL နှင့် ingest key ကို Ubuntu VM မှာ environment variable အဖြစ် export လုပ်ပါ။</p>
              <CodeBlock language="bash" code={`# AEGIS API server (Render)
export AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api"
export AEGIS_KEY="your-aegis-ingest-key"

# Test connection:
curl -X POST "$AEGIS_URL/ingest/event" \\
  -H "Content-Type: application/json" \\
  -H "X-AEGIS-Key: $AEGIS_KEY" \\
  -d '{
    "source": "test",
    "type": "web_attack",
    "subtype": "Connection Test",
    "severity": "low",
    "sourceIp": "192.168.1.1",
    "description": "AEGIS connection test from Ubuntu server"
  }'`} />

              <h3 className="text-base font-bold uppercase text-primary mt-6">Step 2 — Ubuntu Server မှာ Forwarder Script ထည့်ပါ</h3>
              <CodeBlock language="bash" code={`# Ubuntu Server မှာ run ပါ
sudo apt install python3-pip -y
pip3 install requests

# Forwarder script ကို download (သို့မဟုတ် Dashboard မှ copy) ပြီး save ပါ
nano /opt/aegis_forwarder.py
# (scripts/src/aegis_forwarder.py ထဲက content ကို paste ပါ)

chmod +x /opt/aegis_forwarder.py`} />

              <h3 className="text-base font-bold uppercase text-primary mt-6">Step 3 — Suricata ချိတ်ဆွဲပါ (အကောင်းဆုံး)</h3>
              <p className="text-sm text-foreground mb-2">Suricata က <code className="bg-muted px-1 rounded text-primary">/var/log/suricata/eve.json</code> ထဲ JSON format ဖြင့် alert ရေးသည်။ Forwarder က ၎င်းကို read ပြီး AEGIS ဆီ push သည်။</p>
              <CodeBlock language="bash" code={`# Suricata ကို Home Network interface မှာ run ပါ
sudo suricata -c /etc/suricata/suricata.yaml -i eth1 -D

# AEGIS Forwarder ကို Suricata mode ဖြင့် run ပါ
AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api" \\
AEGIS_KEY="your-aegis-ingest-key" \\
python3 /opt/aegis_forwarder.py --mode suricata`} />

              <h3 className="text-base font-bold uppercase text-primary mt-6">Step 4 — Snort ချိတ်ဆွဲပါ</h3>
              <CodeBlock language="bash" code={`# Snort ကို alert_fast output mode ဖြင့် run ပါ
sudo snort -c /etc/snort/snort.conf -i eth1 -A fast -D

# AEGIS Forwarder — Snort mode
AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api" \\
AEGIS_KEY="your-aegis-ingest-key" \\
python3 /opt/aegis_forwarder.py --mode snort`} />

              <h3 className="text-base font-bold uppercase text-primary mt-6">Step 5 — Fail2ban ချိတ်ဆွဲပါ</h3>
              <CodeBlock language="bash" code={`# /etc/fail2ban/action.d/aegis.conf ဖိုင်အသစ် ဖန်တီးပါ
sudo nano /etc/fail2ban/action.d/aegis.conf`} />
              <CodeBlock language="ini" code={`[Definition]
actionban = curl -s -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/fail2ban \\
            -H "Content-Type: application/json" \\
            -H "X-AEGIS-Key: your-aegis-ingest-key" \\
            -d '{"ip":"<ip>","jail":"<name>","failures":"<failures>"}'`} />
              <CodeBlock language="bash" code={`# /etc/fail2ban/jail.local မှာ action ထည့်ပါ
sudo nano /etc/fail2ban/jail.local

# [sshd] section အောက်မှာ ဒါ ထည့်ပါ:
# action = %(action_)s
#          aegis

sudo systemctl restart fail2ban`} />

              <h3 className="text-base font-bold uppercase text-primary mt-6">Step 6 — Cowrie Honeypot ချိတ်ဆွဲပါ</h3>
              <CodeBlock language="bash" code={`# Cowrie VM မှာ run ပါ (cowrie user အဖြစ်)
AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api" \\
AEGIS_KEY="your-aegis-ingest-key" \\
python3 /opt/aegis_forwarder.py --mode cowrie`} />

              <h3 className="text-base font-bold uppercase text-primary mt-6">Step 7 — Kali မှ Attack လုပ်ပြီး Real-Time ကြည့်ပါ</h3>
              <div className="bg-muted/20 border border-border rounded p-4 space-y-3 text-sm">
                <div className="flex gap-3 items-start">
                  <span className="text-destructive font-bold font-mono shrink-0">[Kali]</span>
                  <div>
                    <p className="font-bold text-foreground">SQL Injection Attack:</p>
                    <code className="text-xs text-primary/80">sqlmap -u "http://&lt;UBUNTU_IP&gt;/login.php" --forms --batch --level=3</code>
                    <p className="text-muted-foreground mt-1 text-xs">→ Suricata detects SQL injection signature → AEGIS Dashboard မှာ Critical event ပေါ်လာသည်</p>
                  </div>
                </div>
                <div className="flex gap-3 items-start">
                  <span className="text-destructive font-bold font-mono shrink-0">[Kali]</span>
                  <div>
                    <p className="font-bold text-foreground">Port Scan:</p>
                    <code className="text-xs text-primary/80">nmap -sS -p 1-65535 &lt;UBUNTU_IP&gt;</code>
                    <p className="text-muted-foreground mt-1 text-xs">→ Snort ET SCAN rule trigger → Dashboard မှာ Medium event ပေါ်လာသည်</p>
                  </div>
                </div>
                <div className="flex gap-3 items-start">
                  <span className="text-destructive font-bold font-mono shrink-0">[Kali]</span>
                  <div>
                    <p className="font-bold text-foreground">SSH Brute Force:</p>
                    <code className="text-xs text-primary/80">hydra -l root -P /usr/share/wordlists/rockyou.txt ssh://&lt;UBUNTU_IP&gt;</code>
                    <p className="text-muted-foreground mt-1 text-xs">→ Fail2ban 5 failures နောက် ban → AEGIS မှာ "IP Banned" alert ပေါ်သည်</p>
                  </div>
                </div>
                <div className="flex gap-3 items-start">
                  <span className="text-destructive font-bold font-mono shrink-0">[Kali]</span>
                  <div>
                    <p className="font-bold text-foreground">DDoS Simulation:</p>
                    <code className="text-xs text-primary/80">hping3 -S --flood -V -p 80 &lt;UBUNTU_IP&gt;</code>
                    <p className="text-muted-foreground mt-1 text-xs">→ Suricata DOS rule trigger → Dashboard မှာ High event ပေါ်လာသည်</p>
                  </div>
                </div>
              </div>

              <h3 className="text-base font-bold uppercase text-primary mt-6">All Modes တပြိုင်တည်း Run ပါ</h3>
              <p className="text-sm text-muted-foreground mb-2">Snort + Suricata + Fail2ban + Cowrie တပြိုင်တည်း watch ဖို့:</p>
              <CodeBlock language="bash" code={`AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api" \\
AEGIS_KEY="your-aegis-ingest-key" \\
python3 /opt/aegis_forwarder.py --mode all

# Background service အနေနဲ့ run ဖို့:
nohup python3 /opt/aegis_forwarder.py --mode all > /var/log/aegis-forwarder.log 2>&1 &`} />

              <div className="bg-primary/5 border border-primary/20 rounded p-4 text-sm mt-4">
                <p className="text-primary font-bold uppercase tracking-wider mb-2">API Endpoints Reference</p>
                <div className="space-y-1 font-mono text-xs text-muted-foreground">
                  <p><span className="text-green-400">POST</span> /api/ingest/event    — Generic (any source)</p>
                  <p><span className="text-green-400">POST</span> /api/ingest/snort     — Snort alert_fast format</p>
                  <p><span className="text-green-400">POST</span> /api/ingest/suricata  — Suricata EVE JSON</p>
                  <p><span className="text-green-400">POST</span> /api/ingest/fail2ban  — Fail2ban ban action</p>
                  <p><span className="text-green-400">POST</span> /api/ingest/cowrie    — Cowrie JSON log</p>
                </div>
                <p className="text-muted-foreground mt-3 text-xs">Header required: <code className="text-primary">X-AEGIS-Key: your-key</code></p>
              </div>
            </section>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
