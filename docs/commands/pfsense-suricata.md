# pfSense — Suricata NIDS Setup Guide
> **Why pfSense မှာ Suricata?** pfSense က traffic အကုန်မြင်တယ် (bank-web, customer-db, DNS, LDAP ဖြတ်တဲ့ packet အကုန်)  
> VM တစ်ခုချင်းမှာ ထည့်ရင် ထို VM ရဲ့ traffic တစ်ခုတည်းပဲ monitor လုပ်နိုင်တယ်  
> **Last updated:** 2026-07-20

---

## ဘာ Interfaces မှာ run ရမလဲ

| Interface | pfSense | Monitor ဖြစ်ရင် မြင်တာ |
|---|---|---|
| em1 (DMZ) | ✅ **ထည့်** | bank-web, DNS-Server ရောက်သည့် traffic အကုန် |
| em2 (INT) | ✅ **ထည့်** | customer-db, LDAP-Server ရောက်သည့် traffic အကုန် |
| em0 (WAN) | ⚠️ optional | internet ဘက်က ဝင်လာသမျှ (attacker ↔ pfSense WAN) |

> **Best practice:** em1 + em2 ထည့်ရုံနဲ့ bank traffic အကုန် cover ဖြစ်တယ်

---

## Step 1 — Suricata Package Install

pfSense WebGUI (`https://10.0.23.2`) မှာ:

```
System → Package Manager → Available Packages
  → Search: "suricata"
  → Suricata → [+ Install] → Confirm
```

Install ပြီးရင် **Services → Suricata** မဲနူး ပေါ်မည်

---

## Step 2 — Global Settings

```
Services → Suricata → Global Settings

☑ Enable Suricata
☑ Install ETOpen Emerging Threats Rules         ← free rules, ထည့်
☑ Install Snort Community Rules                 ← optional
☑ Auto-update rules: Daily

ETOpen Emerging Threats → [No Oinkcode needed — free]
→ Save
```

---

## Step 3 — Rules Update (ပထမဆုံး)

```
Services → Suricata → Updates → [Update Rules]
```

> Rules download ပြီးရင် `/var/db/suricata/rules/` မှာ `.rules` files ရောက်မည်

---

## ⚠️ Interface Setup မတိုင်ခင် — Hardware Offloading Fix (မဖြစ်မနေ)

Suricata start မဖြစ်ဘူးဆိုရင် ဒါကြောင့် ဖြစ်တတ်တယ်:

```
System → Advanced → Networking tab

☑ Disable hardware checksum offload
☑ Disable hardware TCP segmentation offload
☑ Disable hardware large receive offload

→ Save → pfSense Reboot
```

---

## Step 4 — Interface Setup (em1 = DMZ)

```
Services → Suricata → Interfaces → [+ Add]

Interface Settings tab:
  Interface: em1 (DMZ)
  ☑ Enable
  Description: DMZ-Monitor

Performance tab:
  Run Mode: Workers
  Detection Engine Profile: Medium

Alert Settings tab:
  ☑ Block Offenders: [Enable] (auto-block ချင်ရင်)
  Kill States: [checked]

Logging Settings tab:
  ☑ Enable EVE JSON Log          ← ဒါ အဓိက — aegis ဖတ်မယ်
  EVE Output Type: file
  ☑ Alert data
  ☑ HTTP data
  ☑ DNS data
  ☑ TLS data
  ☑ SMTP data
  EVE Log Facility: loglocal0

→ Save
```

em2 (INT) အတွက်လည်း Step 4 ကို ထပ်လုပ်ပါ (Interface = em2 မပြောင်းတာ)

> **Lab မှာ Blocking Mode = DISABLED ထားပါ** — LEGACY MODE သုံးရင် attacker block ဖြစ်သွားပြီး attack testing ဆက်မဖြစ်တော့ဘူး

---

## ⚠️ Interface Name အမှန် (pfSense VLAN ဆိုရင်)

pfSense မှာ interface names က GUI label နဲ့ ကွဲနိုင်တယ်:

| GUI Label | Interface | Suricata folder |
|---|---|---|
| PUBLIC | em1.10 (VLAN 10) | `suricata_em110` |
| INTERNAL | em2.20 (VLAN 20) | `suricata_em220` |
| WAN | em0 | optional — မထည့်လည်းရ |

> WAN interface က optional ပဲ — bank VMs traffic ဖမ်းဖို့ PUBLIC + INTERNAL ပဲ လုံလောက်တယ်

---

## Step 5 — Rules Enable (em1 / em2)

```
Services → Suricata → em1 → Categories tab

☑ emerging-attack_response.rules
☑ emerging-exploit.rules
☑ emerging-scan.rules          ← port scan, SSH scan detect
☑ emerging-bruteforce.rules    ← brute force attacks
☑ emerging-web_server.rules    ← SQLi, XSS, RFI
☑ emerging-trojan.rules
☑ emerging-dos.rules           ← DDoS/flood detect
→ Save

→ SID Mgmt tab → [Apply]
```

---

## Step 5b — Custom Rules ထည့် (AEGIS Lab — လက်တွေ့ confirmed နည်းလမ်း)

### Rules ဘယ် interface မှာ ထည့်ရမလဲ

Attacker IP သေချာမသိ (dynamic) — ဒါကြောင့် source IP အကုန် `any` သုံးရမည်။  
Destination (VM IP) ပေါ်မူတည်ပြီး ဘယ် interface မှာ ထည့်ရမလဲ ဆုံးဖြတ်:

| Target VM | IP | ထည့်ရမည့် Interface |
|---|---|---|
| bank-web SSH/HTTP/FTP | 10.10.10.10 | **PUBLIC (em1.10)** |
| dns-server SSH/DNS | 10.10.10.20 | **PUBLIC (em1.10)** |
| customer-db SSH/MySQL | 10.20.20.10 | **INTERNAL (em2.20)** |
| ldap-server SSH/LDAP | 10.20.20.20 | **INTERNAL (em2.20)** |

---

### Rules file တည်ဆောက်နည်း

Suricata start မဖြစ်သေးဘဲ rules file ထည့်ဖို့ — **Diagnostics → Command Prompt** မှာ:

```bash
# PUBLIC
mkdir -p /var/db/suricata/suricata_em110/rules
touch /var/db/suricata/suricata_em110/rules/custom.rules

# INTERNAL
mkdir -p /var/db/suricata/suricata_em220/rules
touch /var/db/suricata/suricata_em220/rules/custom.rules
```

ပြီးရင် **Diagnostics → Edit File** မှာ rules ရေး:

```
Path: /var/db/suricata/suricata_em110/rules/custom.rules
→ Load → rules paste → Save
```

---

### ⚠️ Rules tab မတွေ့ဘူးဆိုရင်

Interface list မှာ row ကနေ မြင်မရဘူး — **✏️ Edit icon နှိပ်မှ tabs ပေါ်မည်:**

```
Services → Suricata → Interfaces
  → PUBLIC row → ✏️ edit icon
  → PUBLI Rules tab → scroll အောက်ဆုံး → Custom Rules textarea
  (ဒါမပါဘူးဆိုရင် Diagnostics → Edit File နည်းသုံး)
```

---

## Step 5b — Custom Rules ထည့် (AEGIS Lab မှတ်တမ်း)

> **Rules tab မတွေ့ဘူးဆိုရင်:** Interface list row ထဲ ✏️ pencil (edit) icon နှိပ်မှ tabs ပေါ်မည်
>
> ```
> Services → Suricata → Interfaces
>   → em1 row → ✏️ Edit icon နှိပ်
>   → tabs: General | Categories | Rules | Variables | Logs | ...
>   → "Rules" tab နှိပ် → page အောက်ဆုံး scroll
>   → "Custom Rules" text area ရှိမည် — ဒီထဲ paste
> ```

em1 (DMZ) နဲ့ em2 (INT) ၂ ခုလုံးမှာ custom rules ထည့်ပါ:

**PUBLIC (em1.10) rules** — bank-web + dns-server:

```suricata
alert tcp any any -> 10.10.10.10 22 (msg:"SSH Brute bank-web"; flow:to_server; threshold:type both,track by_src,count 10,seconds 60; sid:9000001; rev:1;)
alert tcp any any -> 10.10.10.10 80 (msg:"HTTP Attack bank-web"; flow:to_server,established; sid:9000002; rev:1;)
alert tcp any any -> 10.10.10.10 21 (msg:"FTP Brute bank-web"; flow:to_server; threshold:type both,track by_src,count 10,seconds 60; sid:9000003; rev:1;)
alert udp any any -> 10.10.10.20 53 (msg:"DNS Attack dns-server"; sid:9000004; rev:1;)
alert tcp any any -> 10.10.10.20 22 (msg:"SSH Brute dns-server"; flow:to_server; threshold:type both,track by_src,count 10,seconds 60; sid:9000005; rev:1;)
```

**INTERNAL (em2.20) rules** — customer-db + ldap-server:

```suricata
alert tcp any any -> 10.20.20.10 22 (msg:"SSH Brute customer-db"; flow:to_server; threshold:type both,track by_src,count 10,seconds 60; sid:9000006; rev:1;)
alert tcp any any -> 10.20.20.10 3306 (msg:"MySQL Brute customer-db"; flow:to_server; threshold:type both,track by_src,count 10,seconds 60; sid:9000007; rev:1;)
alert tcp any any -> 10.20.20.20 22 (msg:"SSH Brute ldap-server"; flow:to_server; threshold:type both,track by_src,count 10,seconds 60; sid:9000008; rev:1;)
alert tcp any any -> 10.20.20.20 389 (msg:"LDAP Brute ldap-server"; flow:to_server; threshold:type both,track by_src,count 10,seconds 60; sid:9000009; rev:1;)
```

> **Note:** FTP rule ကို မလိုဘူးဆိုရင် ဖြုတ်နိုင်တယ် — မင်း service ပေါ်မူတည်ပြီး ရွေး

Rules ထည့်ပြီးရင်:
```
→ Save
→ Interface list ပြန်ရောက်တော့ ▶ Restart (em1) နှိပ်
→ em2 မှာလည်း ထပ်ထည့် (SSH, SYN flood, LDAP rules အဓိက)
```

---

## Step 6 — Suricata Start

```
Services → Suricata → Interfaces
  → em1 row: [▶ Start]
  → em2 row: [▶ Start]
```

Status = green ✅ ဖြစ်ရမည်

---

## Step 7 — EVE JSON Log Path စစ်

pfSense Console (Option 8 — Shell) မှာ:

```bash
# em1 (DMZ) log
ls /var/log/suricata/suricata_em1/
# → eve.json, stats.log, suricata.log

# em2 (INT) log
ls /var/log/suricata/suricata_em2/
# → eve.json, stats.log, suricata.log

# Live tail test
tail -f /var/log/suricata/suricata_em1/eve.json
```

> **FreeBSD note:** path format = `/var/log/suricata/suricata_{interface}/eve.json`

---

## Step 8 — SSH Key Setup (aegis-ADMIN → pfSense)

### pfSense မှာ SSH Enable

```
System → Advanced → Admin Access
  ☑ Enable Secure Shell
  SSH port: 22 (default)
  → Save
```

### aegis-ADMIN မှာ key ကူး

```bash
# aegis-ADMIN (10.30.30.10) မှာ run
ssh-copy-id -i ~/.ssh/id_ed25519.pub admin@10.30.30.1

# test (password မပါဘဲ ဝင်ရမည်)
ssh -o BatchMode=yes admin@10.30.30.1 "ls /var/log/suricata/"
```

> **pfSense default SSH user:** `admin` (root shell ဝင်မည်)

---

## Step 9 — aegis_forwarder.py Hub Config Update

`scripts/src/local.conf` (သို့) environment မှာ pfSense SSH ထည့်:

```bash
# pfSense Suricata log paths
PFSENSE_SURICATA_DMZ=/var/log/suricata/suricata_em1/eve.json
PFSENSE_SURICATA_INT=/var/log/suricata/suricata_em2/eve.json
PFSENSE_SSH_USER=admin
PFSENSE_HOST=10.30.30.1
```

forwarder hub mode မှာ pfSense interfaces ကို remote host အဖြစ် ထည့်ရမည် —
bank VMs နဲ့ SSH tail တူတူပဲ၊ path တည်နေရာ ကွာသည်:

```python
# hub config မှာ ထည့်ရမည်
{
    "host": "10.30.30.1",
    "user": "admin",
    "label": "pfsense",
    "sensors": {
        "suricata_dmz": "/var/log/suricata/suricata_em1/eve.json",
        "suricata_int": "/var/log/suricata/suricata_em2/eve.json"
    }
}
```

---

## Step 10 — bank-web / customer-db မှာ Suricata ဖြုတ်

```bash
# bank-web မှာ SSH ဝင်ပြီး
sudo systemctl stop suricata
sudo systemctl disable suricata
# (optional ဖြုတ်ချင်ရင်)
sudo apt remove --purge suricata -y

# customer-db မှာလည်း တူတူ
sudo systemctl stop suricata
sudo systemctl disable suricata
```

> Fail2ban, SSH log, vsftpd log တွေ **ဆက်ထားပါ** — forwarder ဆက်ဖတ်မည်

---

## EVE JSON — Suricata Rule Details (Dashboard မှာ ဘာမြင်ရမလဲ)

Attack ဝင်လာတိုင်း EVE JSON မှာ ဒါပါမည်:

```json
{
  "timestamp": "2026-07-20T14:32:11",
  "event_type": "alert",
  "src_ip": "192.168.10.99",
  "dest_ip": "10.10.10.10",
  "proto": "TCP",
  "alert": {
    "signature_id": 2010935,
    "signature": "ET SCAN SSH BruteForce Tool",
    "category": "Attempted Information Leak",
    "severity": 2,
    "action": "alert"
  }
}
```

| EVE field | Dashboard မှာ ဘာပြမလဲ | ရှိပြီးလား |
|---|---|---|
| `alert.signature` | Rule Name ("ET SCAN SSH BruteForce Tool") | ✅ `subtype` column မှာ သိမ်းပြီး — **display ထည့်ရုံ** |
| `alert.category` | Category ("Attempted Information Leak") | ✅ `description` ထဲ ပါပြီး — **column ထပ်ခွဲရုံ** |
| `alert.signature_id` | SID (2010935) | ❌ schema မှာ မရှိ — ထည့်ရမည် |
| `alert.action` | Action (alert/drop) | ❌ မရှိ — ထည့်ရမည် |

---

## Common Suricata Rules — မင်း Lab မှာ မြင်ရမည့် signatures

| Attack | Suricata Signature | Tool |
|---|---|---|
| SSH brute force | `ET SCAN SSH BruteForce Tool` | Hydra |
| SSH scanner | `ET SCAN SSH Scanner` | nmap |
| Port scan | `ET SCAN Nmap Scripting Engine` | nmap -sV |
| SQLi | `ET WEB_SERVER Generic SQL Injection` | sqlmap |
| XSS | `ET WEB_SERVER XSS Attempt` | manual |
| DDoS/flood | `ET DOS Possible SYN Flood` | hping3 |
| FTP brute | `ET SCAN Potential FTP Brute-Force` | Hydra FTP |

---

## Troubleshoot

| ပြဿနာ | အဖြေ |
|---|---|
| Suricata start မဖြစ်ဘူး | Interface promiscuous mode စစ် — GNS3 QEMU NIC promiscuous enable |
| eve.json ဗလာ | Rules မ download ရသေးဘူး — Step 3 update ပြန်လုပ် |
| SSH key မအလုပ်မဖြစ်ဘူး | pfSense → System → Advanced → Authorized SSH Keys ထည့် |
| Log path မရှိဘူး | Interface name စစ် — `ls /var/log/suricata/` |
