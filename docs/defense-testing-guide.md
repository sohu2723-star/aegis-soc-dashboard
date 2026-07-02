# AEGIS Defense System — Testing & Command Reference

> မှတ်တမ်း — ဒီ document က IP block/unblock mechanism, auto-defense flow, နဲ့ testing commands အားလုံးကို အသေးစိတ်မှတ်တမ်းတင်ထားသည်။

---

## 1. IP Block က Real-Time လား? Queue လား?

**ဖြေ: Queue ပေမယ့် near real-time ဖြစ်သည်**

```
Attack ဝင်လာ
    │
    ▼
API Server (Render) — defense_commands table မှာ INSERT (status: pending)
    │
    ▼
Ubuntu VM Agent — GET /api/defense/commands/pending?vm=ubuntu ကို poll လုပ်သည်
    │  (polling interval ပေါ်မူတည်သည်, aegis_forwarder.py မှာ သတ်မှတ်)
    ▼
Agent runs iptables / ip route command on the VM
    │
    ▼
POST /api/defense/commands/:id/result — agent reports executed
```

- **Database မှာ**: block record ချက်ချင်း ရောက်သည် (real-time)
- **VM မှာ**: agent poll interval ပေါ်မူတည်၍ ၁–၅ seconds နောက်ကျနိုင်သည်
- **Dashboard မှာ**: block status ချက်ချင်း ပြသည် (SSE via /api/stream)

---

## 2. Auto-Block — ဘယ်လို Trigger ဖြစ်သလဲ

### Trigger Conditions (auto-defense.ts)

| Attack Type | Event Type | Threshold Example |
|---|---|---|
| SSH Brute Force | `ssh` / `brute_force` | N failed logins within window |
| Port Scan | `network` / `port_scan` | N events within window |
| DDoS / SYN Flood | `network` / `ddos` | N events within window |
| Fail2ban Ban | `fail2ban` / `ban` | ၁ event (immediately) |
| Cowrie Honeypot | `cowrie` / `* ` | ၁ event (immediately) |
| Web Attack (SQLi/XSS) | `web` / `sql_injection` etc. | N events within window |

### Auto-Block ဖြစ်ရင် ဘာ Command Run သလဲ

```bash
# block_ip action
iptables -I INPUT -s <ATTACKER_IP> -j DROP

# null_route action (alternative)
ip route add blackhole <ATTACKER_IP>/32

# rate_limit action
iptables -I INPUT -s <ATTACKER_IP> -m limit --limit <rate>/min --limit-burst 20 -j ACCEPT
iptables -A INPUT -s <ATTACKER_IP> -j DROP
```

---

## 3. Manual Block — Admin API

### Block an IP (Manual)

```bash
# via curl — X-AEGIS-Admin-Key required
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/defense/block \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Admin-Key: YOUR_ADMIN_KEY" \
  -d '{
    "ip": "192.168.1.100",
    "reason": "Manual block for testing"
  }'
```

**Response:**
```json
{
  "success": true,
  "blocked": {
    "ip": "192.168.1.100",
    "blockedBy": "manual",
    "isActive": true,
    "blockedAt": "2026-07-02T..."
  }
}
```

### Firewall Rule ထည့်သည် (iptables command ကို VM ကို queue လုပ်သည်)

```bash
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/firewall/rules \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Admin-Key: YOUR_ADMIN_KEY" \
  -d '{
    "action": "block_ip",
    "targetIp": "192.168.1.100",
    "reason": "Attacker IP",
    "targetVm": "ubuntu"
  }'
```

---

## 4. Unblock — IP ကို ပြန်ဖွင့်သည်

### Unblock via API

```bash
# DELETE endpoint — IP ကို URL encode မလုပ်ပဲ ထည့်ရသည်
curl -X DELETE https://aegis-api-server-jp3b.onrender.com/api/defense/block/192.168.1.100 \
  -H "X-AEGIS-Admin-Key: YOUR_ADMIN_KEY"
```

**Response:**
```json
{
  "success": true,
  "unblocked": {
    "ip": "192.168.1.100",
    "unblockedAt": "2026-07-02T..."
  }
}
```

### VM မှာ ကိုယ်တိုင် Manually Unblock (Ubuntu Terminal)

```bash
# iptables rule ဖျက်သည်
sudo iptables -D INPUT -s 192.168.1.100 -j DROP

# null route ဖျက်သည်
sudo ip route del blackhole 192.168.1.100/32

# လက်ရှိ block rules ကြည့်သည်
sudo iptables -L INPUT -n --line-numbers | grep 192.168.1.100

# iptables rules အားလုံး flush (testing only — ⚠️ caution)
sudo iptables -F INPUT
```

---

## 5. Defense Commands — Agent Polling Flow

### Ubuntu VM Agent (aegis_forwarder.py) — Pending Commands Poll

```bash
# Agent ကိုယ်တိုင် call လုပ်သည် — manual test အတွက်
curl "https://aegis-api-server-jp3b.onrender.com/api/defense/commands/pending?vm=ubuntu" \
  -H "X-AEGIS-Key: YOUR_INGEST_KEY"
```

**Response:**
```json
{
  "commands": [
    {
      "id": 42,
      "commandText": "iptables -I INPUT -s 192.168.1.100 -j DROP",
      "undoCommand": "iptables -D INPUT -s 192.168.1.100 -j DROP",
      "targetVm": "ubuntu",
      "status": "sent"
    }
  ]
}
```

### Command ကို Executed အဖြစ် Report ပြန်သည်

```bash
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/defense/commands/42/result \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: YOUR_INGEST_KEY" \
  -d '{
    "status": "executed",
    "output": "Rule added successfully"
  }'
```

### Command History ကြည့်သည်

```bash
curl "https://aegis-api-server-jp3b.onrender.com/api/defense/commands/history" \
  -H "X-AEGIS-Admin-Key: YOUR_ADMIN_KEY"
```

---

## 6. Auto-Block Testing — Step by Step

### Test Scenario A: SSH Brute Force → Auto-Block

```bash
# Kali VM မှ — SSH brute force attack
hydra -l root -P /usr/share/wordlists/rockyou.txt ssh://UBUNTU_IP -t 4 -V

# Ubuntu VM မှာ Fail2ban က ban လုပ်သည်
# aegis_forwarder.py က /api/ingest/fail2ban ကို POST လုပ်သည်
# API server က auto-defense rule evaluate လုပ်သည်
# defense_commands မှာ iptables block command ထည့်သည်
# Agent poll လုပ်ပြီး execute လုပ်သည်
```

**Dashboard မှာ ကြည့်ရမည်:**
- Security Events → fail2ban ban event ပေါ်သည်
- Defense Center → Kali IP blocked ပြသည်

### Test Scenario B: Port Scan → Auto-Block

```bash
# Kali VM မှ
nmap -sS -p 1-65535 UBUNTU_IP --min-rate=1000

# Snort/Suricata က detect လုပ်သည်
# forwarder က /api/ingest/snort သို့မဟုတ် /api/ingest/suricata ကို POST
# threshold ကျော်ရင် auto-block trigger
```

### Test Scenario C: Direct Ingest Test (VM မလိုဘဲ)

```bash
# Fail2ban event simulate လုပ်သည် — auto-block trigger ဖြစ်ရမည်
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/fail2ban \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: YOUR_INGEST_KEY" \
  -d '{
    "ip": "10.10.10.99",
    "service": "sshd",
    "action": "ban",
    "timestamp": "2026-07-02T10:00:00Z"
  }'

# Cowrie honeypot event simulate — ချက်ချင်း auto-block
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/cowrie \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: YOUR_INGEST_KEY" \
  -d '{
    "eventid": "cowrie.login.failed",
    "src_ip": "10.10.10.99",
    "username": "root",
    "password": "123456",
    "timestamp": "2026-07-02T10:00:00Z"
  }'
```

### Test Scenario D: SSH Attack

```bash
# Kali မှ SSH brute force
hydra -l root -P /usr/share/wordlists/rockyou.txt ssh://UBUNTU_IP

# Manual ingest test
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/ssh \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: YOUR_INGEST_KEY" \
  -d '{
    "src_ip": "10.10.10.99",
    "username": "root",
    "auth_method": "password",
    "success": false,
    "timestamp": "2026-07-02T10:00:00Z"
  }'
```

### Test Scenario E: Web Attack (SQLi/XSS)

```bash
# sqlmap attack
sqlmap -u "http://UBUNTU_IP/login?id=1" --batch --level=3

# Manual ingest test
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/http \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: YOUR_INGEST_KEY" \
  -d '{
    "src_ip": "10.10.10.99",
    "attack_type": "sql_injection",
    "uri": "/login?id=1 OR 1=1--",
    "method": "GET",
    "status_code": 403,
    "timestamp": "2026-07-02T10:00:00Z"
  }'
```

---

## 7. Attack လုပ်ပြီးရင် Unblock လုပ်သည် (Testing Reset)

```bash
# Step 1: Dashboard မှာ Defense Center → blocked IP list ကြည့်သည်
curl "https://aegis-api-server-jp3b.onrender.com/api/defense/blocks" \
  -H "X-AEGIS-Admin-Key: YOUR_ADMIN_KEY"

# Step 2: API မှ unblock လုပ်သည်
curl -X DELETE https://aegis-api-server-jp3b.onrender.com/api/defense/block/10.10.10.99 \
  -H "X-AEGIS-Admin-Key: YOUR_ADMIN_KEY"

# Step 3: Ubuntu VM မှာ iptables rule ကိုလည်း manually ဖျက်သည်
sudo iptables -D INPUT -s 10.10.10.99 -j DROP

# Step 4: Verify — block မရှိတော့ကြောင်း confirm
sudo iptables -L INPUT -n | grep 10.10.10.99
# (output မထွက်ရင် unblocked ပြီ)
```

---

## 8. Firewall Rules — Export & Apply

```bash
# Active firewall rules bash script export
curl "https://aegis-api-server-jp3b.onrender.com/api/firewall/rules/export" \
  -H "X-AEGIS-Admin-Key: YOUR_ADMIN_KEY" \
  -o aegis-firewall-rules.sh

# Ubuntu VM မှာ apply လုပ်သည်
chmod +x aegis-firewall-rules.sh
sudo ./aegis-firewall-rules.sh
```

---

## 9. Ingest Endpoints Summary

| Endpoint | မည်သည့် Source | Attack Type |
|---|---|---|
| `POST /api/ingest/event` | Any | Generic security event |
| `POST /api/ingest/snort` | Snort IDS | Network alerts (port scan, SYN flood) |
| `POST /api/ingest/suricata` | Suricata | EVE JSON alerts |
| `POST /api/ingest/suricata/tls` | Suricata | TLS anomalies, weak ciphers |
| `POST /api/ingest/fail2ban` | Fail2ban | Ban events → **auto-block IP** ချက်ချင်း |
| `POST /api/ingest/ssh` | auth.log | SSH login success/fail |
| `POST /api/ingest/ftp` | vsftpd/proftpd | FTP session + file exfil |
| `POST /api/ingest/http` | ModSecurity/Nginx | SQLi, XSS, LFI, RFI, CSRF |
| `POST /api/ingest/cowrie` | Cowrie | Honeypot → **auto-block IP** ချက်ချင်း |

---

## 10. Defense & Firewall Admin Endpoints Summary

| Endpoint | Method | Description |
|---|---|---|
| `/api/defense/block` | POST | Manual IP block |
| `/api/defense/block/:ip` | DELETE | Unblock IP |
| `/api/defense/blocks` | GET | List all blocked IPs |
| `/api/defense/commands/pending` | GET | Agent polls pending commands |
| `/api/defense/commands/:id/result` | POST | Agent reports execution result |
| `/api/defense/commands/history` | GET | Full command audit log |
| `/api/firewall/rules` | GET | List all firewall rules |
| `/api/firewall/rules` | POST | Add manual firewall rule |
| `/api/firewall/rules/:id` | DELETE | Deactivate a rule |
| `/api/firewall/rules/export` | GET | Export rules as bash script |

---

## 11. Headers Reference

| Header | Value | Used For |
|---|---|---|
| `X-AEGIS-Key` | `AEGIS_INGEST_KEY` value | Ingest endpoints (/api/ingest/*) |
| `X-AEGIS-Admin-Key` | `AEGIS_ADMIN_KEY` value | Admin/defense endpoints |
| `Content-Type` | `application/json` | POST requests |

---

## 12. Important Notes

1. **iptables rules က reboot မှာ reset ဖြစ်သည်** — persistent ဖြစ်ချင်ရင် `iptables-save` / `iptables-persistent` သုံးရမည်
2. **Render free tier cold start ~50s** — first request after inactivity ကြာနိုင်သည်
3. **Unblock = DB update သာ** — VM ပေါ်မှာ iptables rule ကိုပါ manually ဖျက်ရမည် (step 7 ကြည့်)
4. **Auto-defense** က defense_commands queue မှတဆင့် VM ကို command ပို့သည် — agent running ဖြစ်မှသာ execute ဖြစ်သည်
5. **Replit URL မသုံးရ** — API server URL အမြဲ `https://aegis-api-server-jp3b.onrender.com` ဖြစ်ရမည်

---

*Last updated: 2026-07-02 | AEGIS SOC Dashboard*
