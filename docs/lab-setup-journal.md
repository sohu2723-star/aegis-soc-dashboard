# AEGIS SOC Lab — Setup Journal
> မှတ်တမ်း: ဤ file သည် lab setup လုပ်ဆောင်ခဲ့သည့် အဆင့်တိုင်းကို chronological order အတိုင်း မှတ်တမ်းတင်ထားသည်။
> Future agents, developers, နှင့် panel judges များ ဖတ်ရှုနိုင်ရန် ရေးသားထားသည်။
> **GitHub import လုပ်ပြီး project စကြည့်သူများ — ဤ file ကို အရင်ဆုံးဖတ်ပါ။**

---

## Rule: How to Maintain This Journal

မည်သည့် setup step မဆို လုပ်ပြီးတိုင်း ဤ file ကို update လုပ်ရမည်—

```
## [Date] — [Title]
**Status:** ✅ Done / 🔄 In Progress / ❌ Failed
**What:** ဘာလုပ်ခဲ့သလဲ
**How:** command / steps
**Result:** ဘာ outcome ရခဲ့သလဲ
**Next:** ဆက်လုပ်ရမည့်အဆင့်
```

---

## Lab Overview

| Item | Detail |
|---|---|
| Project Name | AEGIS SOC Dashboard |
| Lab Type | Real attack/defense lab (no simulation) |
| Host Machine | HP ProBook, Pop!_OS (Ubuntu-based) |
| Virtualization | KVM / virt-manager (existing) + GNS3 (new) |
| Dashboard Hosting | Vercel (frontend) + Render (API server) |
| Database | Supabase PostgreSQL |
| Start Date | 2026-07-03 |

---

## Lab Topology (Target)

```
[Kali Linux]          Attacker VM
    192.168.56.101
         │
    [R1 - MikroTik CHR]     GNS3 virtual router
    WAN: 192.168.56.1
    LAN: 10.20.0.1
         │
    [R2 - MikroTik CHR]     GNS3 virtual router
    WAN: 10.20.0.2
    LAN: 10.10.0.1
         │
    [pfSense]               Firewall / IPS / WAF
    WAN: 10.10.0.254
    LAN (DMZ):  10.10.10.1
    LAN (INT):  10.10.20.1
         │
    ┌────┴──────────────────────┐
    │                           │
[Bank Web Server]       [Bank Mail Server]
10.10.10.10 (DVWA)      10.10.10.20 (Postfix)
    │
[Teller Workstation]    [Customer DB]
10.10.20.10             10.10.20.20 (PostgreSQL)

[AEGIS Forwarder VM]
10.10.0.200
aegis_forwarder.py → Render API → Supabase → Vercel Dashboard
```

---

## VM Inventory

| VM Name | OS | Role | IP | Location |
|---|---|---|---|---|
| Kali Linux | Kali Linux | Attacker | 192.168.56.101 | virt-manager |
| pfSense | FreeBSD (pfSense) | Firewall/IPS | 10.10.0.254 | virt-manager |
| ubuntu-base (clones) | Ubuntu Server 22.04 | Victims + Forwarder | various | virt-manager |
| R1 | MikroTik CHR | Edge Router | 192.168.56.1 / 10.20.0.1 | GNS3 |
| R2 | MikroTik CHR | Core Router | 10.20.0.2 / 10.10.0.1 | GNS3 |

---

## Setup Log

---

### 2026-07-03 — GNS3 Installation on Pop!_OS

**Status:** ✅ Done

**What:** GNS3 GUI + Server install on host machine (Pop!_OS, HP ProBook)

**How:**
```bash
sudo add-apt-repository ppa:gns3/ppa
sudo apt update
sudo apt install gns3-gui gns3-server -y
sudo usermod -aG ubridge,wireshark $USER
# Log out → Log in (group changes)
```

**Dialogs answered:**
- "Should non-superusers be able to run GNS3?" → **Yes** (ubridge group)
- "Should non-superusers be able to capture packets?" → **Yes** (wireshark/dumpcap)

**Result:**
- GNS3 version 2.2.59 running on Linux 64-bit, Python 3.12.3, Qt 6.6.4.2, PyQt 6.6.1
- Server path: `/usr/bin/gns3server`
- Host binding: `localhost`, Port: `3080 TCP`
- Console: "GNS3 management console" running ✓

**Notes:**
- virt-manager (KVM/QEMU) was already installed with Kali, Ubuntu, pfSense VMs
- Chose GNS3 + KVM integration (Option A) for real router hops (traceroute demo)
- Full reboot not required — log out/in sufficient for group changes

**Next:** MikroTik CHR router image download + import into GNS3

---

### 2026-07-03 — GNS3 Project Created

**Status:** ✅ Done

**What:** Created new GNS3 project for the lab

**How:** GNS3 → File → New blank project → Name: `AEGIS-SecureBank`

**Next:** Add MikroTik CHR router appliances (R1, R2)

---

### 2026-07-03 — MikroTik CHR Download & Convert

**Status:** ✅ Done

**What:** Download MikroTik CHR 7.15.3 and convert to QEMU qcow2 format

**How:**
```bash
wget https://download.mikrotik.com/routeros/7.15.3/chr-7.15.3.img.zip
unzip chr-7.15.3.img.zip        # answered "A" (All) to overwrite prompt
qemu-img convert -f raw -O qcow2 chr-7.15.3.img chr-7.15.3.qcow2
```

**Result:** `chr-7.15.3.qcow2` file ready for GNS3 import

**Next:** Import as QEMU VM in GNS3 (R1 and R2)

---

### 2026-07-03 — MikroTik CHR Import into GNS3 (R1 & R2)

**Status:** ✅ Done

**What:** Added MikroTik CHR as QEMU appliance in GNS3 — created R1 and R2

**Settings used:**
- QEMU binary: `/bin/qemu-system-x86_64` (v8.2.2)
- RAM: 256 MB
- Console type: telnet
- Disk image: `/home/sithuphyo/GNS3/images/QEMU/chr-7.15.3.qcow2`
- Network adapters: 1 (expandable later)

**Result:** R1 and R2 templates visible in GNS3 QEMU VMs list ✓

**Next:** Import KVM VMs into GNS3

---

### 2026-07-03 — KVM VM Disk Paths Found

**Status:** ✅ Done

**What:** Located existing virt-manager VM disk images

**How:**
```bash
sudo virsh domblklist Kali       # → /var/lib/libvirt/images/Kali.qcow2
sudo virsh domblklist linux2024  # → /var/lib/libvirt/images/linux2024.qcow2
sudo virsh domblklist ubuntu22.04 # → /var/lib/libvirt/images/ubuntu22.04.qcow2
```

**VM disk paths:**
| VM Name | Disk Path | Role (assumed) |
|---|---|---|
| Kali | `/var/lib/libvirt/images/Kali.qcow2` | Attacker |
| linux2024 | `/var/lib/libvirt/images/linux2024.qcow2` | pfSense or other (TBC) |
| ubuntu22.04 | `/var/lib/libvirt/images/ubuntu22.04.qcow2` | Blue Team base VM |

**Note:** `linux2024` OS role not yet confirmed — need to verify if pfSense or Linux.

**Next:** Copy/link qcow2 files to GNS3 images folder, then add as QEMU VMs in GNS3

---

### [PENDING] — KVM VMs Import into GNS3

**Status:** ⏳ Not Started

**What:** Add Kali, linux2024, ubuntu22.04 as QEMU VMs in GNS3

**Important:** Must copy (not just point to) qcow2 files into GNS3 images folder — GNS3 uses linked clones from this location.

**How:**
```bash
sudo cp /var/lib/libvirt/images/Kali.qcow2 ~/GNS3/images/QEMU/
sudo cp /var/lib/libvirt/images/linux2024.qcow2 ~/GNS3/images/QEMU/
sudo cp /var/lib/libvirt/images/ubuntu22.04.qcow2 ~/GNS3/images/QEMU/
sudo chown sithuphyo:sithuphyo ~/GNS3/images/QEMU/*.qcow2
```

Then GNS3 → Edit → Preferences → QEMU VMs → New for each VM.

**Next:** Wire topology in GNS3 canvas

---

### [PENDING] — KVM VMs Import into GNS3

**Status:** ⏳ Not Started

**What:** Import existing virt-manager VMs into GNS3 as QEMU appliances

**How:**
```bash
# Find existing VM disk images
virsh list --all
virsh domblklist <vm-name>
ls /var/lib/libvirt/images/

# In GNS3: Edit → Preferences → QEMU VMs → New
# Point to each .qcow2 file
```

**Important:** Shut down VMs in virt-manager before importing — qcow2 files cannot be accessed by two processes simultaneously.

---

### [PENDING] — GNS3 Topology Wiring

**Status:** ⏳ Not Started

**What:** Connect all VMs and routers in GNS3 canvas

**Connections:**
```
Kali (eth0) ──── R1 (ether1)
R1 (ether2) ──── R2 (ether1)
R2 (ether2) ──── pfSense (WAN)
pfSense (LAN1/DMZ) ──── Bank Web, Bank Mail
pfSense (LAN2/INT) ──── Teller PC, Customer DB
pfSense (LAN0/MGMT) ──── AEGIS Forwarder VM
```

---

### [PENDING] — Router IP Configuration

**Status:** ⏳ Not Started

**What:** Configure IP addresses and static routes on R1 and R2 (MikroTik CHR)

**R1 config (MikroTik syntax):**
```
/ip address add address=192.168.56.1/24 interface=ether1
/ip address add address=10.20.0.1/30 interface=ether2
/ip route add dst-address=10.10.0.0/16 gateway=10.20.0.2
```

**R2 config:**
```
/ip address add address=10.20.0.2/30 interface=ether1
/ip address add address=10.10.0.1/24 interface=ether2
/ip route add dst-address=192.168.56.0/24 gateway=10.20.0.1
```

**Verify:** `traceroute 10.10.10.10` from Kali → should show R1 → R2 → pfSense → Web

---

### [PENDING] — pfSense Configuration

**Status:** ⏳ Not Started

**What:** Configure pfSense interfaces, Suricata IPS, and syslog forwarding

**Steps:**
1. WAN interface: `10.10.0.254/24`, gateway `10.10.0.1`
2. LAN interfaces: DMZ `10.10.10.1/24`, Internal `10.10.20.1/24`
3. Install Suricata package → enable IPS mode (Block Offenders)
4. Syslog → remote server: `10.10.0.200:514` (AEGIS forwarder VM)
5. Create `Blocked_Attackers` alias for dynamic IP blocking

---

### [PENDING] — Ubuntu VM Setup (Bank Servers)

**Status:** ⏳ Not Started

**What:** Configure each Ubuntu VM clone for its role

| VM | Service to Install | IP |
|---|---|---|
| bank-web | Apache2 + DVWA (vulnerable web app) | 10.10.10.10 |
| bank-mail | Postfix + Dovecot | 10.10.10.20 |
| teller-pc | Desktop / client simulation | 10.10.20.10 |
| customer-db | PostgreSQL | 10.10.20.20 |
| aegis-forwarder | Suricata + Snort + Fail2ban + Cowrie + aegis_forwarder.py | 10.10.0.200 |

---

### [PENDING] — AEGIS Forwarder Deployment

**Status:** ⏳ Not Started

**What:** Deploy `aegis_forwarder.py` on the AEGIS Ubuntu VM

**How:**
```bash
# On aegis-forwarder VM (10.10.0.200)
git clone <repo>
pip3 install requests
export AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api"
export AEGIS_KEY="<AEGIS_INGEST_KEY>"
python3 scripts/src/aegis_forwarder.py --mode all
```

**Sensors monitored:**
- Suricata EVE JSON → `/api/ingest/suricata`
- Snort alert_fast → `/api/ingest/snort`
- Fail2ban → `/api/ingest/fail2ban`
- SSH auth.log → `/api/ingest/ssh`
- FTP → `/api/ingest/ftp`
- ModSecurity → `/api/ingest/http`
- Cowrie honeypot → `/api/ingest/cowrie`
- pfSense syslog UDP:514 → `/api/ingest/pfsense` *(to be added)*

---

### [PENDING] — pfSense Syslog Listener (aegis_forwarder.py)

**Status:** ⏳ Not Started

**What:** Add UDP 514 syslog listener thread to `aegis_forwarder.py` to receive pfSense filterlog events and forward to Render API

**File:** `scripts/src/aegis_forwarder.py`

**Logic:** Parse pfSense filterlog CSV → POST to `/api/ingest/pfsense`

---

### [PENDING] — End-to-End Demo Verification

**Status:** ⏳ Not Started

**Demo Script (for panel/judges):**
1. `traceroute` from Kali → Bank Web (prove real multi-hop path)
2. sqlmap attack → succeeds (before rule)
3. pfSense block rule applied (manual in WebGUI or Suricata IPS auto-fires)
4. sqlmap retry → timeout/filtered
5. AEGIS Dashboard → block event appears in real time
6. `pfctl -s info` counter increments → proves real block, not simulation

---

## Key URLs & Credentials

> ⚠️ Do NOT store actual keys here. Use Render/Vercel environment variables.

| Service | URL |
|---|---|
| AEGIS API (Render) | `https://aegis-api-server-jp3b.onrender.com` |
| AEGIS Dashboard (Vercel) | `https://<your-vercel-app>.vercel.app` |
| Supabase | Supabase dashboard → project settings |

**Required env vars on Render:**
- `SUPABASE_DB_URL` — pooler connection string (port 6543)
- `AEGIS_INGEST_KEY` — sensor auth key
- `AEGIS_ADMIN_KEY` — admin key

---

## Troubleshooting Log

| Date | Issue | Fix |
|---|---|---|
| — | — | — |

*(Add entries here as issues are encountered)*

---

## References

- GNS3 docs: https://docs.gns3.com
- MikroTik CHR: https://mikrotik.com/download (RouterOS → Cloud Hosted Router)
- pfSense Suricata pkg: System → Package Manager in pfSense WebGUI
- DVWA: https://github.com/digininja/DVWA
- Cowrie honeypot: https://github.com/cowrie/cowrie
- AEGIS API endpoints: `lib/api-spec/openapi.yaml`
- AEGIS forwarder: `scripts/src/aegis_forwarder.py`
