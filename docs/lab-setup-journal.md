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

## Lab Topology (Final — Confirmed 2026-07-04)

```
[Kali Linux / Attacker]
  e0 → 192.168.122.132/24 (vicbr0 / Cloud1)
         │
    [Cloud1 - vicbr0]   ← visual "Internet" on canvas
         │ enp1s0
    [Router-1 - MikroTik CHR 7.15.3]
      ether1: 192.168.122.2/24    ← Attacker side
      ether2: 192.168.122.135/24  ← NAT cloud (DHCP) / internet out
      ether3: 10.0.12.1/30        ← Router-2 link
         │ ether3
    [Router-2 - MikroTik CHR 7.15.3]
      ether1: 10.0.12.2/30        ← Router-1 link
      ether2: 10.0.23.1/30        ← pfSense WAN link
         │ ether2
    [pfSense]
      e0 / WAN:  10.0.23.2/30,  GW=10.0.23.1
      e1 / DMZ:  10.10.10.1/24
      e2 / INT:  10.20.20.1/24
      e3 / MGMT: 10.30.30.1/24
         │
    ┌────┴──────────────────────────────┐           │
[DMZ-Switch]                      [INT-Switch]  [aegis-forwarder]
    │         │                     │        │    10.30.30.10/24
[bank-web] [bank-mail]        [teller-pc] [customer-db]
10.10.10.10 10.10.10.20       10.20.20.10  10.20.20.20

[NAT cloud (nat0)] → Router-1 ether2 ← internet / apt updates only
```

**Network Segments:**
| Segment | Subnet | Purpose |
|---|---|---|
| Attacker ↔ Router-1 | 192.168.122.0/24 | Attack path entry |
| Router-1 ↔ Router-2 | 10.0.12.0/30 | Transit link |
| Router-2 ↔ pfSense | 10.0.23.0/30 | Firewall WAN |
| DMZ | 10.10.10.0/24 | bank-web, bank-mail |
| Internal | 10.20.20.0/24 | teller-pc, customer-db |
| Management | 10.30.30.0/24 | aegis-forwarder |

---

## VM Inventory (Updated 2026-07-04)

| VM Name | OS | Role | IP (confirmed) | Location |
|---|---|---|---|---|
| Attacker (Kali) | Kali Linux | Red Team attacker | 192.168.122.132/24 | GNS3 (Kali.qcow2) |
| Router-1 | MikroTik CHR 7.15.3 | Edge router | ether1:192.168.122.2, ether2:DHCP, ether3:10.0.12.1/30 | GNS3 |
| Router-2 | MikroTik CHR 7.15.3 | Transit router | ether1:10.0.12.2/30, ether2:10.0.23.1/30 | GNS3 |
| pfSense | pfSense (FreeBSD) | Firewall/IPS/WAF | WAN:10.0.23.2/30 DMZ:10.10.10.1 INT:10.20.20.1 MGMT:10.30.30.1 | GNS3 |
| bank-web | Ubuntu Server 22.04 | DVWA web server | 10.10.10.10/24 GW:10.10.10.1 | GNS3 |
| bank-mail | Ubuntu Server 22.04 | Postfix mail server | 10.10.10.20/24 GW:10.10.10.1 | GNS3 |
| teller-pc | Ubuntu Server 22.04 | Internal workstation | 10.20.20.10/24 GW:10.20.20.1 | GNS3 |
| customer-db | Ubuntu Server 22.04 | PostgreSQL DB | 10.20.20.20/24 GW:10.20.20.1 | GNS3 |
| aegis-forwarder | Ubuntu Server 22.04 | Sensor + forwarder | 10.30.30.10/24 GW:10.30.30.1 | GNS3 |

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

### 2026-07-04 — GNS3 Final Topology Wiring Complete

**Status:** ✅ Done

**What:** Cable tool သုံးပြီး nodes တွေ ချိတ်ဆက်တာ — final confirmed topology

**Confirmed links (from screenshot 01:54):**
```
Attacker(Kali) e0 ──→ Cloud1(vicbr0)(enp1s0) ──→ Router-1 e0
NAT(nat0)             ──→ Router-1 e1
Router-1 e2           ──→ Router-2 e0
Router-2 e1           ──→ pfSense e0  (WAN)
pfSense e1            ──→ DMZ-Switch
pfSense e2            ──→ INT-Switch
pfSense e3            ──→ aegis-forwarder
DMZ-Switch e1         ──→ bank-web e0
DMZ-Switch e2         ──→ bank-mail e0
INT-Switch e1         ──→ teller-pc e0
INT-Switch e2 (?)     ──→ customer-db e0
```

**Design rationale (2-router architecture):**
- Router-1: ISP/edge router — attacker ဝင်ရောက်တဲ့ entry point
- Router-2: transit router — Router-1 ↔ pfSense ကြား extra routing hop
- pfSense: stateful firewall — Router-2 ကဖြတ်ပြီးမှ ဝင်ရတယ် (defense in depth)
- Attack path: Kali → Router-1 → Router-2 → pfSense → DMZ/Internal

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

### 2026-07-04 — Router-1 IP Configuration Complete

**Status:** ✅ Done

**What:** Router-1 (MikroTik CHR) IP addresses, routes, NAT masquerade setup

**Interface mapping (GNS3 e → MikroTik ether):**
| GNS3 | MikroTik | Connected to | IP |
|---|---|---|---|
| e0 | ether1 | Cloud1 / Attacker (192.168.122.0/24) | 192.168.122.2/24 |
| e1 | ether2 | NAT cloud (nat0) | DHCP → 192.168.122.135/24 |
| e2 | ether3 | Router-2 ether1 | 10.0.12.1/30 |

**Commands run:**
```routeros
/ip address add address=192.168.122.2/24 interface=ether1
/ip address add address=10.0.12.1/30 interface=ether3
# ether2: DHCP (see troubleshooting below)
/ip dhcp-client add interface=ether2 disabled=no
/ip firewall nat add chain=srcnat out-interface=ether2 action=masquerade
/ip route add dst-address=10.0.0.0/8 gateway=10.0.12.2
```

**Result:**
- ether1: 192.168.122.2/24 ✅
- ether3: 10.0.12.1/30 ✅
- ether2: 192.168.122.135/24 (DHCP from NAT cloud) ✅
- Internet: `ping 8.8.8.8` → 0% packet-loss, ~30ms ✅

**Next:** Router-2 config

---

### 2026-07-04 — Router-2 IP Configuration Complete

**Status:** ✅ Done

**What:** Router-2 (MikroTik CHR) IP addresses and routes

**Interface mapping:**
| GNS3 | MikroTik | Connected to | IP |
|---|---|---|---|
| e0 | ether1 | Router-1 ether3 | 10.0.12.2/30 |
| e1 | ether2 | pfSense WAN (e0) | 10.0.23.1/30 |

**Commands run:**
```routeros
/ip address add address=10.0.12.2/30 interface=ether1
/ip address add address=10.0.23.1/30 interface=ether2
/ip route add dst-address=0.0.0.0/0 gateway=10.0.12.1
/ip route add dst-address=10.10.10.0/24 gateway=10.0.23.2
/ip route add dst-address=10.20.20.0/24 gateway=10.0.23.2
/ip route add dst-address=10.30.30.0/24 gateway=10.0.23.2
```

**Result:**
- ether1: 10.0.12.2/30 ✅
- ether2: 10.0.23.1/30 ✅
- Internet: `ping 8.8.8.8` → 0% packet-loss, ~31ms ✅

**Next:** pfSense WAN/LAN interface config

---

### [PENDING] — pfSense Interface Configuration

**Status:** ⏳ Not Started

**What:** Configure pfSense interfaces, firewall rules, Suricata IPS, syslog

**Confirmed IP plan (updated from actual router config):**

| Interface | GNS3 | IP | Gateway | Role |
|---|---|---|---|---|
| WAN (em0/vtnet0) | e0 | 10.0.23.2/30 | 10.0.23.1 | Router-2 ဆီ |
| OPT1 / DMZ (em1) | e1 | 10.10.10.1/24 | — | bank-web, bank-mail |
| LAN / Internal (em2) | e2 | 10.20.20.1/24 | — | teller-pc, customer-db |
| OPT2 / MGMT (em3) | e3 | 10.30.30.1/24 | — | aegis-forwarder |

**Steps:**
1. pfSense menu → Option 2 → Set WAN: `10.0.23.2/30`, GW: `10.0.23.1`
2. Set OPT1 (DMZ): `10.10.10.1/24`
3. Set LAN (Internal): `10.20.20.1/24`
4. Set OPT2 (MGMT): `10.30.30.1/24`
5. WebGUI (via LAN) → Firewall rules → allow DMZ, block cross-zone
6. Install Suricata package → enable IPS mode on WAN
7. Syslog → `10.30.30.10:514` (aegis-forwarder)

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

### 2026-07-04 — Router-1 NAT Internet မရတာ (10.0.99.x static IP အသုံးမဝင်)

**Symptom:** `ping 8.8.8.8` → 100% packet-loss, `10.0.99.1 host unreachable`

**Root cause:** GNS3 NAT node (nat0) က 10.0.99.0/30 subnet ကို **မသုံးဘူး**။ GNS3 built-in NAT cloud က host machine ရဲ့ libvirt NAT bridge ကိုသုံးပြီး `192.168.122.0/24` subnet ပေးတယ် — Cloud1 (vicbr0) နဲ့ subnet တူသည်။ Static IP (10.0.99.1/30) + static gateway (10.0.99.2) set လုပ်ထားလို့ gateway unreachable ဖြစ်ခဲ့တာ။

**Fix:**
```routeros
# ether2 static IP ဖျက်
/ip address remove numbers=2
# static default route ဖျက်
/ip route remove [find dst-address=0.0.0.0/0]
# DHCP client ဖွင့် — NAT cloud က IP + gateway auto assign လုပ်မည်
/ip dhcp-client add interface=ether2 disabled=no
```

**Result:** ether2 → 192.168.122.135/24 (DHCP), gateway auto set → `ping 8.8.8.8` OK ✅

**Rule for future:** GNS3 NAT node interface မှာ **static IP မသုံးနဲ့** — DHCP client သုံးပါ။ NAT cloud က 192.168.122.0/24 ပေးမည် (Cloud1/vicbr0 နဲ့ subnet တူသည် — ဒါပေမယ့် routing conflict မဖြစ်ဘဲ MikroTik က handle လုပ်သည်)။

---

### 2026-07-04 — DHCP Client ether1 မှာ ပါသွားတာ

**Symptom:** `/ip dhcp-client print` မှာ ether1 (searching...) ပါနေတာ မျှော်လင့်မထားဘဲ

**Root cause:** MikroTik CHR factory default မှာ ether1 မှာ DHCP client ပါလာတတ်တယ်၊ သို့မဟုတ် `/ip dhcp-client` context ထဲမှာ `add interface=ether2` ရိုက်တဲ့အခါ ether1 ကိုပါ add မိသွားတာ

**Fix:**
```routeros
/ip dhcp-client remove numbers=0   # ether1 DHCP ဖျက်
```

**Rule:** ether1 မှာ static IP (192.168.122.2/24) ရှိနေပြီး — DHCP client မထပ်ထည့်ပါနဲ့

---

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

### 2026-07-04 — pfSense Interface Discovery: vtnet0 မဟုတ်ဘဲ em0–em7

**Status:** ✅ Resolved

**What:** pfSense console မှာ Option 2 (Set IP) လုပ်တုန်းက `vtnet0` (VirtIO NIC) ထင်ထားသော်လည်း `ifconfig vtnet0` run ရာ `interface vtnet0 does not exist` error ပေါ်ခဲ့သည်။

**Root cause:** GNS3 QEMU pfSense template မှာ NIC adapter type = **Intel Gigabit Ethernet 82540EM (e1000)** သုံးထားသောကြောင့် interface name တွေ `em0`–`em7` ဖြစ်သည်။ VirtIO (`vtnet`) မဟုတ်ဘူး။

**How (investigation):**
```bash
# Shell (Option 8) ထဲမှာ
ifconfig vtnet0          # → "interface vtnet0 does not exist"
ifconfig -a | grep flags # → em0 em1 em2 em3 (LOWER_UP) em4–em7 (DOWN)
ifconfig -l              # → em0 em1 em2 em3 em4 em5 em6 em7 enc0 lo0 pflog0 pfsync0
```

**em0–em3 = LOWER_UP** (GNS3 cable ချိတ်ထားသည်)
**em4–em7 = link DOWN** (cable မချိတ်)

**Fix:** pfSense console Option 1 (Assign Interfaces) မှ reassign:
```
VLANs? → n
WAN  → em0
LAN  → em1
OPT1 → em2
OPT2 → em3
OPT3 → (blank)
Proceed? → y
```

**Rule:** GNS3 pfSense QEMU template NIC type ကို မပြောင်းမချင်း interface name = `em0, em1...` ဖြစ်မည်။ `vtnet` မဟုတ်ဘူး။

---

### 2026-07-04 — pfSense IP Configuration (All Interfaces)

**Status:** ✅ Confirmed Working

**What:** pfSense console Option 2 (Set interface IPs) မှတဆင့် interfaces 4 ခုလုံး IP set လုပ်ခဲ့သည်။

**Commands (Option 2 → interface select → answers):**

**WAN (em0) — 10.0.23.2/30:**
```
Interface: 1 (WAN)
DHCP? → n
IP: 10.0.23.2
Subnet: 30
Gateway: 10.0.23.1
Default gateway? → y          ← y ဖြေရမည် မဟုတ်ရင် routing မလုပ်ဘူး
IPv6? → n
IPv6 addr: (blank)
HTTP revert? → n
```

**LAN/DMZ (em1) — 10.10.10.1/24:**
```
Interface: 2 (LAN)
DHCP? → n
IP: 10.10.10.1 / 24
Gateway: (blank)
DHCP server? → y
Start: 10.10.10.100  End: 10.10.10.200
```

**OPT1/Internal (em2) — 10.20.20.1/24:**
```
Interface: 3 (OPT1)
IP: 10.20.20.1 / 24
DHCP server? → y
Start: 10.20.20.100  End: 10.20.20.200
```

**OPT2/MGMT (em3) — 10.30.30.1/24:**
```
Interface: 4 (OPT2)
IP: 10.30.30.1 / 24
DHCP server? → y
Start: 10.30.30.100  End: 10.30.30.200
```

**Final menu display (confirmed ✅):**
```
WAN  (wan)  → em0  → v4: 10.0.23.2/30
LAN  (lan)  → em1  → v4: 10.10.10.1/24
OPT1 (opt1) → em2  → v4: 10.20.20.1/24
OPT2 (opt2) → em3  → v4: 10.30.30.1/24
```

---

### 2026-07-04 — pfSense Connectivity Verification

**Status:** ✅ Router chain verified

**Tests (Option 7: Ping host):**
```
ping 10.0.23.1  → ✅ 3/3 packets, 0.0% loss       (Router-2 WAN link)
ping 10.0.12.1  → ✅ 3/3 packets, 0.0% loss, ttl=63 (Router-1 — full chain)
```

**Routing chain confirmed:**
```
pfSense → Router-2 (10.0.23.1) → Router-1 (10.0.12.1) → Cloud1 → Internet
```

**Pending:** `ping 8.8.8.8` (internet) — test မလုပ်ရသေးဘူး

---

### 2026-07-04 — Ubuntu VM Confusion — Delete & Redo Plan

**Status:** 🔄 In Progress

**What happened:** ubuntu-base template ကနေ VM တွေ duplicate + rename လုပ်ရာ ဘယ် VM က ဘယ် role ဆိုမသိဖြစ်ခဲ့သည်။

**Decision:** Confused VM instance တွေ အားလုံး GNS3 topology ထဲကနေ delete ပြီး ubuntu-base template ကနေ ပြန် drag & drop လုပ်မည်။

**Required VMs (fresh):**

| VM Name | Switch | IP Plan | Role |
|---|---|---|---|
| bank-web | DMZ-Switch | 10.10.10.10/24, GW=10.10.10.1 | Apache2 + DVWA |
| bank-mail | DMZ-Switch | 10.10.10.20/24, GW=10.10.10.1 | Postfix mail server |
| teller-pc | INT-Switch | 10.20.20.10/24, GW=10.20.20.1 | Internal workstation |
| customer-db | INT-Switch | 10.20.20.20/24, GW=10.20.20.1 | PostgreSQL |
| aegis-forwarder | pfSense em3 direct | 10.30.30.10/24, GW=10.30.30.1 | Sensor + AEGIS agent |

**How to redo:**
```
1. GNS3 → topology မှာ confused VMs select all → Delete
2. Left panel → QEMU VMs → ubuntu-base → drag to canvas × 5
3. Drop တာနဲ့ name ပေး: bank-web, bank-mail, teller-pc, customer-db, aegis-forwarder
4. Cable ချိတ်
5. Start all → console → netplan နဲ့ static IP set
```

**Next after VMs ready:**
- pfSense WebGUI ဝင် → OPT1/OPT2 enable → firewall rules
- aegis-forwarder: AEGIS agent install + configure

---

### 2026-07-04 — Ubuntu VM Console Type: VNC မှသာ အလုပ်လုပ်

**Status:** ✅ Resolved

**What:** ubuntu-base QEMU VM တွေ telnet console type နဲ့ double-click လုပ်ရင် `Trying ::1... Connected to localhost.` ပြပြီး blank ဖြစ်နေတာ — login prompt မပေါ်ဘူး

**Root cause:** Ubuntu Desktop image က VGA output သုံးထားတာ — telnet (serial) console ထဲ output မသွားဘူး

**Fix:**
```
VM icon → right-click → Configure
General Settings → Console type: telnet → vnc → OK
VM → Stop → Start → double-click → VNC window ပေါ်မည်
```

Template အားလုံး fix ဖို့:
```
Edit → Preferences → QEMU VMs → ubuntu-base → Edit
Console type: vnc → OK
Existing instances → right-click → Reload
```

**Rule:** ubuntu-base template (Ubuntu Desktop) → Console type = **VNC** (telnet မဟုတ်)

---

### 2026-07-04 — aegis-forwarder Static IP via Netplan

**Status:** ✅ Done

**What:** aegis-forwarder VM ကို 10.30.30.10/24 static IP set လုပ်ခဲ့သည်

**Discovery:** VM boot ပြီးချင်းဆိုင်း pfSense OPT2 DHCP ကနေ **10.30.30.101/24** auto ရသည် → static ပြောင်းခဲ့သည်

**Netplan file:** `/etc/netplan/01-network-manager-all.yaml`
```yaml
network:
  version: 2
  ethernets:
    ens3:
      addresses:
        - 10.30.30.10/24
      routes:
        - to: default
          via: 10.30.30.1
      nameservers:
        addresses: [8.8.8.8, 1.1.1.1]
```

**Commands:**
```bash
sudo nano /etc/netplan/01-network-manager-all.yaml
sudo chmod 600 /etc/netplan/01-network-manager-all.yaml
sudo netplan apply
ip a show ens3    # → inet 10.30.30.10/24 ✅
```

**Warning (ignore):**
```
WARNING: systemd-networkd is not running, output will be incomplete
Failed to reload network settings: No such file or directory
```
Ubuntu Desktop သည် NetworkManager သုံးသောကြောင့် warning ပေါ်သည် — IP apply ဖြစ်ပြီ ဒါကြောင့် ignore လုပ်ရသည်

**Common mistake:** `route:` မဟုတ်ဘဲ `routes:` (s ပါရမည်) — YAML exact spelling

---

### 2026-07-04 — pfSense OPT Interfaces: Default Firewall Block

**Status:** 🔄 Permanent rule pending (WebGUI)

**What:** aegis-forwarder (10.30.30.10) မှ pfSense gateway (10.30.30.1) ping လုပ်ရာ 100% packet loss

**Root cause:** pfSense OPT interfaces (OPT1, OPT2) default = **block all** — LAN anti-lockout rule ရှိသော်လည်း OPT interfaces မှာ outbound rule မရှိ

**Diagnosis:**
```bash
# pfSense Shell (Option 8)
pfctl -d    # firewall ယာယီ disable

# aegis-forwarder မှ test
ping -c 3 10.30.30.1  # → 0% loss ✅ (firewall disable မှ ရတာ)
```

**Confirmed:** pfSense firewall rule ပြဿနာ

**Correct easyrule syntax (pfSense Shell):**
```bash
easyrule pass opt2 any 10.30.30.0/24 any
easyrule pass opt1 any 10.20.20.0/24 any
easyrule pass lan  any 10.10.10.0/24 any
pfctl -e    # firewall ပြန် enable
```

> ⚠️ `easyrule pass opt2 from 10.30.30.0/24 to any` = **WRONG** (protocol argument မပါ)  
> ✅ `easyrule pass opt2 any 10.30.30.0/24 any` = correct

**Permanent fix (WebGUI — ကျန်ဆောင်ရွက်ရန်):**
```
Browser: https://10.30.30.1 (aegis-forwarder Firefox ကနေ)
Login: admin / pfsense → ပြောင်းပါ
Firewall → Rules → OPT1 → Add: Pass / OPT1 subnet / any
Firewall → Rules → OPT2 → Add: Pass / OPT2 subnet / any
Firewall → Rules → LAN  → Add: Pass / LAN subnet / any
Save → Apply Changes
```

**Rule:** pfSense OPT interface rules မထည့်မချင်း VM တွေ gateway ကိုပင် reach မနိုင်ဘူး

---

### 2026-07-04 — Ubuntu VM RAM Optimization

**Status:** ✅ Decided

**Host:** 16GB RAM — 5 Ubuntu VMs × 1024MB = 5GB + Kali 2048MB + pfSense 256MB + Routers = ~8GB → host slow

**Optimized allocation:**
| VM | Before | After |
|---|---|---|
| Ubuntu Server × 5 | 1024MB | 512MB |
| Kali | 2048MB | 1024MB |
| pfSense | 256MB | 256MB |
| R1, R2 | 256MB | 256MB |
| **Total** | **~10.9GB** | **~4.3GB** |

Ubuntu Server = 512MB နဲ့ Apache/PostgreSQL/Python script အဆင်ပြေသည်

---

---

### 2026-07-04 — pfSense Firewall Rules Written (easyrule)

**Status:** ✅ Done

**What:** pfSense console Option 8 (Shell) မှာ easyrule နဲ့ all subnets pass rules ထည့်ခဲ့သည်

**Commands:**
```bash
easyrule pass opt2 any 10.30.30.0/24 any   # MGMT → aegis-forwarder
easyrule pass lan  any 10.10.10.0/24 any   # DMZ  → bank-web, bank-mail
easyrule pass opt1 any 10.20.20.0/24 any   # INT  → teller-pc, customer-db
pfctl -e                                    # firewall ပြန် enable
```

**Result:** VM တွေ internet access ရပြီ ✅

---

### 2026-07-04 — pfSense DHCP Auto-assign Discovery

**Status:** ✅ Confirmed

**What:** pfSense LAN/OPT DHCP server ကြောင့် VM တွေ boot တာနဲ့ IP auto ရနေတာ တွေ့ရသည်

**Discovery:** bank-web console မှာ netplan ဘာမထည့်ဘဲ `ip a` run ရာ `10.10.10.100/24` ရပြီး `ping 8.8.8.8` ရနေတာ တွေ့ရသည် — pfSense LAN DHCP range (100–200) ကနေ auto assign ဖြစ်တာ

**Why static IP still needed:**
- VM reboot တိုင်း IP ပြောင်းနိုင် (100→101→102...)
- Competition ရက် attacker တိုက်မည့် IP သေချာမနေဘူး
- AEGIS forwarder monitor မည့် IP မသေချာ

**Rule:** DHCP ရသည့်တိုင် production/lab VM တွေ static IP ထည့်ရမည်

---

### 2026-07-04 — Ubuntu VM Static IP — tee One-liner Method

**Status:** ✅ Preferred method

**What:** nano editor မသုံးဘဲ `tee` command နဲ့ netplan file တစ်ချက်တည်း overwrite လုပ်ခြင်း

**Faster method (copy-paste တစ်ချက်):**
```bash
sudo tee /etc/netplan/01-network-manager-all.yaml << 'EOF'
network:
  version: 2
  ethernets:
    ens3:
      addresses:
        - 10.10.10.10/24
      routes:
        - to: default
          via: 10.10.10.1
      nameservers:
        addresses: [8.8.8.8, 1.1.1.1]
EOF
sudo chmod 600 /etc/netplan/01-network-manager-all.yaml && sudo netplan apply
ip a show ens3
```

**vs nano method:** nano = file ဖွင့်ပြီး ရေး → save → exit (၃ ဆင့်) | tee = copy-paste တစ်ချက် (မြန်သည်)

**Common mistake:** `sudo nani` → "command not found" — `nano` ဖြစ်ရမည်

---

---

### 2026-07-06 — pfSense WebGUI Port Discovery

**Status:** ✅ Fixed

**Problem:** Firefox → `https://10.10.10.1` = "Connection timed out"

**Root cause:** pfSense WebGUI listen on **port 80 (HTTP)** only — not 443 (HTTPS)

**Verified with:**
```bash
sockstat -l | grep -E "80|443"
# Output: nginx *:80 *:*   (port 80 only)
```

**Fix:** Use `http://10.10.10.1` (not https)

---

### 2026-07-06 — pfSense WebGUI 502 Bad Gateway Fix

**Status:** ✅ Fixed (repeatable fix)

**Problem:** `502 Bad Gateway` from nginx

**Cause:** PHP-FPM backend process crashed

**Fix (pfSense console):**
```
Option 16 → Restart PHP-FPM   (wait 15s)
Option 11 → Restart webConfigurator (wait 15s)
```

**Note:** This happens whenever pfSense is under load or after shell commands that modify config. If WebGUI returns 502, always run Option 16 → Option 11 first.

---

### 2026-07-06 — pfSense Admin Password Reset — All Methods Failed

**Status:** ✅ Resolved via Factory Reset

**Timeline of failed attempts:**
- Option 3 "Reset webConfigurator password" → ran but password still rejected
- `pfSsh.php playback changepassword` → "Invalid playback file" (wrong name)
- `pfSsh.php playback changepassword` → ran but unknown password set
- PHP one-liner with `$config` → "Undefined variable" error
- Option 12 PHP shell `local_user_set_password` → ran without error but still rejected

**Root cause:** Unknown — likely config.xml write succeeded but nginx/PHP-FPM cache still served old hash

**Final fix:** Option 4 Factory Reset → password reset to `pfsense` guaranteed ✅

**Lesson:** If password reset methods fail after 2-3 attempts → go straight to Factory Reset. Interface config can be redone in 10 minutes (all commands documented).

---

### 2026-07-07 — pfSense Factory Reset + Full Reconfiguration

**Status:** ✅ Complete — WebGUI accessible at `http://10.10.10.1`

**Steps performed:**

**1. Factory Reset**
```
Option 4 → y
```

**2. Interface Assign (Option 1)**
```
VLANs: n
WAN  → em0
LAN  → em1
OPT1 → em2
OPT2 → em3
Proceed: y
```

**3. IP Addresses (Option 2)**
```
WAN  (1): Static 10.0.23.2/30, gateway 10.0.23.1
LAN  (2): 10.10.10.1/24, DHCP 100-200, HTTP webGUI: y
OPT1 (3): 10.20.20.1/24, DHCP 100-200
OPT2 (4): 10.30.30.1/24, DHCP 100-200
```

**4. Firewall Rules (Option 8 Shell)**
```bash
easyrule pass lan  any 10.10.10.0/24 any
easyrule pass opt1 any 10.20.20.0/24 any
easyrule pass opt2 any 10.30.30.0/24 any
```

**5. WebGUI Fix**
```
Option 16 → Restart PHP-FPM
Option 11 → Restart webConfigurator
```

**Result:**
```
http://10.10.10.1  →  admin / pfsense  ✅
```

**Quirk:** "Killed" message during Option 2 WAN config = NORMAL. pfSense kills DHCP processes when switching to static. System auto-restarts.

---

### 2026-07-07 — Kali → Ubuntu VM Ping Fail (Troubleshooting)

**Status:** 🔄 In Progress

**What:** Kali (192.168.122.132) မှ Ubuntu VMs (10.10.10.10, 10.0.23.1 etc.) ကို ping မရ

**Symptom:**
```
From 192.168.122.132 icmp_seq=1 Destination Host Unreachable
traceroute 10.10.10.10 → first hop: sithu (192.168.122.132) !H !H !H
```

**Route check:** `10.0.0.0/8 via 192.168.122.2 dev eth0` ✅ (route ရှိသည်)

**Root cause:** "Destination Host Unreachable" **Kali ကိုယ်တိုင်** (192.168.122.132) ထွက်နေ = ARP failure — Kali က R1 (192.168.122.2) ရဲ့ MAC address ကို ARP query လုပ်သောအခါ R1 မဆိုင်ဘဲ kernel က locally unreachable ပြန်ပြောနေတာ

**Possible causes (priority order):**
1. R1 GNS3 မှာ Start မလုပ်ရသေးဘူး
2. R1 ether1 ကို Cloud1 (vicbr0) နဲ့ topology မချိတ်ဘူး
3. R1 ether1 မှာ 192.168.122.2/24 IP မသတ်မှတ်ဘူး
4. pfSense WAN inbound rule မရှိဘူး (R1 ပြင်ပြီးမှ ဆက်ဖြေ)

**Debug steps:**
```bash
# Kali မှ
ping -c 1 192.168.122.2   # R1 direct test
arp -n                     # MAC entry ပါလား

# R1 console
/ip address print          # ether1 = 192.168.122.2/24 ရဲ့လား
```

**Fix (R1 IP မပါရင်):**
```routeros
/ip address add address=192.168.122.2/24 interface=ether1
```

**Fix (pfSense WAN rule — R1 ပြင်ပြီးမှ):**
```bash
easyrule pass wan any 192.168.122.0/24 any
```

**ARP confirmation (03:43):**
```
arp -n output:
192.168.122.1   52:54:00:25:41:83  C        ← KVM gateway ✅ reachable
192.168.122.2   (incomplete)                ← R1 ❌ ARP reply မလာဘူး
```
→ Kali network OK (192.168.122.1 reach ရ), R1 ether1 ARP respond မလုပ်ဘူး confirmed

**Root cause confirmed (03:45) — Duplicate connected route:**
R1 route table မှ ether1 နှင့် ether2 နှစ်ခုလုံး 192.168.122.0/24 ပေါ်ရှိနေသည်:
```
DAc+  192.168.122.0/24   ether2   0   ← NAT cloud DHCP (192.168.122.135)
DAc+  192.168.122.0/24   ether1   0   ← Cloud1/Kali (192.168.122.2)
```
Cloud1 (vicbr0) + GNS3 NAT cloud နှစ်ခုလုံး host libvirt bridge (192.168.122.0/24) ကိုသုံးသောကြောင့် subnet ထပ်နေသည်
→ Kali ARP request ကို MikroTik က ether2 မှ ပြန်ဆိုသောကြောင့် Kali မမြင်ဘဲ incomplete ဖြစ်နေသည်

**Fix:**
```routeros
/ip dhcp-client disable numbers=0
/ip address remove [find interface=ether2]
```
ether2 IP ဖယ်ရှားလိုက်ခြင်းဖြင့် duplicate route ပျောက်ကွယ်သည်

**Result:** fix pending
**Next:** ether2 disable → ping -c 2 192.168.122.2 retest

---

## Next Steps (ကျန်ဆောင်ရွက်ရန်)

- [x] pfSense factory reset + reconfigure ✅
- [x] pfSense WebGUI accessible ✅ (`http://10.10.10.1`)
- [x] aegis-forwarder static IP 10.30.30.10 ✅
- [x] bank-web static IP 10.10.10.10 ✅
- [ ] pfSense WebGUI: password ပြောင်း
- [ ] pfSense WebGUI: OPT1/OPT2 interfaces Enable
- [ ] pfSense WebGUI: permanent firewall rules
- [ ] Kali → Ubuntu VMs routing (route + pfSense WAN rule)
- [ ] bank-mail static IP 10.10.10.20
- [ ] teller-pc static IP 10.20.20.10
- [ ] customer-db static IP 10.20.20.20
- [ ] bank-web: Apache2 + DVWA install
- [ ] bank-mail: Postfix + Dovecot install
- [ ] customer-db: PostgreSQL install
- [ ] aegis-forwarder: AEGIS agent install + systemd service

---

## References

- GNS3 docs: https://docs.gns3.com
- MikroTik CHR: https://mikrotik.com/download (RouterOS → Cloud Hosted Router)
- pfSense Suricata pkg: System → Package Manager in pfSense WebGUI
- DVWA: https://github.com/digininja/DVWA
- Cowrie honeypot: https://github.com/cowrie/cowrie
- AEGIS API endpoints: `lib/api-spec/openapi.yaml`
- AEGIS forwarder: `scripts/src/aegis_forwarder.py`
