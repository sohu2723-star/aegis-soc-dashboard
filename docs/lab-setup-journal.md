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

### 2026-07-03 — Disk Space Check

**Status:** ✅ Done

**Result:** Only 17% disk used — sufficient space to copy all VM images.

---

### 2026-07-03 — KVM VMs Copy to GNS3 + Import

**Status:** ✅ Done

**What:** Copied KVM qcow2 images to GNS3 QEMU folder and added all 5 VMs as QEMU templates

**VM Templates added:**
| Name | Disk | RAM | Console |
|---|---|---|---|
| Kali | Kali.qcow2 | 2048MB | vnc |
| linux2024 | linux2024.qcow2 | 1024MB | vnc |
| ubuntu-base | ubuntu22.04.qcow2 | 1024MB | telnet |
| R1 | chr-7.15.3.qcow2 | 256MB | telnet |
| R2 | chr-7.15.3.qcow2 | 256MB | telnet |

---

### 2026-07-03 — GNS3 Canvas Topology Built

**Status:** ✅ Done

**What:** Dragged all 5 VM nodes + NAT + Cloud onto AEGIS-SecureBank canvas

**Nodes on canvas:** Kali-1, Cloud1, NAT-1, R1-1, R2-1, linux2024-1, ubuntu-base-1

---

### 2026-07-03 — Cloud Node Issue + Topology Decision

**Status:** ✅ Resolved

**Issue:** Cloud node မှာ physical NIC တစ်ခုကို link တစ်ခုသာ ချိတ်လို့ရတယ် — Kali→Cloud→R1 chain မရနိုင်ဘူး။ "Can't create the link the port is not free" error ပေါ်တယ်။

**Cloud interfaces တွေ:**
- `enp1s0` — ethernet NIC
- `wip0s20f3` — WiFi NIC

**Solution:** Cloud node ကို "Internet (simulated)" visual label အဖြစ်သာ canvas မှာ ထားမယ် — real link မဆွဲဘဲ။

**Final Topology — Real Links:**
```
Kali-1       ──→  R1-1  (ether1)
NAT-1        ──→  R1-1  (ether2)   ← VM internet access
R1-1 (ether3)──→  R2-1  (ether1)
R2-1 (ether2)──→  linux2024-1 (eth0)   ← pfSense WAN
linux2024-1 (eth1) ──→ ubuntu-base-1 (eth0)  ← pfSense LAN → bank-web
```

**Attack flow (story for panel):**
```
Kali ──→ [Internet/Cloud] ──→ R1 ──→ R2 ──→ pfSense ──→ Bank Server
```
Cloud node ကို Kali ဘေးမှာ visual ထားပြီး annotation "Internet" ရေး — judges ကို flow ရှင်းပြဖို့

---

### 2026-07-03 — Network Adapter Count Fix

**Status:** ✅ Done

**What:** QEMU VM templates မှာ network adapter count ပြောင်း (link တစ်ခုထက်ပိုလိုတဲ့ VM တွေအတွက်)

**Changes:**
| VM | Adapters | ဘာကြောင့် |
|---|---|---|
| R1 | 3 | Kali (ether1) + NAT (ether2) + R2 (ether3) |
| R2 | 2 | R1 (ether1) + pfSense WAN (ether2) |
| linux2024 (pfSense) | 3 | WAN (eth0) + LAN-DMZ (eth1) + LAN-INT (eth2) |
| ubuntu-base | 1 | မပြောင်း |
| Kali | 1 | မပြောင်း |
| Cloud | မပြောင်း | Host NIC ကိုယ်တိုင် — GNS3 manage |
| NAT | မပြောင်း | Built-in nat0 တစ်ခုဘဲ ရှိတယ် |

**How:** GNS3 → Edit → Preferences → QEMU VMs → VM select → Edit → Network → Adapters

---

### 2026-07-04 — GNS3 Topology Backbone Complete

**Status:** ✅ Done

**Canvas state (confirmed from screenshot):**
```
Attacker(Kali) → Internet(Cloud) → Router-1 → Router-2 → pfSense(linux2024)
NAT → Router-1   ✓
pfSense → BankZone(ubuntu-base)  ✓
```

**Labels added on canvas:** Attacker, Internet, Router-1, Router-2, pfSense, NAT, BankZone

**Issue found:** Node name "Bank Zone" has space → invalid. Fix: right-click → Change hostname → `bank-web`

**Adapter counts finalized (with buffer):**
| VM | Adapters |
|---|---|
| Kali | 2 |
| R1 | 4 |
| R2 | 4 |
| linux2024 (pfSense) | 8 |
| ubuntu-base + clones | 2 |

---

### 2026-07-04 — Bank Zone Expansion Complete

**Status:** ✅ Done

**Canvas state (confirmed from screenshot 00:38):**
```
Attacker(Kali) → Internet(Cloud) → Router-1 → Router-2 → pfSense
NAT → Router-1  ✓
pfSense → DMZ-Switch → bank-web, bank-mail  ✓
pfSense → INT-Switch → teller-pc, customer-db  ✓
pfSense → aegis-forwarder (direct, eth3)  ✓
```

**Remaining issue:** "Invalid name detected for this node: Bank Zone" — hidden node with space in name. Fix: scroll canvas → find node → right-click → Change hostname → `bankzone`

**Topology COMPLETE — all nodes placed and linked**

---

### 🔄 IN PROGRESS — GNS3 Link Wiring (Cables)

**Status:** 🔄 In Progress

**What:** Cable tool သုံးပြီး nodes တွေ ချိတ်ဆက်တာ

**Links to draw:**
```
Kali-1  (eth0)   ──→  R1-1   (ether1)
NAT-1   (nat0)   ──→  R1-1   (ether2)
R1-1    (ether3) ──→  R2-1   (ether1)
R2-1    (ether2) ──→  linux2024-1 (eth0)   ← pfSense WAN
linux2024-1 (eth1) ──→ ubuntu-base-1 (eth0) ← pfSense LAN
```

**Cloud node role:** Visual label "Internet" သာ — real link မဆွဲ။ Kali နဲ့ R1 ကြားမှာ canvas annotation အနေထား panel ကိုပြဖို့သုံး

---

### Cloud vs NAT — ရှင်းလင်းချက်

**Cloud node (GNS3):**
- Host machine ရဲ့ real physical NIC (enp1s0/wip0s20f3) ကို bridge လုပ်တယ်
- Link chain ထဲ (Kali→Cloud→R1) မထည့်နိုင် — NIC တစ်ခုကို link တစ်ခုသာ ချိတ်လို့ရတယ်
- **ဒီ lab မှာ visual/annotation အနေနဲ့သာ သုံးတယ်**

**NAT node (GNS3):**
- VM တွေ internet ဝင်ဖို့ (apt install, update) host machine ရဲ့ NAT သုံးတယ်
- R1 နဲ့ ချိတ်ပြီး VM တွေ internet access ရတယ်
- **Attack path နဲ့ မဆိုင်ဘူး — VM maintenance အတွက်သာ**

**Attack flow (story):**
```
Real:       Kali ──→ R1 ──→ R2 ──→ pfSense ──→ Bank
Narrative:  Kali ──→ [Internet] ──→ R1 ──→ R2 ──→ pfSense ──→ Bank
```
Canvas မှာ Cloud node ကို Kali နဲ့ R1 ကြားမှာ ထားပြီး "Internet" label ရေးထားမယ် — judges တွေကို flow ရှင်းပြဖို့

---

### 🔄 IN PROGRESS — KVM VMs Copy to GNS3 + Import

**Status:** 🔄 In Progress (copy command running)

**What:** Copy existing KVM qcow2 images into GNS3 QEMU images folder, then add each as a QEMU VM template in GNS3.

**Why copy instead of point directly:** GNS3 creates linked clones from its own images folder. Pointing to `/var/lib/libvirt/images/` directly risks file conflicts if virt-manager also tries to access the same file.

**Commands run:**
```bash
sudo cp /var/lib/libvirt/images/Kali.qcow2 ~/GNS3/images/QEMU/
sudo cp /var/lib/libvirt/images/linux2024.qcow2 ~/GNS3/images/QEMU/
sudo cp /var/lib/libvirt/images/ubuntu22.04.qcow2 ~/GNS3/images/QEMU/
sudo chown $USER:$USER ~/GNS3/images/QEMU/*.qcow2
```

**After copy — add each VM in GNS3:**
GNS3 → Edit → Preferences → QEMU VMs → New for each:

| GNS3 Name | Disk image | RAM | Role |
|---|---|---|---|
| `Kali` | Kali.qcow2 | 2048 MB | Attacker |
| `linux2024` | linux2024.qcow2 | 1024 MB | pfSense or other (TBC) |
| `ubuntu-base` | ubuntu22.04.qcow2 | 1024 MB | Bank servers / forwarder base |

**Note on linux2024:** Role not yet confirmed. Could be pfSense (FreeBSD-based) or another Linux VM. Verify after booting in GNS3.

**Next:** Wire topology in GNS3 canvas

---

## Topology Wiring Plan (GNS3 Canvas)

Once all VMs are added, wire them as follows:

```
Kali (eth0/vda) ──────────────────── R1 (ether1)
                                      R1 (ether2) ── R2 (ether1)
                                                      R2 (ether2) ── pfSense (WAN/vtnet0)
                                                                      pfSense (LAN1/DMZ) ── bank-web
                                                                      pfSense (LAN1/DMZ) ── bank-mail
                                                                      pfSense (LAN2/INT) ── teller-pc
                                                                      pfSense (LAN2/INT) ── customer-db
                                                                      pfSense (LAN0/MGMT) ── aegis-forwarder
```

**GNS3 wiring steps:**
1. Drag R1, R2 (MikroTik CHR) onto canvas
2. Drag Kali, linux2024 (pfSense), ubuntu-base clones onto canvas
3. Draw links between nodes using the cable tool
4. Each link = one network interface on each side

---

## Router IP Config Plan (MikroTik CHR syntax)

### R1
```
/ip address add address=192.168.56.1/24 interface=ether1   # Kali side
/ip address add address=10.20.0.1/30    interface=ether2   # R2 side
/ip route add dst-address=10.10.0.0/16 gateway=10.20.0.2
```

### R2
```
/ip address add address=10.20.0.2/30   interface=ether1   # R1 side
/ip address add address=10.10.0.1/24   interface=ether2   # pfSense side
/ip route add dst-address=192.168.56.0/24 gateway=10.20.0.1
```

### Kali Static IP
```bash
# /etc/network/interfaces or nmcli
ip addr add 192.168.56.101/24 dev eth0
ip route add default via 192.168.56.1
```

---

## pfSense Config Plan

| Interface | Assignment | IP |
|---|---|---|
| WAN (vtnet0) | R2 link | 10.10.0.254/24, GW 10.10.0.1 |
| LAN1 / DMZ (vtnet1) | Bank Web + Mail | 10.10.10.1/24 |
| LAN2 / Internal (vtnet2) | Teller + DB | 10.10.20.1/24 |

**Suricata IPS:**
- Install via: System → Package Manager → Suricata
- Enable "Block Offenders" on WAN/DMZ interface
- Syslog → 10.10.0.200:514 (AEGIS forwarder VM)

---

## Verification Checklist (End-to-End)

- [ ] `traceroute 10.10.10.10` from Kali shows: R1 → R2 → pfSense → bank-web
- [ ] AEGIS dashboard receives live events from forwarder
- [ ] pfSense block event appears in dashboard after attack
- [ ] sqlmap attack succeeds before rule, fails after rule
- [ ] `pfctl -s info` counter increments on block

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

### 2026-07-03 — GNS3 "Cannot connect to localhost:3080" / Forbidden

**Symptoms:**
- `Error while getting compute list: Operation timeout`
- `Forbidden (localhost:3080)`
- `Cannot connect to http://localhost:3080`
- "Another GNS3 GUI is already running" warning

**Root cause:** GNS3 server (`gns3server`) process ရပ်သွားတာ သို့မဟုတ် multiple instances conflict ဖြစ်တာ။ Terminal မှာ `gns3server &` manually run ခဲ့ပြီး GUI နဲ့ conflict ဖြစ်ခဲ့တာ။

**Fix:**
```bash
# Step 1 — GNS3 window အကုန် X နဲ့ close
# Step 2 — Terminal မှာ
sudo pkill -9 -f gns3
sleep 2
sudo lsof -i :3080     # port clear ဖြစ်ကြောင်း verify
# Step 3 — Clean start (GUI + server အတူတူ)
gns3
```

**Rule:** `gns3server` ကို ကိုယ်တိုင် terminal မှာ manually run **မလုပ်ပါနဲ့**။ `gns3` command တစ်ကြောင်းတည်း run ရင် server + GUI အတူတူ start မယ်။

---

### 2026-07-03 — GNS3 QEMU VM Templates ပျောက်သွားသလားထင်တာ

**Symptom:** GNS3 restart ပြီးနောက် VM templates တွေ မမြင်ရဘူးထင်တာ

**Root cause:** Templates တွေက project ထဲမှာ မသိမ်းဘဲ global GNS3 config (`~/.config/GNS3/2.2/gns3_server.conf`) ထဲမှာ သိမ်းတယ်။ Server connect မဖြစ်မချင်း template list ပေါ်မလာဘူး — server problem ဖြစ်နေတာ template problem မဟုတ်ဘူး။

**Verify:** Edit → Preferences → QEMU VMs ထဲမှာ R1, R2, Kali, linux2024, ubuntu-base ရှိနေသေးတယ်

**Fix:** Server connection fix (အပေါ်ကအတိုင်း) လုပ်ရင် templates ပြန်ပေါ်လာမယ်

---

## References

- GNS3 docs: https://docs.gns3.com
- MikroTik CHR: https://mikrotik.com/download (RouterOS → Cloud Hosted Router)
- pfSense Suricata pkg: System → Package Manager in pfSense WebGUI
- DVWA: https://github.com/digininja/DVWA
- Cowrie honeypot: https://github.com/cowrie/cowrie
- AEGIS API endpoints: `lib/api-spec/openapi.yaml`
- AEGIS forwarder: `scripts/src/aegis_forwarder.py`
