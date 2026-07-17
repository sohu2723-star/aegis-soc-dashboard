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

## Lab Topology (Final — Confirmed & Verified 2026-07-07)

> ✅ Kali → R1 → R2 → pfSense → bank-web full path verified working on 2026-07-07

```
[Kali Linux / Attacker]  192.168.122.132/24
         │ e0
    [Switch1 (GNS3 Ethernet Switch)]   ← Added 2026-07-07 (Cloud1 port fix)
         │ e1                  │ e2
    [Router-1 ether1]    [Cloud1 (virbr0)]  ← visual "Internet" / L2 bridge
    192.168.122.2/24

    [Router-1 - MikroTik CHR 7.15.3]
      ether1 (e0): 192.168.122.2/24    ← Attacker/Switch1 side ✅
      ether2 (e1): DHCP DISABLED       ← NAT cloud (disabled 2026-07-07 — duplicate route fix)
      ether3 (e2): 10.0.12.1/30        ← Router-2 link ✅
         │ ether3
    [Router-2 - MikroTik CHR 7.15.3]
      ether1 (e0): 10.0.12.2/30        ← Router-1 link ✅
      ether2 (e1): 10.0.23.1/30        ← pfSense WAN link ✅
         │ ether2
    [pfSense 2.7.2 CE]
      em0 / WAN:  10.0.23.2/30,  GW=10.0.23.1   ← Block private = DISABLED ✅
      em1 / LAN:  10.10.10.1/24  (DHCP 100-200)
      em2 / OPT1: 10.20.20.1/24  (DHCP 100-200)
      em3 / OPT2: 10.30.30.1/24  (DHCP 100-200)
         │
    ┌────┴──────────────────────────────┐           │
[DMZ-Switch]                      [INT-Switch]  [aegis-forwarder]
    │         │                     │        │    10.30.30.10/24
[bank-web] [bank-mail]        [teller-pc] [customer-db]
10.10.10.10 10.10.10.20       10.20.20.10  10.20.20.20
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

## VM Inventory (Updated 2026-07-07 — Verified)

| VM Name | OS | Role | IP (confirmed) | Status |
|---|---|---|---|---|
| Attacker (Kali) | Kali Linux | Red Team attacker | 192.168.122.132/24, GW:192.168.122.2 | ✅ Routing working |
| Switch1 | GNS3 Ethernet Switch | L2 bridge (Kali+Cloud1+R1) | — (L2 only) | ✅ In topology |
| Router-1 | MikroTik CHR 7.15.3 | Edge router | ether1:192.168.122.2/24, **ether2:DISABLED**, ether3:10.0.12.1/30 | ✅ Configured |
| Router-2 | MikroTik CHR 7.15.3 | Transit router | ether1:10.0.12.2/30, ether2:10.0.23.1/30 | ✅ Configured |
| pfSense | pfSense 2.7.2 CE | Firewall/IPS/WAF | WAN:10.0.23.2/30 LAN:10.10.10.1 OPT1:10.20.20.1 OPT2:10.30.30.1 | ✅ WebGUI accessible |
| bank-web | Ubuntu (Desktop) | DVWA web server | 10.10.10.10/24 GW:10.10.10.1 | ✅ Static IP set, reachable from Kali |
| bank-mail | Ubuntu (Desktop) | Postfix mail server | 10.10.10.20/24 GW:10.10.10.1 | ⏳ IP set, services pending |
| teller-pc | Ubuntu (Desktop) | Internal workstation | 10.20.20.10/24 GW:10.20.20.1 | ⏳ IP set, services pending |
| customer-db | Ubuntu (Desktop) | PostgreSQL DB | 10.20.20.20/24 GW:10.20.20.1 | ⏳ IP set, services pending |
| aegis-forwarder | Ubuntu (Desktop) | Sensor + forwarder | 10.30.30.10/24 GW:10.30.30.1 | ✅ Static IP set |

> ⚠️ **Note on R1 ether2:** Initially DHCP-enabled (NAT cloud), disabled 2026-07-07 to fix duplicate 192.168.122.0/24 route. Internet out via R1 ether1→Switch1→virbr0→host now.

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

**Initial Topology Plan (2026-07-03 — subsequently revised):**
```
Kali-1       ──→  R1-1  (ether1)           ← later: Switch1 ကြားထည့်ရသည်
NAT-1        ──→  R1-1  (ether2)           ← later: ether2 disabled (duplicate route)
R1-1 (ether3)──→  R2-1  (ether1)
R2-1 (ether2)──→  pfSense (em0/WAN)
pfSense (em1/LAN) ──→ DMZ-Switch ──→ bank-web, bank-mail
pfSense (em2/OPT1) ──→ INT-Switch ──→ teller-pc, customer-db
pfSense (em3/OPT2) ──→ aegis-forwarder
```

> ⚠️ **Revised 2026-07-07:** Kali→R1 direct link had L2 segment mismatch (Cloud1 wlp0s20f3 issue). Fixed by inserting Switch1. See "Kali → Ubuntu VM Ping Fail" troubleshooting entry.

**Attack flow (story for panel):**
```
Real:      Kali ──→ Switch1 ──→ R1 ──→ R2 ──→ pfSense ──→ Bank Server
Narrative: Kali ──→ [Internet]  ──→ R1 ──→ R2 ──→ pfSense ──→ Bank Server
```

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

**Confirmed links (initial — 2026-07-04, then revised 2026-07-07):**
```
[2026-07-04 initial — Kali→Cloud1 direct, later replaced with Switch1]
Attacker(Kali) e0 ──→ Cloud1(vicbr0)(wlp0s20f3) ──→ Router-1 e0
                         ↑ WRONG — wlp0s20f3 = WiFi no carrier
                           Fixed 2026-07-07: Switch1 ထည့်ပြီး topology ပြောင်း

[2026-07-07 FINAL — verified working]
Attacker(Kali) e0 ──→ Switch1 e0
Switch1 e1            ──→ Router-1 e0 (ether1)
Switch1 e2            ──→ Cloud1 (virbr0)
Router-1 e2 (ether3)  ──→ Router-2 e0 (ether1)
Router-2 e1 (ether2)  ──→ pfSense em0 (WAN)
pfSense em1 (LAN)     ──→ DMZ-Switch
pfSense em2 (OPT1)    ──→ INT-Switch
pfSense em3 (OPT2)    ──→ aegis-forwarder e0
DMZ-Switch            ──→ bank-web e0
DMZ-Switch            ──→ bank-mail e0
INT-Switch            ──→ teller-pc e0
INT-Switch            ──→ customer-db e0
```

**Design rationale (2-router architecture):**
- Router-1: ISP/edge router — attacker ဝင်ရောက်တဲ့ entry point
- Router-2: transit router — Router-1 ↔ pfSense ကြား extra routing hop
- pfSense: stateful firewall — Router-2 ကဖြတ်ပြီးမှ ဝင်ရတယ် (defense in depth)
- Attack path: Kali → Router-1 → Router-2 → pfSense → DMZ/Internal

---

### Cloud vs NAT vs Switch1 — ရှင်းလင်းချက် (Updated 2026-07-07)

**Cloud node (GNS3):**
- Host machine ရဲ့ KVM bridge (virbr0) ကို GNS3 ထဲ expose လုပ်တယ်
- **Problem:** Cloud1 port တစ်ခုကို interface တစ်ခုသာ assign ရ — Kali+R1 နှစ်ခုလုံး virbr0 ကို တစ်ပြိုင်နက် link မဆွဲနိုင်ဘူး
- **Solution 2026-07-07:** GNS3 Ethernet **Switch1** ထည့်ပြီး Kali+R1+Cloud1 (virbr0) ကို L2 bridge လုပ်သည်
- Canvas မှာ Cloud node ကို "Internet" visual label အဖြစ်သာ ထားသည် (real link = Switch1 ကနေ)

**NAT node (GNS3):**
- VM တွေ internet ဝင်ဖို့ host machine ရဲ့ NAT သုံးတယ် (apt install, update)
- R1 ether2 နဲ့ ချိတ်ထားသည် — **2026-07-07 မှ DISABLED** (duplicate 192.168.122.0/24 route fix)
- Internet out = Switch1 → Cloud1 (virbr0) → host gateway (192.168.122.1) မှ ဖြတ်သည်
- **Attack path နဲ့ မဆိုင်ဘူး — VM maintenance အတွက်သာ**

**Attack flow (story):**
```
Real:      Kali ──→ Switch1 ──→ R1 ──→ R2 ──→ pfSense ──→ Bank
Narrative: Kali ──→ [Internet]  ──→ R1 ──→ R2 ──→ pfSense ──→ Bank
```
Canvas မှာ Cloud node ကို "Internet" visual label ထားပြီး — Switch1 topology real ဖြစ်ပြီး Kali→R1 path narrative အတိုင်း demo ပြနိုင်သည်

---

### ✅ KVM VMs Copy to GNS3 + Import (Completed 2026-07-03)

**Status:** ✅ Done

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

**Note on linux2024:** Confirmed = pfSense 2.7.2 CE (FreeBSD-based). Used as main firewall in AEGIS topology.

**Next:** Wire topology in GNS3 canvas

---

## ~~Topology Wiring Plan~~ (SUPERSEDED — DO NOT USE)

> ❌ **SUPERSEDED** — ဤ section ၌ Switch1 မပါ၊ pfSense interface name မှား (`vtnet0` ≠ actual `em0`)၊ ether2 = R2 link (မှားသည် — ether3 ဖြစ်ရမည်)၊ `pfSense LAN0/MGMT → aegis-forwarder` ၌ MGMT = OPT2/em3 ဖြစ်ရမည်
> ✅ **Actual wiring:** "2026-07-04 — GNS3 Final Topology Wiring Complete" + "2026-07-07 — Full Routing Chain Verified" sections တွင် ကြည့်ပါ

---

## ~~Router IP Config Plan~~ (SUPERSEDED — Wrong IPs — DO NOT USE)

> ❌ **SUPERSEDED** — ဤ section ၌ပါသည့် IPs (192.168.56.x, 10.20.0.x) သည် early planning draft မှ မှားယွင်းသော values ဖြစ်သည်။ Actual implementation မှ မတူဘဲ ဖြစ်သည်။
> ✅ **See instead:** "2026-07-04 — Router-1 IP Configuration Complete" and "2026-07-04 — Router-2 IP Configuration Complete" sections below.

**Actual confirmed IPs (2026-07-07 verified):**

| Router | Interface | IP | Purpose |
|---|---|---|---|
| R1 | ether1 | 192.168.122.2/24 | Kali/Switch1 side |
| R1 | ether2 | **DISABLED** | NAT (duplicate route — disabled) |
| R1 | ether3 | 10.0.12.1/30 | R2 transit link |
| R2 | ether1 | 10.0.12.2/30 | R1 transit link |
| R2 | ether2 | 10.0.23.1/30 | pfSense WAN link |

---

## ~~pfSense Config Plan~~ (SUPERSEDED — Wrong IPs — DO NOT USE)

> ❌ **SUPERSEDED** — WAN IP `10.10.0.254/24` နှင့် `vtnet0/vtnet1` interface names များသည် မှားသည်။
> - pfSense GNS3 QEMU မှာ NIC type = e1000 → interfaces = `em0, em1, em2, em3` (`vtnet` မဟုတ်)
> - WAN IP = `10.0.23.2/30` (not `10.10.0.254/24`)
> ✅ **See instead:** "2026-07-07 — pfSense Factory Reset + Full Reconfiguration" section.

**Actual confirmed pfSense config (2026-07-07 verified):**

| Interface | GNS3 port | IP | Role |
|---|---|---|---|
| WAN | em0 | 10.0.23.2/30, GW=10.0.23.1 | R2 link |
| LAN | em1 | 10.10.10.1/24 | DMZ (bank-web, bank-mail) |
| OPT1 | em2 | 10.20.20.1/24 | Internal (teller-pc, customer-db) |
| OPT2 | em3 | 10.30.30.1/24 | MGMT (aegis-forwarder) |

---

## Verification Checklist (End-to-End)

- [x] `ping 192.168.122.2` Kali → R1 ✅ (2026-07-07)
- [x] `ping 10.0.12.2` Kali → R2 ✅ (2026-07-07)
- [x] `ping 10.0.23.2` Kali → pfSense WAN ✅ (2026-07-07)
- [x] `ping 10.10.10.10` Kali → bank-web ✅ (2026-07-07)
- [x] `traceroute 10.10.10.10` — 4-hop path confirmed ✅ (2026-07-07 21:11)
- [ ] AEGIS dashboard receives live events from forwarder
- [ ] pfSense block event appears in dashboard after attack
- [ ] sqlmap attack succeeds before rule, fails after rule
- [ ] `pfctl -s info` counter increments on block

---

### ~~[PENDING]~~ ✅ KVM VMs Import into GNS3 (Done 2026-07-03)

**Status:** ✅ Done — Kali, linux2024 (pfSense), ubuntu-base imported as QEMU VM templates in GNS3

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

### ~~[PENDING]~~ ✅ GNS3 Topology Wiring (Done 2026-07-04, Switch1 added 2026-07-07)

**Status:** ✅ Done — See "2026-07-04 — GNS3 Final Topology Wiring Complete" and "2026-07-07 — Kali → Ubuntu VM Ping Fail" entries for full details

---

### 2026-07-04 — Router-1 IP Configuration Complete

**Status:** ✅ Done

**What:** Router-1 (MikroTik CHR) IP addresses, routes, NAT masquerade setup

**Interface mapping (GNS3 e → MikroTik ether):**
| GNS3 | MikroTik | Connected to | IP |
|---|---|---|---|
| e0 | ether1 | Cloud1 / Attacker (192.168.122.0/24) | 192.168.122.2/24 |
| e1 | ether2 | NAT cloud (nat0) | DHCP → 192.168.122.135/24 ⚠️ **DISABLED 2026-07-07** (duplicate route fix) |
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
- ether2: 192.168.122.135/24 (DHCP from NAT cloud initially) → **DISABLED 2026-07-07** ✅
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

### ~~[PENDING]~~ ✅ pfSense Interface Configuration (Done 2026-07-07)

**Status:** ✅ Done — Factory reset + full reconfigure. See "2026-07-07 — pfSense Factory Reset + Full Reconfiguration" entry.

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

### Ubuntu VM Setup (Bank Servers) — Partially Done

**Status:** 🔄 In Progress

**What:** Configure each Ubuntu VM clone for its role

| VM | IP | Static IP | Service | Status |
|---|---|---|---|---|
| bank-web | 10.10.10.10/24 GW:10.10.10.1 | ✅ Set | Apache2 + DVWA | ⏳ Services pending |
| bank-mail | 10.10.10.20/24 GW:10.10.10.1 | ✅ Set | Postfix + Dovecot | ⏳ Services pending |
| teller-pc | 10.20.20.10/24 GW:10.20.20.1 | ✅ Set | Desktop client sim | ⏳ Services pending |
| customer-db | 10.20.20.20/24 GW:10.20.20.1 | ✅ Set | PostgreSQL | ⏳ Services pending |
| aegis-forwarder | 10.30.30.10/24 GW:10.30.30.1 | ✅ Set | Suricata + AEGIS agent | ⏳ Agent pending |

> ⚠️ **Old wrong IP removed:** aegis-forwarder was incorrectly noted as `10.10.0.200` in early planning. Correct IP = `10.30.30.10` (OPT2/MGMT subnet).

---

### [PENDING] — AEGIS Forwarder Deployment

**Status:** ⏳ Not Started

**What:** Deploy `aegis_forwarder.py` on the AEGIS Ubuntu VM

**How:**
```bash
# On aegis-forwarder VM (10.30.30.10)
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

### End-to-End Demo Verification — In Progress

**Status:** 🔄 In Progress

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

**Fix applied (03:48):**
```routeros
/ip dhcp-client disable numbers=0
```
→ Route table clean — 192.168.122.0/24 ether1 တစ်ကြောင်းသာ ကျန်သည် ✅
→ GNS3 topology verified: R1 e0=ether1(Kali), e1=ether2(NAT/disabled), e2=ether3(R2) — မှန်ကန်သည် ✅

**Result:** R1 route table clean, duplicate route ပျောက်ပြီ ✅

**Further diagnosis (03:53–03:55):**
Cloud1 node ရှိ available interfaces: enp1s0 🔴, wlp0s20f3 🔴, virbr0 🟢
virbr0 = Kali side မှာ သုံးနေပြီ → R1 ဆီ ထပ် assign မရဘူး (GNS3 Cloud = one port per interface)

**Real root cause:** R1 e0 ↔ Cloud1 link မှာ wlp0s20f3 (WiFi, no link) ကိုသုံးခဲ့ → Kali (virbr0) နဲ့ R1 ether1 (wlp0s20f3) L2 segment မတူဘဲ ARP fail ဖြစ်ခဲ့သည်

**Fix:** GNS3 Ethernet Switch ထည့်ပြီး topology ပြောင်း:
```
Kali e0 ──┐
           ├── [Ethernet Switch] ── Cloud1 (virbr0)
R1 e0  ──┘
```
virbr0 တစ်ကြိမ်သာ သုံး၊ Switch မှ Kali+R1 နှစ်ခုလုံး virbr0 bridge ပေါ် ရောက်စေသည်

**Fix applied (04:00):** GNS3 Ethernet Switch ထည့်ပြီး topology ပြောင်း:
- R1 e0 ဟောင်းကြိုးဖြုတ်ပြီး Switch1 e1 သို့ ချိတ်သည်
- Final: Attacker e0 → Switch1 e0 | Switch1 e1 → R1 e0 | Switch1 e2 → Cloud1(virbr0)

**Result:** ✅ Done — `ping 192.168.122.2` ရပြီ (Kali → R1 ether1 reachable)

**Extended troubleshooting — Kali → R2 (10.0.12.2) မရတာ (04:07–04:28):**
- R1 firewall: empty ✅ | R1 → R2 direct: ✅ | R2 → Kali: ✅
- traceroute မှ root cause ထွက်: hop1 = 192.168.122.1 (KVM gateway, not R1!)
- Kali ရဲ့ `10.0.0.0/8 via 192.168.122.2` route ပျောက်နေ → internet ကတဆင့် routing ဖြစ်နေသည်
- R1 ARP table: 192.168.122.132 (stale) ✅, 10.0.12.2 (stale) ✅

**Fix:** `sudo ip route add 10.0.0.0/8 via 192.168.122.2` (Kali မှာ ပြန်ထည့်)
**Note:** Kali reboot/network restart ဖြစ်တိုင်း route ပျောက်သည် — permanent fix: `/etc/network/interfaces` သို့မဟုတ် ip-route systemd script လိုမည်

**Result:** ✅ Route ထည့်ပြီး `ping 10.0.12.2` ရပြီ (Kali → R2 reachable)

---

### 2026-07-07 — Kali Permanent Static Route (nmcli)

**Status:** ✅ Done

**Problem:** `sudo ip route add 10.0.0.0/8 via 192.168.122.2` သည် reboot/network restart တိုင်း ပျောက်သည်

**Root cause:** `ip route add` = kernel memory သာ — NetworkManager config ထဲ မသိမ်း

**Permanent fix — nmcli NetworkManager route:**
```bash
# Connection name စစ်
nmcli con show
# → "Wired connection 1" (UUID: 402c307a-d340-46e7-89ff-92eb25dc58bf), device eth0

# Route ထည့် (တစ်ကြောင်းတည်း ရိုက်ရမည်)
nmcli con mod "Wired connection 1" +ipv4.routes "10.0.0.0/8 192.168.122.2"

# Apply — connection down/up
nmcli con down "Wired connection 1"
nmcli con up 402c307a-d340-46e7-89ff-92eb25dc58bf   # UUID သုံး (quote issue ရှောင်ဖို့)

# Verify
ip route show | grep 10.0
# → 10.0.0.0/8 via 192.168.122.2 dev eth0 proto static metric 100 ✅
```

**Troubleshooting encountered:**
- `nmcli con mod ... +ipv4.route` (route singular) → "command not found" — `+ipv4.routes` (plural) ဖြစ်ရမည်
- Command ၂ ကြောင်းခွဲ ရိုက်မိ → `cmdand quote>` stuck — Ctrl+C ပြီး တစ်ကြောင်းတည်း ရိုက်ရမည်
- `nmcli con up 'Wired connection 1'` single-quote → `quote>` stuck (zsh smart-quote issue)
- `nmcli con up eth0` → "Error: unknown connection 'eth0'" — device name မဟုတ်ဘဲ UUID သုံးရမည်
- Wrong IP typed: `192.168.12.2` (missing digit) → undo: `nmcli con mod ... -ipv4.routes "10.0.0.0/8 192.168.12.2"` then redo with correct IP

**Key rules:**
1. `+ipv4.routes` (plural s ပါမည်) — singular = command not found
2. Quote ပြဿနာဖြစ်ရင် UUID နဲ့ run: `nmcli con up <UUID>`
3. nmcli command တစ်ကြောင်းတည်းဖြစ်မှ Enter နှိပ်ပါ

**Result:** ✅ Reboot ပြီးလဲ `10.0.0.0/8 via 192.168.122.2` ကျန်မည်

---

### 2026-07-07 — pfSense WAN Firewall: Block Private Networks Disabled

**Status:** ✅ Done

**Problem:** pfSense WAN rules (easyrule) ထည့်ထားသော်လည်း Kali (192.168.122.132) မှ ping 10.0.23.2 မရ

**Root cause:** pfSense 2.7 WAN interface → **"Block private networks and loopback addresses"** default enabled
- RFC1918 addresses (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) ကို **user firewall rules ထက်အထက်မှ** auto-block လုပ်သည်
- Lab network တစ်ခုလုံး private addresses ဖြစ်သောကြောင့် Kali ရဲ့ packet အားလုံး block ဖြစ်နေသည်
- `easyrule` rules = pass rules ဖြစ်သော်လည်း block-private rule က priority ပိုမြင့်သည်

**Fix attempts (pfSense Shell — Option 8):**
```bash
# First attempt (wrong subnet 192.168.12.0/24)
easyrule pass wan icmp 192.168.12.0/24 any      # ← mismatch, Kali=192.168.122.x
easyrule pass wan any 192.168.12.0/24 any

# Corrected (192.168.122.0/24)
easyrule pass wan icmp 192.168.122.0/24 any     # ✅ Successfully added
easyrule pass wan any 192.168.122.0/24 any      # ✅ Successfully added
# Still failed — because blockpriv fires BEFORE user rules
```

**Actual fix — WebGUI (from bank-web VM browser):**
```
bank-web VM (10.10.10.10) → Firefox → http://10.10.10.1
Login: admin / pfsense
Interfaces → WAN
  ☑ Block private networks and loopback addresses → UNCHECK ✅
  ☑ Block bogon networks                          → UNCHECK ✅
Save → Apply Changes
```

**Result:** ✅ `ping 10.0.23.2` ရပြီ (Kali → pfSense WAN)
**Result:** ✅ `ping 10.10.10.10` ရပြီ (Kali → bank-web)

**Rule:** Lab network = all private IPs → pfSense WAN "Block private networks" = **MUST disable** before any WAN rules work

---

### 2026-07-07 — pfSense WebGUI Permanent OPT1 Rule (Internal Network) ✅

**Status:** ✅ Done

**Time:** 21:23

**What:** pfSense WebGUI → Firewall → Rules → OPT1 tab မှ permanent pass rule ထည့်ခဲ့သည်

**Firewall → Rules → OPT1 confirmed rules (screenshot):**

| States | Protocol | Source | Destination | Description |
|---|---|---|---|---|
| 239/275 KiB | IPv4 * (Any) | OPT1 subnets | Any | **Allow INT outbound** ← WebGUI permanent ✅ |
| 0/837 KiB | IPv4 * | 10.20.20.0/24 | Any | Passed via EasyRule |

**WebGUI steps:**
```
Firewall → Rules → OPT1 → Add (↑ top)
  Action:      Pass
  Interface:   OPT1
  Protocol:    Any
  Source:      OPT1 subnets
  Destination: Any
  Description: Allow INT outbound
→ Save → Apply Changes
```

**State counters:** 239/275 KiB = traffic already passing through this rule → teller-pc/customer-db (10.20.20.x) internet access confirmed ✅

---

### 2026-07-07 — pfSense WebGUI Permanent OPT2 Rule (MGMT Network) ✅

**Status:** ✅ Done

**Time:** 21:23

**What:** pfSense WebGUI → Firewall → Rules → OPT2 tab မှ permanent pass rule ထည့်ခဲ့သည်

**Firewall → Rules → OPT2 confirmed rules (screenshot):**

| States | Protocol | Source | Destination | Description |
|---|---|---|---|---|
| 12/6 KiB | IPv4 * (Any) | OPT2 subnets | Any | **Allow MGMT outbound** ← WebGUI permanent ✅ |
| 0/25 KiB | IPv4 * | 10.30.30.0/24 | Any | Passed via EasyRule |

**WebGUI steps:**
```
Firewall → Rules → OPT2 → Add (↑ top)
  Action:      Pass
  Interface:   OPT2
  Protocol:    Any
  Source:      OPT2 subnets
  Destination: Any
  Description: Allow MGMT outbound
→ Save → Apply Changes
```

**State counters:** 12/6 KiB = aegis-forwarder (10.30.30.10) traffic passing ✅

**pfSense Permanent Firewall Rules — Complete Summary (2026-07-07):**

| Interface | Rule Name | Source | Protocol | Status |
|---|---|---|---|---|
| WAN | Allow Kali | 192.168.122.0/24 | Any | ✅ Permanent |
| OPT1 | Allow INT outbound | OPT1 subnets | Any | ✅ Permanent |
| OPT2 | Allow MGMT outbound | OPT2 subnets | Any | ✅ Permanent |
| LAN | (default anti-lockout) | LAN subnets | Any | ✅ Built-in |

> EasyRule entries (ICMP echoreq, subnet-specific) = supplementary rules ဖြစ်ပြီး permanent rules နဲ့ ထပ်နေသောကြောင့် redundant ဖြစ်သည်။ Permanent rules = restart-safe ✅

---

### 2026-07-07 — bank-web: Apache2 + PHP + MariaDB apt Install Start ⚡

**Status:** 🔄 In Progress (21:27)

**VM:** bank-web (10.10.10.10), Ubuntu 22.04 (Jammy)

**Command run:**
```bash
sudo apt update && sudo apt install -y apache2 php php-mysqli php-gd libapache2-mod-php git mariadb-server
```

**apt update output observed (screenshot):**
```
Ign:1 http://mm.archive.ubuntu.com/ubuntu jammy InRelease
Ign:2 http://security.ubuntu.com/ubuntu jammy-security InRelease
Ign:3 http://mm.archive.ubuntu.com/ubuntu jammy-updates InRelease
Ign:2 http://security.ubuntu.com/ubuntu jammy-security InRelease
Ign:4 http://mm.archive.ubuntu.com/ubuntu jammy-backports InRelease
Ign:2 http://security.ubuntu.com/ubuntu jammy-security InRelease
Err:2 http://security.ubuntu.com/ubuntu jammy-security InRelease
        Temporary failure resolving 'security.ubuntu.com'
0% [Connecting to mm.archive.ubuntu.com]   ← still running
```

**Analysis:**
- `mm.archive.ubuntu.com` (Myanmar mirror) = connecting ✅ (main packages)
- `security.ubuntu.com` = "Temporary failure resolving" ⚠️
- Root cause: pfSense DNS forwarding မသတ်မှတ်ရသေး သို့မဟုတ် security.ubuntu.com DNS ယာယီ fail
- **Impact:** security updates မရမည် — main packages (apache2, php, mariadb) = Myanmar mirror မှ ရနိုင်သည်

**If DNS fail persists — fix options:**
```bash
# Option 1: security.ubuntu.com ကို Myanmar mirror ဖြင့် override
sudo sed -i 's|http://security.ubuntu.com|http://mm.archive.ubuntu.com|g' /etc/apt/sources.list
sudo apt update

# Option 2: Google DNS override (test)
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
sudo apt update
```

**Note:** `Ign` (Ignored) = InRelease file redirect ignore → normal for mirrors. `Err` (Error) = actual failure → security.ubuntu.com DNS only.

---

### 2026-07-07 — pfSense WebGUI Permanent WAN Rule Added ✅

**Status:** ✅ Done

**Time:** 21:15

**What:** pfSense WebGUI မှ permanent WAN firewall rule ထည့်ခဲ့သည် — easyrule rules (restart ဖြင့် ပျောက်နိုင်) အပြင် WebGUI permanent rule ပါ ရှိသည်

**Firewall → Rules → WAN ၌ active rules (confirmed from screenshot):**

| # | Protocol | Source | Destination | Description |
|---|---|---|---|---|
| 1 | IPv4 * (Any) | 192.168.122.0/24 | Any | **Allow Kali** ← WebGUI permanent rule ✅ |
| 2 | IPv4 ICMP echoreq | 192.168.122.0/24 | Any | Passed via EasyRule |
| 3 | IPv4 * | 192.168.122.0/24 | Any | Passed via EasyRule |

**Message confirmed:** "The changes have been applied successfully. The firewall rules are now reloading in the background." ✅

**WARNING shown:** admin account password = default value → System → User Manager မှ ပြောင်းရမည်

**Rule:** "Allow Kali" (top rule) = permanent — pfSense restart ဖြင့် မပျောက်ဘဲ ကျန်မည် ✅

---

### 2026-07-07 — Traceroute 4-Hop Path Confirmed ✅

**Status:** ✅ Complete

**Time:** 21:11 (photo confirmed)

**Command (Kali):**
```bash
traceroute 10.10.10.10
```

**Output (confirmed from screenshot):**
```
traceroute to 10.10.10.10 (10.10.10.10), 30 hops max, 60 byte packets
 1  192.168.122.2  (192.168.122.2)   2.990 ms  2.480 ms  2.688 ms   ← Router-1 ✅
 2  10.0.12.2      (10.0.12.2)       3.871 ms  4.040 ms  4.362 ms   ← Router-2 ✅
 3  10.0.23.2      (10.0.23.2)       4.946 ms  4.922 ms  5.136 ms   ← pfSense WAN ✅
 4  10.10.10.10    (10.10.10.10)     5.745 ms  5.945 ms  6.162 ms   ← bank-web ✅
```

**Ping also confirmed:**
```
ping 10.10.10.10
64 bytes from 10.10.10.10: icmp_seq=1 ttl=61 time=2.04 ms  ✅
64 bytes from 10.10.10.10: icmp_seq=2 ttl=61 time=7.57 ms  ✅
```

**TTL=61 analysis:** bank-web မှ TTL=64 ထွက် → 3 hops (pfSense→R2→R1) ဖြတ်ပြီး Kali ရောက်လာသည် → routing path ကောင်းမွန်ကြောင်း confirm ✅

**Milestone:** Attacker (Kali) မှ target (bank-web) ထိ full multi-hop path real routing verified — demo-ready ✅

---

### 2026-07-07 — Full Routing Chain Verified ✅

**Status:** ✅ **COMPLETE**

**Confirmed working path (Kali → bank-web):**

| Hop | IP | Test | Result |
|---|---|---|---|
| Kali (attacker) | 192.168.122.132 | — | ✅ |
| Router-1 WAN | 192.168.122.2 | `ping 192.168.122.2` | ✅ |
| Router-2 WAN | 10.0.12.2 | `ping 10.0.12.2` | ✅ |
| pfSense WAN | 10.0.23.2 | `ping 10.0.23.2` | ✅ |
| bank-web | 10.10.10.10 | `ping 10.10.10.10` | ✅ |

**Full config summary (confirmed):**

**Kali (192.168.122.132):**
```bash
# Permanent static route (NetworkManager)
10.0.0.0/8 via 192.168.122.2 dev eth0 proto static metric 100
# Set via: nmcli con mod "Wired connection 1" +ipv4.routes "10.0.0.0/8 192.168.122.2"
```

**Router-1 (MikroTik CHR):**
```routeros
/ip address:
  ether1: 192.168.122.2/24    ← Kali/Switch1 (e0)
  ether2: (DHCP disabled)     ← NAT (e1, disabled)
  ether3: 10.0.12.1/30        ← R2 link (e2)
/ip route:
  0.0.0.0/0 via 192.168.122.1
  10.0.0.0/8 via 10.0.12.2
/ip firewall filter: (empty — no rules)
/ip firewall nat: chain=srcnat out-interface=ether2 action=masquerade
```

**Router-2 (MikroTik CHR):**
```routeros
/ip address:
  ether1: 10.0.12.2/30        ← R1 link (e0)
  ether2: 10.0.23.1/30        ← pfSense WAN link (e1)
/ip route:
  0.0.0.0/0 via 10.0.12.1
  10.10.10.0/24 via 10.0.23.2
  10.20.20.0/24 via 10.0.23.2
  10.30.30.0/24 via 10.0.23.2
```

**pfSense:**
```
WAN  em0: 10.0.23.2/30, GW=10.0.23.1
LAN  em1: 10.10.10.1/24 (DHCP 100-200)
OPT1 em2: 10.20.20.1/24 (DHCP 100-200)
OPT2 em3: 10.30.30.1/24 (DHCP 100-200)
Firewall WAN: Block private networks = DISABLED ✅
Firewall WAN: Block bogon networks   = DISABLED ✅
WAN rules: pass icmp 192.168.122.0/24 any ✅
           pass any  192.168.122.0/24 any ✅
```

**GNS3 Topology (Switch1 fix):**
```
Attacker(Kali) e0 ──┐
                     ├── [Switch1] ── Cloud1 (virbr0)
Router-1       e0 ──┘
Router-1 e2 ─── Router-2 e0
Router-2 e1 ─── pfSense em0 (WAN)
pfSense em1 ─── DMZ-Switch ─── bank-web, bank-mail
pfSense em2 ─── INT-Switch ─── teller-pc, customer-db
pfSense em3 ─── aegis-forwarder
```

---

### 2026-07-08 — R1 Masquerade Rule Bug Fix (ether2 → ether1)

**Status:** ✅ Done

**What:** Router-1 masquerade rule ကို ether2 (NAT cloud interface) မှ ether1 သို့ ပြောင်းပြင်ခဲ့သည် — ether2 သည် DHCP disabled ဖြစ်နေ၍ masquerade မအလုပ်လုပ်ခဲ့ဘဲ bank-web internet connectivity ပြဿနာ ဖြစ်ခဲ့သည်

**How:**
```routeros
# Remove wrong rule
/ip firewall nat remove [find chain=srcnat out-interface=ether2]
# Add correct rule on ether1 (the active NAT/Cloud interface)
/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade
```

**Result:** R1 masquerade ether1 ပေါ်တွင် အလုပ်လုပ်ပြီး bank-web မှ internet access ရသွားသည် ✅

**Next:** bank-web ၌ package install ဆက်လုပ်မည်

---

### 2026-07-08 — R1 Default Route Confirmed (via 192.168.122.1)

**Status:** ✅ Done

**What:** Router-1 default route `0.0.0.0/0 via 192.168.122.1` (GNS3 NAT cloud gateway) confirm ပြုလုပ်ခဲ့သည်

**How:**
```routeros
/ip route print
# Expected: 0.0.0.0/0 via 192.168.122.1 ether1
```

**Result:** Default route ကောင်းမွန်ကြောင်း confirmed ✅ — bank-web မှ apt update/install အတွက် internet traffic ဤ route မှ ဖြတ်သွားသည်

---

### 2026-07-08 — bank-web Internet Connectivity Debugging & Restore

**Status:** ✅ Done

**What:** bank-web (10.10.10.10, Ubuntu) မှ internet access မရသောပြဿနာကို စစ်ဆေးပြင်ဆင်ခဲ့သည် — Root cause = R1 masquerade ether2 (wrong interface) ကြောင့် NAT မအလုပ်လုပ်ခဲ့

**How:**
- R1 masquerade interface ကို ether1 သို့ ပြောင်း (above entry ကြည့်ပါ)
- bank-web မှ `ping 8.8.8.8` / `curl -I https://google.com` ဖြင့် connectivity test

**Result:** bank-web မှ internet reachable — `apt update` အောင်မြင်ခဲ့သည် ✅

---

### 2026-07-08 — Package Installation Fix (i386 Architecture Removal + Cache Clear)

**Status:** ✅ Done

**What:** bank-web ၌ `apt install` fail ဖြစ်နေသောပြဿနာကို fix ခဲ့သည် — Root cause: i386 (32-bit) architecture ကို dpkg မှ track လုပ်နေပြီး Myanmar mirror ၌ i386 packages မရှိ၍ dependency chain fail ဖြစ်ခဲ့

**How:**
```bash
# Step 1: i386 architecture ဖြုတ်ပါ
dpkg --print-foreign-architectures        # confirm i386 ရှိကြောင်း
sudo dpkg --remove-architecture i386

# Step 2: APT cache အကုန် clear လုပ်ပါ
sudo apt clean
sudo apt autoclean
sudo rm -rf /var/lib/apt/lists/*

# Step 3: Fresh update + install
sudo apt update
sudo apt install -y apache2 php php-mysqli php-gd libapache2-mod-php git mariadb-server
```

**Result:** i386 ဖြုတ်ပြီးနောက် apt dependency chain ကောင်းသွားပြီး packages အောင်မြင်စွာ install ဆင်းခဲ့သည် ✅

**Root Cause Summary:** i386 architecture → Myanmar mirror ၌ i386 packages မရှိ → dependency chain fail → `apt install` block ဖြစ်ခဲ့ — removing i386 registration resolves it completely

---

### 2026-07-08 — Apache2, PHP, MariaDB Installation on bank-web

**Status:** ✅ Done

**What:** bank-web (Ubuntu 10.10.10.10) ၌ DVWA အတွက် လိုအပ်သည့် web stack packages တင်ခဲ့သည်

**Packages installed:**
- `apache2` — web server
- `php` — PHP runtime
- `php-mysqli` — MySQL/MariaDB PHP extension
- `php-gd` — image processing PHP extension
- `libapache2-mod-php` — Apache PHP module
- `git` — for DVWA clone
- `mariadb-server` — database server

**Command:**
```bash
sudo apt install -y apache2 php php-mysqli php-gd libapache2-mod-php git mariadb-server
```

**Result:** All packages installed successfully ✅ — Apache2 + MariaDB services running

**Next:** DVWA clone + configure

---

### 2026-07-08 — DVWA Clone + Configuration on bank-web

**Status:** ✅ Done

**What:** Damn Vulnerable Web Application (DVWA) ကို bank-web ၌ clone ပြီး config ချိန်ညှိခဲ့သည် — SQL injection, XSS, brute force attack target အဖြစ် သုံးမည်

**How:**

**Step 1 — Clone:**
```bash
sudo git clone https://github.com/digininja/DVWA /var/www/html/dvwa
sudo cp /var/www/html/dvwa/config/config.inc.php.dist /var/www/html/dvwa/config/config.inc.php
```

**Step 2 — DB password config:**
```bash
sudo sed -i "s/\$_DVWA\[ 'db_password' \] = 'p@ssw0rd';/\$_DVWA[ 'db_password' ] = 'p\@ssw0rd';/" \
    /var/www/html/dvwa/config/config.inc.php
```

**Step 3 — Permissions + restart:**
```bash
sudo chown -R www-data:www-data /var/www/html/dvwa
sudo chmod -R 755 /var/www/html/dvwa
sudo systemctl restart apache2
```

**Result:** DVWA deployed at `http://10.10.10.10/dvwa` ✅ — Apache2 restarted cleanly

**Next:** MariaDB ၌ DVWA database + user create — ✅ Done (2026-07-08 01:29)

---

### 2026-07-08 — DVWA MariaDB Setup + Database Initialized

**Status:** ✅ Done

**Time:** 01:29–01:43

**What:** DVWA အတွက် MariaDB database + user create ပြီး DVWA setup page မှ database initialize လုပ်ခဲ့သည် — login page ပေါ်လာသည်ဖြင့် DVWA fully operational ဖြစ်ကြောင်း confirmed

**How:**
```bash
sudo mysql -u root
```
```sql
CREATE DATABASE dvwa;
CREATE USER 'dvwa'@'localhost' IDENTIFIED BY 'p@ssw0rd';
GRANT ALL PRIVILEGES ON dvwa.* TO 'dvwa'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```
Browser: `http://10.10.10.10/dvwa/setup.php` → **Create / Reset Database** နှိပ်

**Result:** DVWA login page (`http://10.10.10.10/dvwa/login.php`) ပေါ်လာသည် ✅
- Login: `admin` / `password`
- bank-web ၌ SQL injection, XSS, brute force attack target ready

**Troubleshooting မှတ်တမ်း:**
- `git clone` ပထမအကြိမ် fail — URL နဲ့ path ကြားမှာ space ပျောက်သွားသောကြောင့် (`https://github.com/digininja/DVWA/var/www/html/dvwa/` ဟု တစ်ကြောင်းတည်း ဆက်သွားခဲ့)
- `sed` command fail — special character escape ပြဿနာ; DVWA default config မှာ `p@ssw0rd` already ရှိပြီးသားဖြစ်၍ sed skip လုပ်၍ ဖြေရှင်းခဲ့

**Next:** Kali မှ DVWA target ကို nmap scan, SQLi, brute force attacks စနိုင်ပြီ

---

### 2026-07-08 — Kali → bank-web Connectivity + nmap Port Scan

**Status:** ✅ Done

**Time:** 01:46

**What:** Kali (attacker) မှ bank-web (10.10.10.10) သို့ ping + nmap service scan ပြုလုပ်ကာ target reachable ကြောင်း confirm ခဲ့သည်

**Commands (Kali မှ):**
```bash
ping 10.10.10.10
nmap -sV 10.10.10.10
```

**Result:**
```
Host is up (0.0069s latency)
PORT   STATE SERVICE VERSION
80/tcp open  http    Apache httpd 2.4.52 ((Ubuntu))
```
- Ping: 64 bytes, ttl=61, time≈2–7ms ✅
- Port 80/tcp: Apache 2.4.52 (Ubuntu) open ✅
- 999 other ports: closed (reset) — attack surface = port 80 only

**Significance:** Attacker (Kali) မှ target (bank-web) ထိ multi-hop routing အတည်ပြုပြီး attack ကို port 80 မှတစ်ဆင့် ဆက်လုပ်နိုင်မည်

---

### 2026-07-08 — DVWA Security Level set to Low

**Status:** ✅ Done

**Time:** 01:47

**What:** DVWA Security page (`http://10.10.10.10/dvwa/security.php`) မှ security level ကို **Low** သို့ သတ်မှတ်ခဲ့သည် — SQL Injection, XSS, Command Injection, File Inclusion, Brute Force attack modules အားလုံး fully vulnerable mode ဖြင့် ရရှိပြီ

**How:** DVWA → DVWA Security → dropdown "Low" → Submit

**Confirmed modules (attack-ready):**
- SQL Injection / SQL Injection (Blind)
- XSS (DOM) / XSS (Reflected) / XSS (Stored)
- Command Injection
- File Inclusion / File Upload
- Brute Force
- CSRF, Weak Session IDs, CSP Bypass, JavaScript Attacks, Authorisation Bypass

**Result:** "Security level set to low" message confirmed ✅

---

### 2026-07-08 — Suricata + Fail2ban Installation on bank-web

**Status:** ✅ Done

**Time:** 01:50

**What:** bank-web ၌ IDS/IPS tools (Suricata, Fail2ban) တပ်ဆင်ခဲ့သည် — Kali မှ attacks များကို detect + block ဖို့

**Command:**
```bash
sudo apt install -y suricata fail2ban
sudo systemctl enable suricata fail2ban
sudo systemctl start suricata fail2ban
```

**Initial Result:**
- **Fail2ban:** ✅ `active (running)` — PID 13762, Memory 21.0M
- **Suricata:** ❌ `failed` — exit-code status=1/FAILURE

**Root Cause (Suricata fail):** Default config ၌ network interface မသတ်မှတ်ရသေး — `af-packet` mode အတွက် interface name လိုအပ်သည်

---

### 2026-07-08 — Suricata Interface Fix (enp0s4) → Running

**Status:** ✅ Done

**Time:** 01:51–01:54

**What:** Suricata ကို bank-web ၏ network interface `enp0s4` ဖြင့် config ချိန်ညှိပြီး restart လုပ်ခဲ့သည်

**How:**

**Step 1 — Interface name ရှာ:**
```bash
ip link show
# Output: altname enp0s4  ← ဤ interface name ကို မှတ်ထားသည်
```

**Step 2 — Suricata config ပြင်:**
```bash
sudo vim /etc/suricata/suricata.yaml
```
`af-packet:` section ၌:
```yaml
af-packet:
  - interface: enp0s4
```

**Step 3 — Restart + verify:**
```bash
sudo systemctl restart suricata
sudo systemctl status suricata
```

**Result:**
```
● suricata.service - Suricata IDS/IDP daemon
   Active: active (running) since Wed 2026-07-08 01:54:25 +0630; 13s ago
   Main PID: 13900 (Suricata-Main)
   Memory: 41.3M
```
Suricata ✅ `active (running)` — interface `enp0s4` မှ network traffic monitor စပြုလုပ်ပြီ

**Suricata log path:** `/var/log/suricata/eve.json` (EVE JSON format — aegis_forwarder.py ဖတ်မည်)
**Fail2ban log path:** `/var/log/fail2ban.log`

**Troubleshooting:**
- `af-packet` + wrong/missing interface → immediate exit-code 1 failure
- Fix: `ip link show` ဖြင့် actual interface name စစ်ဆေး၊ config ၌ တိကျစွာ ထည့်ရမည်

---

### 2026-07-08 — AEGIS Render API + Vercel Dashboard — Live ✅

**Status:** ✅ Done

**Time:** 02:00–02:01

**What:** Render API server ၌ environment variables အားလုံး ရှိပြီးသားဖြစ်ကြောင်း confirm ခဲ့သည်။ AEGIS Vercel dashboard **Live Monitoring** mode ဖြင့် real data ရောက်နေသည်ကို verified

**Render Environment Variables (confirmed set):**

| Key | Status |
|---|---|
| `AEGIS_ADMIN_KEY` | ✅ Set |
| `AEGIS_INGEST_KEY` | ✅ Set |
| `NODE_ENV` | ✅ Set |
| `PORT` | ✅ Set |
| `SUPABASE_DB_URL` | ✅ Set |

**Render Service:** `aegis-api-server` — Blueprint managed, `sohu2723-star/aegis-soc-dashboard` main branch
**Render URL:** `https://aegis-api-server-jp3b.onrender.com`

**AEGIS Dashboard (Vercel) — Live Data Confirmed:**

| Metric | Value |
|---|---|
| Total Events | 100 |
| Critical Threats | 0 |
| Active Alerts | 90 |
| Systems Online | 4 / 9 |

**Events by Type (confirmed in chart):**
- `network_attack` — SSH Brute Force events
- `web_attack` — Suspicious TLS events

**Recent Telemetry (confirmed):**
```
192.168.84.135 → ubuntu-server  [SSH Brute Force]  network_attack  11:27, 11:22, 11:05, 11:02
192.168.84.130 → 216.24.57.8    [Suspicious TLS]   web_attack      10:52, 10:48, 10:42
```

**Note:** Render free tier = cold start ~50s after 15-min inactivity — expected behavior, not a bug

**Next:** aegis-forwarder VM (10.30.30.10) ၌ `aegis_forwarder.py` setup လုပ်ပြီး bank-web Suricata/Fail2ban logs ကို Render API ထဲ forward လုပ်ရမည်

---

---

### 2026-07-08 — R2 Routing Bug Fix (10.10.30.0/24 → 10.30.30.0/24) ✅

**Status:** ✅ Done

**Time:** 02:52

**VM:** Router-2 (MikroTik)

**Problem:** Kali မှ `ping 10.30.30.10` (aegis-forwarder) လုပ်သောအခါ `From 10.0.12.2 icmp_seq=N Time to live exceeded` error ပေါ်နေသည် — R1↔R2 routing loop ဖြစ်နေသည်။

**Root Cause:** R2 route table ၌ route #3 ကို `10.10.30.0/24` (ဂဏန်း မှားနေ) ဟု ရေးထားသည်။ `10.30.30.0/24` (aegis-forwarder subnet) ဖြစ်ရမည်။ မှားသော route ကြောင့် packet သည် default route (R1) ဆီ ပြန်သွားပြီး R1→R2→R1 loop ဖြစ်ကာ TTL exceeded ဖြစ်ခဲ့သည်။

**R2 Route Table (မပြင်မီ):**
```
0  As 0.0.0.0/0       10.0.12.1    1   ← default → R1
   DAc 10.0.12.0/30   ether1       0
   DAc 10.0.23.0/30   ether2       0
1  As 10.10.10.0/24   10.0.23.2    1
2  As 10.20.20.0/24   10.0.23.2    1
3  As 10.10.30.0/24   10.0.23.2    1   ← ❌ WRONG (10.10.30 မဟုတ်ဘဲ 10.30.30 ဖြစ်ရမည်)
```

**Fix — R2 Terminal:**
```routeros
/ip route remove [find dst-address=10.10.30.0/24]
/ip route add dst-address=10.30.30.0/24 gateway=10.0.23.2
```

**Result:** Kali မှ `ping 10.30.30.10` ✅ success

---

### 2026-07-08 — aegis_forwarder_hub.py — Central SSH Hub Script ✅

**Status:** ✅ Done

**Time:** 03:00–03:05

**File:** `scripts/src/aegis_forwarder_hub.py`

**What:** aegis-forwarder VM (10.30.30.10) မှ target VMs (bank-web, bank-mail, teller-pc, customer-db) အားလုံးကို SSH ဖြင့် တပြိုင်နက် ချိတ်ဆက်ပြီး log files tail လုပ်ကာ AEGIS Render API ထဲ forward လုပ်သည့် central hub script။

**Architecture:**
```
aegis-forwarder (10.30.30.10)
    ├── SSH → bank-web (10.10.10.10)
    │         ├── /var/log/suricata/eve.json
    │         ├── /var/log/fail2ban.log
    │         ├── /var/log/auth.log
    │         └── /var/log/apache2/modsec_audit.log
    ├── SSH → bank-mail (10.10.10.20)  [pending setup]
    ├── SSH → teller-pc (10.20.20.10)  [pending setup]
    └── SSH → customer-db (10.20.20.20) [pending setup]
                ↓
        Render API (HTTPS POST)
                ↓
        AEGIS Dashboard (Vercel)
```

**Config (script ၌ hardcoded):**
```python
SSH_USER = "sithu"
SSH_PASS = os.environ.get("SSH_PASS", "<set in script>")
SSH_PORT = 22
SSH_TIMEOUT = 15
```

**Download on aegis-forwarder VM:**
```bash
sudo wget -O /opt/aegis_forwarder_hub.py \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder_hub.py
```

**Note:** Original `scripts/src/aegis_forwarder.py` (per-VM local mode) ကို မထိဘဲ ထားသည်။ Hub script သည် သီးခြား new file ဖြစ်သည်။

---

### 2026-07-08 — bank-web: OpenSSH Server Install ✅

**Status:** ✅ Done

**Time:** 03:15

**VM:** bank-web (10.10.10.10)

**Problem:** aegis-forwarder မှ bank-web ကို SSH connect မရ — `Unable to connect to port 22` error ပြသည်။ `systemctl status ssh` → `Unit ssh.service could not be found` — openssh-server မသွင်းရသေးဘူး။

**Fix — bank-web Terminal:**
```bash
sudo apt install -y openssh-server
sudo systemctl start ssh
sudo systemctl enable ssh
```

**Verify:**
```bash
sudo systemctl status ssh
# ● ssh.service - OpenBSD Secure Shell server
#    Active: active (running)
```

**Result:** aegis-forwarder → `nc -zv 10.10.10.10 22` → `Connection succeeded` ✅

---

### 2026-07-08 — aegis-forwarder: Hub Script Setup + Run ✅

**Status:** ✅ Done

**Time:** 03:00–03:17

**VM:** aegis-forwarder (10.30.30.10)

**Step 1 — Dependencies install:**
```bash
pip3 install paramiko requests
```

**Step 2 — Script download:**
```bash
sudo wget -O /opt/aegis_forwarder_hub.py \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder_hub.py
```

**Step 3 — SSH password set (vim):**
```bash
vim /opt/aegis_forwarder_hub.py
# SSH_PASS line ကို /SSH_PASS ဖြင့် ရှာပြီး insert mode (i) ဖြင့် password ထည့်
# :wq ဖြင့် save
```

**Step 4 — Environment variables + run:**
```bash
export AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api"
export AEGIS_KEY="<AEGIS_INGEST_KEY>"
python3 /opt/aegis_forwarder_hub.py
```

**Output (success):**
```
AEGIS Forwarder HUB — Central Collector v1
API  : https://aegis-api-server-jp3b.onrender.com/api
VMs  : bank-web, bank-mail, teller-pc, customer-db
SSH  : user=sithu, key=no, pass=yes

[*] Registering remote VMs …
  ✓ Registered: bank-web (10.10.10.10)
  ✓ Registered: bank-mail (10.10.10.20)
  ✓ Registered: teller-pc (10.20.20.10)
  ✓ Registered: customer-db (10.20.20.20)
[SSH] Connected → bank-web (10.10.10.10)
► bank-web / suricata thread started
[TAIL] bank-web:/var/log/suricata/eve.json
[SSH] Connected → bank-web (10.10.10.10)
► bank-web / fail2ban thread started
[TAIL] bank-web:/var/log/fail2ban.log
[SSH] Connected → bank-web (10.10.10.10)
► bank-web / ssh thread started
[TAIL] bank-web:/var/log/auth.log
[SSH] Connected → bank-web (10.10.10.10)
► bank-web / http thread started
[TAIL] bank-web:/var/log/apache2/modsec_audit.log
[SKIP] bank-mail — SSH failed, skipping   ← မသေးဘဲ normal
[SKIP] teller-pc — SSH failed, skipping   ← မသေးဘဲ normal
[SKIP] customer-db — SSH failed, skipping ← မသေးဘဲ normal
[AEGIS HUB] Monitoring 4 streams across 4 VMs …
```

---

### 2026-07-08 — End-to-End Pipeline Confirmed ✅

**Status:** ✅ MILESTONE

**Time:** 03:17–03:20

**What:** AEGIS dashboard ၌ real attack events အစစ် ပထမဆုံးအကြိမ် ပေါ်ကြောင်း confirm ခဲ့သည်။

**Evidence (Dashboard — Command Center):**
| Metric | Value |
|---|---|
| Total Events | 4 |
| Critical Threats | 4 |
| Active Alerts | 4 |
| Events by Type | network_attack (100%) |

**Recent Telemetry:**
```
10.30.30.10 → ubuntu-server  [Unauthorized SSH Access]  network_attack  03:17:20
10.30.30.10 → ubuntu-server  [Unauthorized SSH Access]  network_attack  03:17:19
10.30.30.10 → ubuntu-server  [Unauthorized SSH Access]  network_attack  03:17:18
10.30.30.10 → ubuntu-server  [Unauthorized SSH Access]  network_attack  03:17:17
```

**Source:** `10.30.30.10` (aegis-forwarder) မှ bank-web ကို SSH ချိတ်တုန်း bank-web ၏ `/var/log/auth.log` ၌ SSH login events မှတ်တမ်းတင်ခဲ့ပြီး hub script မှ Render API ဆီ forward လုပ်ခဲ့သည်။

**Kali nmap scan (confirmed):**
```
Nmap scan report for 10.10.10.10
22/tcp open  ssh   OpenSSH 8.9p1 Ubuntu
80/tcp open  http  Apache httpd 2.4.52 ((Ubuntu))
```

**Full Pipeline:**
```
Kali (attacker)
    ↓ nmap / attack
bank-web (10.10.10.10)
    ↓ auth.log / suricata / fail2ban
aegis-forwarder hub (SSH tail)
    ↓ HTTPS POST
Render API (aegis-api-server-jp3b.onrender.com)
    ↓ PostgreSQL (Supabase)
AEGIS Dashboard (Vercel) ← ✅ Events confirmed LIVE
```

---

### 2026-07-08 — bank-web: Suricata Rules Update ⚡

**Status:** ⚡ In Progress

**Time:** 03:24

**VM:** bank-web (10.10.10.10)

**What:** Suricata rules update လုပ်နေသည် — `suricata-update` command ဖြင့် Emerging Threats rules 67,780 ခု load လုပ်နေသည်။

**Commands run:**
```bash
sudo suricata-update
# → Loaded 67780 rules
# → Enabled 51846 rules
# → Testing with suricata -T  ← in progress
sudo systemctl restart suricata   ← suricata-update ပြီးမှ run မည်
```

**Goal:** Suricata rules ရှိပြီးနောက် Kali nmap scan events, port scan alerts တွေ `/var/log/suricata/eve.json` ထဲ ရောက်ပြီး AEGIS dashboard ၌ Suricata-sourced events ပေါ်လာမည်။

---

## Next Steps (ကျန်ဆောင်ရွက်ရန်)

- [x] pfSense factory reset + reconfigure ✅
- [x] pfSense WebGUI accessible ✅ (`http://10.10.10.1` from bank-web)
- [x] aegis-forwarder static IP 10.30.30.10 ✅
- [x] bank-web static IP 10.10.10.10 ✅
- [x] Kali → R1 → R2 → pfSense → bank-web routing ✅ (2026-07-07)
- [x] Kali permanent static route (nmcli) ✅ (2026-07-07)
- [x] traceroute 10.10.10.10 — 4-hop path confirmed ✅ (2026-07-07 21:11)
- [ ] pfSense WebGUI: password ပြောင်း (admin/pfsense → strong password)
- [x] pfSense WebGUI: permanent WAN rule "Allow Kali" ✅ (2026-07-07 21:15)
- [x] pfSense WebGUI: permanent OPT1 rule "Allow INT outbound" ✅ (2026-07-07 21:23)
- [x] pfSense WebGUI: permanent OPT2 rule "Allow MGMT outbound" ✅ (2026-07-07 21:23)
- [ ] bank-mail static IP 10.10.10.20
- [ ] teller-pc static IP 10.20.20.10
- [ ] customer-db static IP 10.20.20.20
- [x] bank-web: Apache2 + DVWA install ✅ (2026-07-08)
- [x] bank-web: i386 architecture removal + apt cache clear (package fix) ✅ (2026-07-08)
- [x] bank-web: DVWA clone + config (db_password, permissions, apache2 restart) ✅ (2026-07-08)
- [x] bank-web: MariaDB DVWA database + user create ✅ (2026-07-08 01:29)
- [x] bank-web: DVWA Setup page → Create Database → login page confirmed ✅ (2026-07-08 01:43)
- [x] bank-web: Suricata + Fail2ban install ✅ (2026-07-08 01:50)
- [x] bank-web: Suricata interface fix (enp0s4) → active running ✅ (2026-07-08 01:54)
- [x] Kali: nmap -sV 10.10.10.10 → port 80/tcp Apache confirmed ✅ (2026-07-08 01:46)
- [x] bank-web: DVWA Security Level = Low ✅ (2026-07-08 01:47)
- [x] Render: SUPABASE_DB_URL + AEGIS_INGEST_KEY + AEGIS_ADMIN_KEY secrets set ✅
- [x] R2 routing bug fix (10.10.30.0/24 → 10.30.30.0/24) ✅ (2026-07-08 02:52)
- [x] Kali → aegis-forwarder (10.30.30.10) ping success ✅ (2026-07-08)
- [x] aegis_forwarder_hub.py — SSH hub script created + pushed to GitHub ✅ (2026-07-08)
- [x] bank-web: openssh-server install + enable ✅ (2026-07-08 03:15)
- [x] aegis-forwarder: paramiko install + hub script download + run ✅ (2026-07-08 03:17)
- [x] End-to-end test: Kali attack → auth.log → hub forwarder → AEGIS dashboard ✅ (2026-07-08 03:20)
- [ ] bank-web: suricata-update ပြီးအောင် + systemctl restart suricata ⚡ (in progress)
- [ ] Kali: nmap attack → Suricata events dashboard ပေါ်ကြောင်း confirm
- [ ] aegis-forwarder: systemd service (auto-start on boot)
- [ ] bank-mail (10.10.10.20): openssh-server + Postfix + Dovecot install
- [ ] teller-pc (10.20.20.10): static IP set + openssh-server install
- [ ] customer-db (10.20.20.20): static IP set + openssh-server + PostgreSQL install
- [ ] bank-web: Snort install (optional — Suricata covers most detection)
- [ ] bank-web: SSH_PASS or SSH key auth ပြန်စစ် — hub run တိုင်း "No authentication methods available" ဖြစ်နေ (2026-07-08 23:00 run)
- [ ] bank-mail (10.10.10.20) + teller-pc (10.20.20.10) + customer-db (10.20.20.20): openssh-server install ဆက်လုပ်ရန် (port 22 closed / timeout နေဆဲ)
- [ ] aegis-forwarder: passwordless sudo (NOPASSWD) စစ် — nmap install + tcpdump both need sudo without a tty prompt, or OS/Ports/MAC/Traffic stay empty forever
- [ ] pfSense: MGMT (10.30.30.0/24) → DMZ (10.10.10.0/24) / INT (10.20.20.0/24) traffic အတွက် firewall rule ရှိမရှိ confirm — nmap host-discovery packets ကို pfSense က block နေနိုင်

---

### 2026-07-08 23:00 — Hub Run: All Remote SSH Failed + No Traffic/OS/Ports Data ❌ → Fixed (partial)

**Status:** ❌ Failed (SSH/infra side) — ✅ Fixed (script side)

**Time:** 23:00–23:03

**VM:** aegis-forwarder (10.30.30.10), running `aegis_forwarder_hub.py`

**Symptom (from `aegis_forwarder_hub.py` console + screenshots):**
```
[WARN] SSH_PASS and SSH_KEY are both empty — will try ~/.ssh default keys
[HEARTBEAT] My IP = 10.30.30.10
[NMAP] Scanner started
[TCPDUMP] Packet capture started
[SSH] Cannot connect to bank-web (10.10.10.10): No authentication methods available
[SSH] Cannot connect to bank-mail (10.10.10.20): [Errno None] Unable to connect to port 22
[SSH] Cannot connect to teller-pc (10.20.20.10): timed out
[SSH] Cannot connect to customer-db (10.20.20.20): timed out
[ERROR] No threads started — check SSH credentials and VM connectivity.
```
Dashboard → Network Monitor showed only `10.30.30.10 (sithu)` online, with **OS: —, Open Ports: —, Traffic (Last Hr): 0 Mb/s**.

**Root causes found (code review):**
1. `SSH_PASS`/`SSH_KEY` env vars weren't exported before this run → no auth method available for bank-web (which does have `openssh-server` running).
2. `bank-mail`/`teller-pc`/`customer-db` still don't have `openssh-server` installed/reachable (expected — see Next Steps, not yet done).
3. **Real script bug**: when `threads` was empty (all 4 SSH connections failed), the script called `sys.exit(1)` — which killed the *entire process*, including the `heartbeat`, `nmap-scanner`, and `tcpdump` daemon threads that were already running and don't need SSH to any remote VM at all. This is why OS/Ports/MAC/Traffic never populated even on a run where SSH was never going to work.
4. `nmap`/`tcpdump` both shell out through `sudo`. If the SSH user doesn't have NOPASSWD sudo, both fail silently with no diagnostic (no tty available to prompt for a password in a headless script).

**Fix (pushed to `scripts/src/aegis_forwarder_hub.py`):**
- Removed the `sys.exit(1)` when no SSH threads start — heartbeat/nmap/tcpdump keep running so at minimum the hub's own host stays "online" and network discovery/traffic capture continue independently of any single VM's SSH state.
- Added a `_has_passwordless_sudo()` pre-check before the nmap install and before starting tcpdump; if sudo needs a password, it now prints an explicit fix (`echo "$USER ALL=(ALL) NOPASSWD: ALL" | sudo tee /etc/sudoers.d/aegis-hub`) instead of failing silently.

**Still needs the lab side (cannot be fixed from Replit — no access to the real VMs):**
- Re-export `SSH_PASS` (or set up an SSH key) on aegis-forwarder before re-running the hub script.
- Install/enable `openssh-server` on bank-mail, teller-pc, customer-db (same steps as bank-web, 2026-07-08 03:15 entry above).
- Confirm aegis-forwarder's SSH user has passwordless sudo, or nmap/tcpdump will keep failing quietly.
- Confirm pfSense allows MGMT (10.30.30.0/24) to reach DMZ/INT subnets — if not, nmap discovery pings never reach bank-web/bank-mail/teller-pc/customer-db even after SSH is fixed.

**Next:** Re-run `aegis_forwarder_hub.py` with `SSH_PASS` exported after the above lab-side fixes, then re-check Network Monitor for OS/Ports/MAC/Traffic.

---

### 2026-07-08 23:10 — Ready-to-Run Fix Guide: SSH Key Auth + Remaining VM Setup ⏳

**Status:** ⏳ Not Started (steps below — run on the real VMs)

**Why SSH key instead of `SSH_PASS`:** password auth intermittently produced "No authentication methods available" on bank-web (password wasn't exported that run) and password auth via env var is easy to lose across terminal sessions. A key survives reboots/re-exports and is one less thing to remember.

**Step 1 — Generate a key on aegis-forwarder (10.30.30.10), once:**
```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/aegis_hub_key
```

**Step 2 — Copy the public key to every target VM (run once per VM, needs that VM's password once):**
```bash
ssh-copy-id -i ~/.ssh/aegis_hub_key.pub sithu@10.10.10.10   # bank-web
ssh-copy-id -i ~/.ssh/aegis_hub_key.pub sithu@10.10.10.20   # bank-mail (after Step 3 below)
ssh-copy-id -i ~/.ssh/aegis_hub_key.pub sithu@10.20.20.10   # teller-pc (after Step 3 below)
ssh-copy-id -i ~/.ssh/aegis_hub_key.pub sithu@10.20.20.20   # customer-db (after Step 3 below)
```

**Step 3 — On bank-mail / teller-pc / customer-db, same recipe as bank-web (2026-07-08 03:15 entry):**
```bash
sudo apt install -y openssh-server
sudo systemctl start ssh
sudo systemctl enable ssh
# static IP must already be set per the Lab Topology table (still [ ] unchecked in Next Steps)
```

**Step 4 — Passwordless sudo on aegis-forwarder (needed for nmap install + tcpdump, see 23:00 entry):**
```bash
echo "$USER ALL=(ALL) NOPASSWD: ALL" | sudo tee /etc/sudoers.d/aegis-hub
```

**Step 5 — Run the hub with the key instead of a password:**
```bash
export AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api"
export AEGIS_KEY="<AEGIS_INGEST_KEY>"
export SSH_KEY="/home/sithu/.ssh/aegis_hub_key"
python3 /opt/aegis_forwarder_hub.py
```

**Step 6 — pfSense: confirm MGMT → DMZ/INT routing/firewall allows nmap discovery.** The existing rules ("Allow MGMT outbound", "Allow INT outbound", "Allow WAN Kali") only cover the paths already tested end-to-end (SSH to bank-web). If `nmap` from aegis-forwarder still finds 0 extra hosts after Steps 1–5, check pfSense → Firewall → Rules on the OPT2 (MGMT) interface for a rule allowing ICMP + TCP from `10.30.30.0/24` to `10.10.10.0/24` and `10.20.20.0/24`.

**Next:** Once all 4 VMs are reachable via key auth and nmap can reach them, re-check Network Monitor — OS/Ports/MAC should populate within one scan cycle (5 min) and Traffic (Last Hr) should show non-zero once tcpdump sees packets.

---

### 2026-07-10 — Session 6: Full Stack Expansion (Schema + Routes + Forwarders + UI)

**Status:** ✅ Done
**What:** Major codebase expansion — new DB tables, backend routes, forwarder scripts, frontend pages, and defense engine hardening. Three highlight boxes added to System Status, Network Monitor, and Quick Connect sections.
**How:**

*Schema changes (lib/db/src/schema/):*
- `incidents.ts` → `incidents` table (grouped attack tickets)
- `connections.ts` → `ssh_sessions`, `ftp_sessions`, `encrypted_traffic`, `http_attacks` tables
- `defense_engine.ts` → `defense_rules`, `defense_commands`, `attack_counters` tables
- `reports.ts` → `reports` table

*New backend routes (artifacts/api-server/src/routes/):*
- `/api/incidents` — Incident CRUD
- `/api/reports` — Report retrieval
- `/api/connections/ssh`, `/ftp`, `/tls`, `/tls/suspicious`, `/http-attacks` — Connection history
- `/api/firewall/rules` — Firewall rule management + bash export
- `/api/defense/commands/pending` + `/:id/done` — Defense agent queue
- `/api/stream` — Unified SSE endpoint

*New forwarder scripts (scripts/src/):*
- `aegis_forwarder_hub.py` — Multi-VM SSH aggregator + nmap scanner + tcpdump
- `pfsense_forwarder.py` — pfSense log ingest
- `defense_agent.py` — On-VM agent, polls command queue, executes iptables/ufw
- `aegis-fail2ban-action.conf` — Fail2ban → AEGIS API direct integration

*New frontend pages (artifacts/aegis-dashboard/src/pages/):*
- `incidents.tsx` / `incident-detail.tsx` — Incident management UI
- `reports.tsx` — Security reports page
- `setup.tsx` — Guided setup / forwarder onboarding (uses Render URL, not Replit)
- `architecture.tsx` — Lab topology visualizer

*UI improvements:*
- Quick Connect box (Ubuntu VM helper) on Dashboard + Network Monitor
- Device Selector global filter component (`device-selector.tsx`)
- 3 highlight status boxes: System Status summary, Network Monitor overview, Quick Connect
- Defense Center page — block/unblock IPs, rule creation, auto-defense toggle

*Auto-defense engine hardening:*
- `attack_counters` table integration — threshold-based escalation per IP
- RFC1918 whitelist (`isDefenderIp()`) preserved from Session 4
- All IPs/ports pass through `defense-sanitize.ts` before shell command construction

*Code review fixes:*
- Removed `sys.exit(1)` when SSH threads fail in hub script — heartbeat/nmap/tcpdump keep running
- Added `_has_passwordless_sudo()` pre-check with explicit error instead of silent failure
- `setup.tsx` forwarder examples use Render URL only

**Result:** All routes deployed to Render, frontend deployed to Vercel, full pipeline functional. Known data gaps: `targetHost` is a mix of real IPs and generic labels; `attack_counters` reset on Render cold start (free tier limitation).
**Next:** Push DB schema to Supabase (`pnpm --filter @workspace/db run push`), test defense agent on Ubuntu VM, verify forwarder hub SSH collection once VMs have openssh-server + key auth.

---

### 2026-07-10 01:33 — UI Fix: Remove Info Boxes + Fix Traffic Metric

**Status:** ✅ Done
**What:** Network Monitor နှင့် System Status page မှ highlight info box ၂ ခုဖြုတ်ပြီး Traffic (Last Hr) metric ၀ ပြနေသည့် ပြဿနာကိုဖြေရှင်းခဲ့သည်။
**How:**
- `system.tsx` — "SYSTEM STATUS ဆိုတာ ဘာလဲ?" explanation box ဖြုတ်ပြီ (lines 106-111)
- `network.tsx` — "QUICK CONNECT — UBUNTU VM" box ကို empty-hosts state မှ ဖြုတ်ပြီ
- `network.tsx` — Traffic (Last Hr) metric: `traffic[last].inbound` (current hour, ၀ ဖြစ်တတ်) အစား last non-zero hourly bucket ကိုရှာပြီး `events/hr` ပြနည်းသို့ ပြောင်းပြီ; real tcpdump data ရှိရင် `Mb/s` label ပြမည်
**Result:** Box ၂ ခုပေျာက်ပြီ။ Traffic metric က "1 events/hr" (Supabase event data မှ) ပြနေပြီ — forwarder VM ချိတ်ဆက်ပြီး tcpdump data ပို့လာသောအခါ Mb/s mode ကို automatic switch ဖြစ်မည်။
**Next:** ပြင်ချင်တာ နောက်တစ်ခု ဆက်ပြောပါ။

---

### 2026-07-10 01:38 — Replit Import & Secrets Setup

**Status:** ✅ Done
**What:** Imported project from GitHub to Replit for code editing. Configured all required secrets in Replit Secrets. Verified both dev workflows start cleanly.
**How:**
```bash
# Replit Secrets configured:
# SUPABASE_DB_URL — Supabase pooler URL (port 6543, aws-1-ap-southeast-2)
# AEGIS_INGEST_KEY — sensor auth key (X-AEGIS-Key header)
# AEGIS_ADMIN_KEY  — admin key (X-AEGIS-Admin-Key header)
# SESSION_SECRET   — Express session secret

# Dependencies installed:
pnpm install

# Workflows running:
pnpm --filter @workspace/aegis-dashboard run dev   # port 5000
PORT=3000 pnpm --filter @workspace/api-server run dev  # port 3000
```
**Result:** Dashboard visible at port 5000, API server running at port 3000, connected to Supabase. Command Center shows live event data.
**Next:** Run `pnpm --filter @workspace/db run push` to ensure Supabase schema is fully up to date after Session 6 schema additions.

---

---

## 2026-07-10 — Architecture & GNS3 Setup Guide Rewrite

**Session:** Replit code editor session
**What changed:**

- Created `docs/SYSTEM_ARCHITECTURE.md` — full system architecture matching GNS3 topology:
  - Complete topology diagram (Switch1 → R1 → R2 → pfSense → DMZ/INT/MGMT)
  - Network segments & IP plan (all 6 subnets, all node IPs)
  - Component roles table per VM
  - Full data flow diagram: attack → detection → forwarding → API → DB → dashboard
  - Code flow: ingest → auto-defense pipeline (evaluateEvent → sanitize → command queue)
  - API endpoint reference table (all /api/ingest/* routes)
  - Monorepo code structure map
  - SSE real-time architecture diagram
  - Required secrets table

- Created `docs/GNS3_SETUP.md` — complete GNS3-specific setup guide (replaces VirtualBox SETUP.md):
  - Node placement & cable connections matching topology photo
  - Router-1 full MikroTik CHR config (ether1/2/3, DHCP NAT, masquerade)
  - Router-2 full MikroTik CHR config (static routes to all segments)
  - pfSense initial console config (WAN/DMZ/INT/MGMT interface assignment)
  - pfSense firewall rules per zone
  - Ubuntu VM static IP via netplan (all 5 VMs)
  - Security tools install: Suricata, ModSecurity, Cowrie, Fail2ban per VM
  - aegis_forwarder_hub.py deploy on aegis-forwarder (10.10.30.10)
  - defense_agent.py deploy as systemd service
  - Kali route setup through R1
  - 4 end-to-end test procedures
  - Troubleshooting section

```bash
# Topology: GNS3 AEGIS-SecureBank (2026-07-10 02:10 photo)
# Switch1 → R1(192.168.122.2) → R2 → pfSense(WAN:10.10.0.2)
# pfSense DMZ(10.10.10.1): bank-web(.10), bank-mail(.20), teller-pc(.30)
# pfSense INT(10.10.20.1): customer-db(.20)
# pfSense MGMT(10.10.30.1): aegis-forwarder(.10)
```

**Result:** Two new docs created. Architecture fully matches GNS3 topology photo. Setup guide is GNS3-native (no VirtualBox references).

---

### 2026-07-09 — Reverted to Per-VM Agent Mode, Removed Central SSH Hub ✅
**Status:** ✅ Done
**What:** Decided against the central SSH-hub collector. Each VM (bank-web, bank-mail,
teller-pc, customer-db, aegis-forwarder) now runs its own local `aegis_forwarder.py`
instance and posts directly to the API — no SSH between VMs for log collection.
**How:**
- Deleted `scripts/src/aegis_forwarder_hub.py` (no longer used).
- Updated `docs/SYSTEM_ARCHITECTURE.md` — data-flow diagram, node table, and monorepo
  structure now describe the per-VM agent model instead of the SSH hub.
- Updated `docs/GNS3_SETUP.md` — Step 6 (SSH prerequisites for hub) replaced with a much
  smaller "passwordless sudo on aegis-forwarder" step; Step 8 now deploys
  `aegis_forwarder.py` identically on every VM instead of the hub script; troubleshooting
  and quick-reference sections updated to drop hub/SSH-user (`sithu`) references.
- Removed the "How to Connect This Device" per-host connection-guide panel from the
  Network Monitor page (`network.tsx`) at the user's request.
- `aegis_forwarder.py` (per-VM agent) itself was not touched — it already supports this
  model. `aegis-forwarder` VM still runs nmap/tcpdump locally for itself only.
**Result:** Docs and dashboard now consistently describe the same architecture: no central
hub, no cross-VM SSH, one forwarder process per VM.
**Next:** Re-verify against the live GNS3 lab once VMs are redeployed with the agent script.

---

### 2026-07-09 — Removed Old VirtualBox Docs & Cleaned Up Repo ✅
**Status:** ✅ Done
**What:** The repo still had leftover docs and the in-dashboard Setup Guide describing the
original 3-VM VirtualBox lab (Kali/Ubuntu Server/pfSense on 192.168.56.x) from before the
project moved to the 9-node GNS3 AEGIS-SecureBank topology. Removed to avoid confusion
between old and current setups, and to shrink the workspace (old screenshots).
**How:**
- Deleted `docs/SETUP.md`, `docs/testing-setup.md`, `docs/attack-defense-playbook.md`,
  `docs/system-flow.md`, `docs/aegis-flowchart.html` — all described the old VirtualBox
  3-VM lab and were superseded by `docs/GNS3_SETUP.md` / `docs/SYSTEM_ARCHITECTURE.md`.
- Rewrote the in-dashboard Setup Guide (`setup.tsx`) from the VirtualBox 3-VM content to
  the current GNS3 9-node topology (Kali, Router-1/2, pfSense, bank-web, bank-mail,
  teller-pc, customer-db, aegis-forwarder) — IPs, node table, and all example commands
  now match the real lab.
- Updated `README.md`'s Network Monitor description away from "VirtualBox lab".

### 2026-07-09 — pfSense Manual Block Made Real (Suggest vs Auto Defense) ✅
**Status:** ✅ Code done, pfSense-side agent setup pending on the real lab.
**What:** User wants two things working end-to-end: (1) when a bank VM is attacked,
the dashboard should show the attack type *and* a ready-to-use pfSense defense rule
next to the alert, which they then apply by hand in the pfSense GUI; (2) clicking
"Block IP" on the dashboard should actually push a real block to pfSense via its
REST API, not just record the block in the database.
**How:**
- `auto-defense.ts`: added `humanizePfSenseAction()` — when a defense rule's
  `actionType` is `"suggest"`, the pfSense JSON action (`block_ip`/`block_port`) is
  rendered as human-readable pfSense GUI steps + CLI equivalent and written into the
  incident's `notes` field (shown in Incident Detail → Investigation Notes). Kept the
  underlying `commandType: "pfsense_api"` JSON format unchanged for `actionType:
  "auto"` rules, so `defense_agent.py`'s existing pfSense REST API executor still works.
- Added default rule "Web Attack (SQLi/XSS/etc) → pfSense Block (Suggested)" (high+
  severity web_attack → suggest, not auto) and changed "Critical Attack → pfSense
  Block" from auto to suggest — no automated executor is assumed to be running
  against the real router unless the user sets one up.
- `seedDefaultRules()` now upserts by name instead of skipping entirely when the
  rules table is non-empty, so new default rules reach already-seeded deployments.
- `POST /defense/block` and `DELETE /defense/block/:ip` (manual block/unblock from
  the dashboard) now also queue `defense_commands` rows for both `ubuntu` (iptables)
  and `pfsense` (`pfsense_api` JSON) — `defense_agent.py --vm pfsense` polls
  `/defense/commands/pending` and calls the pfSense REST API to apply/remove the
  rule for real. If no agent is polling yet, the commands just sit as "pending"
  and don't break anything.
**Still needed on the real lab (not yet done by user):**
- Install the community "pfsense-api" package on pfSense (System > Package Manager).
- Run `defense_agent.py --vm pfsense` on pfSense (or a box that can reach its API)
  with `PFSENSE_API_URL` / `PFSENSE_API_KEY` env vars set. No pfSense credentials
  are stored in the dashboard itself — only the agent process holds them.
- Removed old screenshot attachments from `attached_assets/` (untracked workspace files,
  not referenced anywhere in code).
- Kept `docs/API.md`, `docs/attack-testing-guide.md`, `docs/defense-testing-guide.md` —
  their example IPs are illustrative only, not tied to the old topology, so left as-is.
**Result:** No doc or in-app page still describes the retired VirtualBox lab; everything
now points at the GNS3 AEGIS-SecureBank architecture. Verified nothing in code referenced
the deleted files before removing them.

---

### 2026-07-09 (cont.) — Diagnosed DNS Resolution Failure on aegis-forwarder ⚠️
**Status:** ⚠️ Diagnosed, fix pending user action on the real VM
**What:** User reported the forwarder script erroring on `aegis-forwarder` (10.30.30.10) and
the dashboard showing that device going OFFLINE. Screenshots showed:
`HTTPSConnectionPool(...): Failed to establish a new connection: [Errno -3] Temporary
failure in name resolution` for every sensor (Suricata, Snort, Cowrie, Fail2ban).
**Diagnosis:** This is a DNS resolution failure on the VM itself, not an app/dashboard bug —
the forwarder can't even look up `aegis-api-server-jp3b.onrender.com`, so nothing it collects
ever reaches the API. Dashboard "OFFLINE" is the correct/expected result of a missed
heartbeat, not a dashboard defect. Also confirmed via screenshot that only `aegis-forwarder`
is registered as a connected host so far — no attack events have reached the dashboard yet
because bank-web/bank-mail/teller-pc/customer-db forwarders are not confirmed running,
and the one forwarder that is running (aegis-forwarder) can't reach the internet by name.
**Next:** User to run `ping 8.8.8.8` vs `ping google.com` on the VM to isolate DNS-vs-routing,
then either fix netplan nameservers or check Router-1 DHCP / pfSense outbound rule. Added a
troubleshooting entry to `docs/GNS3_SETUP.md` ("Forwarder can't reach the API at all") so this
is documented for next time.

---

### 2026-07-14 — Remote Mode: aegis-forwarder Hub SSHes into Bank VMs ✅
**Status:** ✅ Done
**What:** Previous architecture had one `aegis_forwarder.py` per VM. Switched to hub model:
`aegis-forwarder` (10.30.30.10) runs a single forwarder process that SSHes into each bank VM
and tails their Suricata/Snort logs remotely. This avoids deploying the script on every VM.
Also fixed internet access on aegis-forwarder so it can reach the Render API, and confirmed
pfSense GUI accessible via `w3m` from the forwarder VM.
**How:**
- Added `--mode remote` flag to `aegis_forwarder.py`: spawns one SSH+tail thread per remote
  VM (bank-web, bank-mail, teller-pc, customer-db) instead of reading local log files.
- Generated SSH key on aegis-forwarder (`ssh-keygen`), copied public key to all four bank VMs
  (`ssh-copy-id sithu@<ip>`) — passwordless SSH now works from the hub.
- Confirmed static IPs for teller-pc (10.20.20.10) and customer-db (10.20.20.20).
- Verified pfSense network map reflects current topology.
- pfSense GUI reachable via `w3m http://10.30.30.1` from aegis-forwarder.
- Used `--no-defense` flag so defense agent thread doesn't start on the hub
  (defense agents run locally on each bank VM, not via SSH).
**Result:** Ran `python3 aegis_forwarder.py --mode remote --no-defense` on aegis-forwarder.
All threads started:
```
[bank-web]   suricata thread started
[bank-web]   snort thread started
[bank-mail]  suricata thread started
[teller-pc]  suricata thread started
[customer-db] suricata thread started
[SSH] Connected → sithu@10.10.10.10:/var/log/suricata/eve.json
```
SSH key access confirmed for all 4 VMs:
- bank-web     (10.10.10.10) ✅
- bank-mail    (10.10.10.20) ✅
- teller-pc    (10.20.20.10) ✅
- customer-db  (10.20.20.20) ✅
**Next:** Install Suricata/Snort on each bank VM if not already running; verify events appear
in the AEGIS dashboard Security Events page once the Render API server is up.

---

### 2026-07-14 (Session 2) — Live Attack Testing: Kali → bank-web via GNS3

**Status:** 🔄 In Progress (events pipeline established; Suricata rules pending)

---

#### ① Auto-Defense Engine ရှင်းလင်းချက်

**ပြဿနာ:** Dashboard မှာ auto-block event တွေ ပေါ်နေသည် — `--no-defense` flag နဲ့ run နေပေမဲ့။

**Root Cause:**
- `--no-defense` = forwarder ပေါ်မှာ `defense_agent_loop` thread မ start ဘူး → iptables command မ execute ဘူး
- ဒါပေမဲ့ **API server (Render) ထဲမှာ auto-defense engine သီးခြား run နေတယ်** — event တိုင်း `evaluateEvent()` ကို server side က ခေါ်နေတယ်
- `app-settings.ts` မှာ `autoDefenseEnabled` DB setting က `null` ဆိုရင် default = `true` ဖြင့် treat လုပ်တာကြောင့် rule တွေ trigger ဖြစ်ပြီး `defense_commands` + `blocked_ips` table မှာ record တွေ ထည့်နေတာ
- Command status = `"pending"` ဖြင့် ကျန်နေတာ (forwarder က execute မလုပ်ဘဲ)

**Fix (committed):** `artifacts/api-server/src/lib/app-settings.ts`
```typescript
// Before: default true (auto-blocks even without dashboard toggle)
return v === null ? true : v === "true";

// After: default false (must explicitly enable from dashboard)
return v === "true";
```

**Auto-block အလုပ်လုပ်ဖို့ လိုအပ်တာ:**
| Component | လိုအပ်တဲ့ action |
|---|---|
| Server-side rules | Dashboard → Settings → Auto Defense → ON |
| VM-side executor | `--no-defense` မပါဘဲ forwarder run |
| `AEGIS_ADMIN_KEY` | `aegis_forwarder.local.conf` မှာ set ထားရမည် |

---

#### ② Forwarder Command Error Fix

**ပြဿနာ:** `python3 aegis_forwarder.py --mode --no-defense` → `error: expected one argument`

**Fix:** `--mode` နောက် value (remote) ထည့်ရမည်:
```bash
# မှားတာ
python3 aegis_forwarder.py --mode --no-defense

# မှန်တာ
python3 aegis_forwarder.py --mode remote --no-defense
```

---

#### ③ Forwarder Remote Mode — Successfully Started

**Command:**
```bash
export AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api"
export AEGIS_KEY="<ingest_key>"
python3 /opt/aegis_forwarder.py --mode remote --no-defense
```

**Result — All 4 bank VMs connected:**
```
[*] Collecting sysinfo from bank-web (10.10.10.10)...
  ✓ bank-web   OS=Ubuntu 22.04.5 LTS  MAC=0c:a6:61:e9:00:00  Ports=22,53,80,631
[*] Collecting sysinfo from bank-mail (10.10.10.20)...
  ✓ bank-mail  OS=Ubuntu 22.04.5 LTS  MAC=0c:3f:fe:e5:00:00  Ports=22,53,631
[*] Collecting sysinfo from teller-pc (10.20.20.10)...
  ✓ teller-pc  OS=Ubuntu 22.04.5 LTS  MAC=0c:91:6c:0f:00:00  Ports=22,53,631
[*] Collecting sysinfo from customer-db (10.20.20.20)...
  ✓ customer-db OS=Ubuntu 22.04.5 LTS MAC=0c:cc:8d:d6:00:00  Ports=22,53,631

► remote heartbeat thread started
► remote service health thread started

[bank-web] suricata thread started
[bank-web] snort thread started
[bank-web] fail2ban thread started
[SSH] Connected → sithu@10.10.10.10:/var/log/suricata/eve.json
[SSH] Connected → sithu@10.10.10.10:/var/log/snort/alert
[SSH] Connected → sithu@10.10.10.10:/var/log/fail2ban.log
[bank-mail] suricata thread started  ...
[teller-pc] suricata thread started  ...
[customer-db] suricata thread started ...
```

**Service Health (30s interval SSH checks):**
| VM | Suricata | Snort | Fail2ban | Cowrie |
|---|---|---|---|---|
| bank-web (10.10.10.10) | ✅ ONLINE | ❌ OFFLINE | ❌ OFFLINE | ❌ OFFLINE |
| bank-mail (10.10.10.20) | ❌ | ❌ | ❌ | ❌ |
| teller-pc (10.20.20.10) | ❌ | ❌ | ❌ | ❌ |
| customer-db (10.20.20.20) | ❌ | ❌ | ❌ | ❌ |

→ bank-web ပေါ်မှာ Suricata တစ်ခုတည်းသာ run နေသည်

---

#### ④ Kali Route ပြဿနာ

**ပြဿနာ:** Kali မှာ `10.0.0.0/8` ဆီ route မရှိ → bank VMs ဆီ reach မဖြစ်ဘူး

**Kali interfaces:**
```
eth0: 192.168.122.132/24  UP    ← R1 ဆီ connected
eth1: NO CARRIER          DOWN  ← GNS3 link မချိတ်ထားဘဲ (lab topology design)
```

**R1 route print (confirmed correct):**
```
0  As  0.0.0.0/0      gateway=192.168.122.1  (NAT/internet)
1  As  10.0.0.0/8     gateway=10.0.12.2      (R2 ဆီ — bank VMs)
DAc 10.0.12.0/30      ether3
DAc 192.168.122.0/24  ether1
```

**Fix — Kali မှာ route ထည့်:**
```bash
sudo ip route add 10.0.0.0/8 via 192.168.122.2
```

**Persistent route (reboot ကြသေးဆိုလည်း ကျန်နေအောင်) — `/etc/network/interfaces`:**
```
auto lo
auto eth0
iface eth0 inet dhcp
    post-up ip route add 10.0.0.0/8 via 192.168.122.2
```

**Ping results after fix:**
```
ping 10.10.10.10 → ✅ 64 bytes  ttl=61  time≈163ms  (bank-web reachable)
ping 10.20.20.10 → ❌ Time to live exceeded from 10.0.12.2
```

**teller-pc / customer-db TTL exceeded cause:** R2 မှာ `10.20.20.0/24` route မရှိဘူး → routing loop ဖြစ်ပြီး TTL expire

**R2 fix (pending):**
```routeros
/ip route add dst-address=10.20.20.0/24 gateway=10.0.23.2
/ip route add dst-address=10.30.30.0/24 gateway=10.0.23.2
```

---

#### ⑤ pfSense Firewall Rules — Already Configured

pfSense WAN rules (`http://10.10.10.1/firewall_rules.php`) မှာ ရှိနေပြီ:

| Rule | Protocol | Source | Destination | Description |
|---|---|---|---|---|
| ✅ PASS | IPv4 Any | 192.168.122.0/24 | Any | Allow Kali |
| ✅ PASS | IPv4 ICMP | 192.168.122.0/24 | Any | Passed via EasyRule |
| ✅ PASS | IPv4 Any | 192.168.122.0/24 | Any | Passed via EasyRule |

States: `6/168 KiB` — traffic ဖြတ်သွားနေပြီ confirm ✅

→ pfSense ကပဲ block တာ မဟုတ်ဘူး။

---

#### ⑥ bank-web Firewall — UFW + iptables

**UFW:** `sudo ufw status` → `Status: inactive` (disable မလုပ်ခင်ကတည်းက)

**iptables:** Default rules ရှိနေ → nmap scan ကို silently DROP

```
nmap -Pn -sS 10.10.10.10 → All 1000 filtered tcp ports (no-response), 201s
```

**Fix:**
```bash
sudo iptables -F          # flush all rules
sudo iptables -P INPUT ACCEPT
```

**After fix:**
```
nmap -Pn -sS 10.10.10.10
→ Host is up (0.012s latency)
→ 22/tcp open  ssh
→ 80/tcp open  http
→ Scanned in 11.36 seconds ✅
```

→ Kali → bank-web packet flow confirmed working end-to-end ✅

---

#### ⑦ Suricata Rules — suricata-update Failed

**ပြဿနာ:** bank-web မှာ Suricata rules မရှိ → nmap scan / attacks ကို alert မထွက်ဘူး

**Attempted fix:**
```bash
sudo suricata-update
# 68% ဆိုတဲ့ နေရာမှာ timeout
# <Error> Failed to copy file: The read operation timed out
```

**Cause:** VM internet connection ဟာ emerging threats rules file (38MB) download ဖို့ bandwidth မရောက်ဘူး

**Alternative fix (pending — Kali ကနေ download + scp):**
```bash
# Kali မှာ
wget https://rules.emergingthreats.net/open/suricata-6.0.4/emerging.rules.tar.gz -P /tmp/
scp /tmp/emerging.rules.tar.gz sithu@10.10.10.10:/tmp/

# bank-web မှာ
cd /tmp && sudo tar xzf emerging.rules.tar.gz
sudo cp /tmp/rules/*.rules /etc/suricata/rules/
sudo systemctl restart suricata
```

**Workaround:** Suricata rules မရသေးဘဲ auth.log ကနေ SSH events ဝင်နိုင်တဲ့ route ကို ဦးစားပေး

---

#### ⑧ Remote auth.log Watching — Missing Feature Found & Fixed

**Root Cause တွေ့:** `run_remote_mode()` မှာ ဤ log တွေသာ tail လုပ်သည်:
```
✅ /var/log/suricata/eve.json
✅ /var/log/snort/alert
✅ /var/log/fail2ban.log
❌ /var/log/auth.log   ← SSH failed login တွေ ဒီမှာ — မကြည့်ဘူး!
```

hydra SSH brute force လုပ်ရင် bank-web ရဲ့ `auth.log` မှာ `Failed password` entry တွေ ထွက်မည် — ဒါပေမဲ့ forwarder က မမြင်ဘဲ dashboard event မဝင်ဘူး

**Fix — `_watch_remote_ssh()` function အသစ် ထည့် (committed):**

```python
def _watch_remote_ssh(host_name: str, host_ip: str):
    """Tail auth.log on a remote VM via SSH and forward failed/success login events."""
    _defender_ips = {h["ip"] for h in REMOTE_HOSTS} | {"10.30.30.10"}
    fail_counts: dict[str, int] = {}
    print(f"[{host_name}] ssh thread started")
    for line in _ssh_tail(host_name, host_ip, "/var/log/auth.log"):
        m_fail = SSH_FAIL_RE.search(line)
        if m_fail:
            user, ip = m_fail.group(1), m_fail.group(2)
            if ip in _defender_ips:
                continue   # hub ရဲ့ management SSH skip
            fail_counts[ip] = fail_counts.get(ip, 0) + 1
            post("ssh", {
                "src_ip":    ip,
                "username":  user,
                "status":    "failed",
                "failures":  fail_counts[ip],
                "targetHost": host_ip,
            })
```

`run_remote_mode()` မှာ thread list ထဲ ထည့်:
```python
for label, fn in [
    ("suricata", _watch_remote_suricata),
    ("snort",    _watch_remote_snort),
    ("fail2ban", _watch_remote_fail2ban),
    ("ssh",      _watch_remote_ssh),    # ← NEW
]:
```

**Commit:** `feat: add remote auth.log SSH watcher — forward SSH brute force events from bank VMs`

---

#### ⑨ Forwarder Update & Restart (VM မှာ)

GitHub push ပြီးတိုင်း VM မှာ ဒါ run ပြီး update ဆွဲ:
```bash
wget -O /opt/aegis_forwarder.py \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py

python3 /opt/aegis_forwarder.py --mode remote --no-defense
```

---

#### ⑩ Hydra SSH Brute Force Test

**ပြဿနာများ တစ်ဆင့်ချင်း:**

| အဆင့် | Error | Fix |
|---|---|---|
| `--mode --no-defense` | `expected one argument` | `--mode remote --no-defense` |
| `rockyou.txt` မရှိ | `File not found` | `sudo gunzip rockyou.txt.gz` |
| `rockyou.txt.gz` မရှိ | `File not found` | mini wordlist create |
| `printf > /tmp/p.txt` | redirect မဝင် | `-p password` တိုက်ရိုက် |
| `-p password` | `1 login try, 0 found` | success — auth.log entry ထွက်ပြီ |

**Working command (single password test):**
```bash
hydra -l root -p password ssh://10.10.10.10
# → [DATA] attacking ssh://10.10.10.10:22/
# → 1 of 1 target completed, 0 valid password found
# → auth.log entry generated on bank-web ✅
```

**Event flow (after forwarder update):**
```
Kali hydra → bank-web SSH port 22 → auth.log fail entry
    → aegis-forwarder SSH tail /var/log/auth.log
    → _watch_remote_ssh() detects "Failed password"
    → post("ssh", {...}) → Render API /ingest/ssh
    → dashboard Security Events page
```

---

#### ⑪ Code Changes Summary (2026-07-14 Session 2)

| File | Change | Commit |
|---|---|---|
| `scripts/src/aegis_forwarder.py` | Skip local `service_health_loop` in remote mode | `fix: remote mode heartbeat/defender IP/service health` |
| `scripts/src/aegis_forwarder.py` | Add `_watch_remote_ssh()` + auth.log thread | `feat: add remote auth.log SSH watcher` |
| `artifacts/api-server/src/lib/app-settings.ts` | Auto-defense default → `false` | `fix: auto-defense default OFF` |

---

#### ⑫ Pending Items

| Item | Status | Next Step |
|---|---|---|
| Suricata rules on bank-web | ❌ Pending | Kali ကနေ download → scp |
| R2 route to 10.20.20.0/24 | ❌ Pending | R2 MikroTik console မှာ route add |
| bank-mail / teller-pc / customer-db services | ❌ All OFFLINE | `sudo systemctl start suricata fail2ban` |
| Dashboard events from real attacks | 🔄 Partial | forwarder update + hydra rerun |
| Auto-defense live test | 🔄 Pending | Dashboard toggle ON + attack |

---

## References

- GNS3 docs: https://docs.gns3.com
- MikroTik CHR: https://mikrotik.com/download (RouterOS → Cloud Hosted Router)
- pfSense Suricata pkg: System → Package Manager in pfSense WebGUI
- DVWA: https://github.com/digininja/DVWA
- Cowrie honeypot: https://github.com/cowrie/cowrie
- AEGIS API endpoints: `lib/api-spec/openapi.yaml`
- AEGIS forwarder: `scripts/src/aegis_forwarder.py`

---

### [2026-07-16] — Topology Simplification (R2, bank-mail, teller-pc ဖြုတ်)

**Status:** ✅ Done  
**What:** Router 2 ဖြုတ်ပြီး R1 ကနေ pfSense ကို တိုက်ရိုက်ချိတ်၊ bank-mail နဲ့ teller-pc nodes ဖြုတ်  
**How:**  
- R1 ether3 IP: `10.0.12.1/30` → `10.0.23.1/30` (pfSense WAN subnet နဲ့ ညှိ)  
- R1 route: `10.0.0.0/8 via 10.0.12.2` → `10.0.0.0/8 via 10.0.23.2` (R2 ကနေ pfSense ကို တိုက်ရိုက်)  
- Kali route: `sudo ip route add 10.0.0.0/8 via 192.168.122.2`  
**Result:**  
- pfSense ↔ R1 ping ✅ (1ms)  
- pfSense → 8.8.8.8 internet ✅ (~30ms)  
- Kali → bank-web (10.10.10.10) ✅ 0% loss  
- Kali → customer-db (10.20.20.20) ✅ 0% loss  
- Kali → aegis-forwarder (10.30.30.10) ✅ 0% loss  
**Next:** Kali route add ကို persistent ထားဖို့ (reboot ဆို ပျောက်သွားနိုင်)

---

### [2026-07-16] — Settings Page + Auto-Report Scheduler + Telegram Integration

**Status:** ✅ Done  
**What:** Dashboard မှာ admin က auto-report interval ပြောင်းနိုင်သော Settings page တည်ဆောက်ခဲ့သည်  
**How:**  
- `artifacts/api-server/src/lib/telegram.ts` — Telegram bot client (sendMessage, testConnection)  
- `artifacts/api-server/src/lib/scheduler.ts` — Auto-report scheduler (interval DB မှ ဖတ်, restart မလိုဘဲ ချက်ချင်း update)  
- `artifacts/api-server/src/routes/settings.ts` — GET /settings, POST /settings/report-interval, /settings/telegram, /settings/test-telegram, /settings/send-report-now  
- `artifacts/aegis-dashboard/src/pages/settings.tsx` — Full Settings UI  
- `artifacts/aegis-dashboard/src/components/layout.tsx` — Settings nav item ထည့်  
- `artifacts/aegis-dashboard/src/App.tsx` — /settings route ထည့်  
**Result:**  
- Preset buttons: 1min / 5min / 30min / 1hr / 6hr / 24hr  
- Custom interval input + Apply (server restart မလိုဘဲ ချက်ချင်း သက်ရောက်)  
- Generate & Send Now button  
- Telegram status + Test Connection + instructions  
- Groq AI status + fix instructions (Render env var)  
**Important:**  
- GROQ_API_KEY သည် **Render** (API server) မှာ ထည့်ရမည် — Vercel (frontend) မဟုတ်  
- TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID လည်း **Render** မှာ ထည့်ရမည်  
**Next:** Render Environment Variables မှာ GROQ_API_KEY ထည့်ပြီး Redeploy လုပ်ပါ

---

### [2026-07-16] — pfSense Auto-Defense + Defense Agent Setup

**Status:** 🔄 In Progress  
**What:** pfSense rules ကို suggest mode မှ auto mode ပြောင်း၊ defense_agent.py setup files ပြင်ဆင်  
**How:**  
- `auto-defense.ts` — pfSense rules 2 ခု `actionType: "suggest"` → `"auto"` (PFSENSE_API_KEY ရှိပြီဆိုတော့)  
- `auto-defense.ts` — OBSOLETE_RULE_NAMES ထဲ ဟောင်းတဲ့ suggest pfSense rules ထည့် (re-seed auto versions)  
- `scripts/src/defense_agent.local.conf.example` — Ubuntu + pfSense setup instructions update  
- `scripts/ubuntu-defense-agent-setup.sh` — Ubuntu VM quick setup script  
- `scripts/pfsense-defense-agent-setup.sh` — pfSense quick setup script  
**Result:**  
- pfSense rules: "Critical Attack → pfSense Block" + "Web Attack → pfSense Block" → **auto** (persistent firewall rule via REST API)  
- MITM/ARP Spoof rule → suggest/incident only (manual review)  
- Ubuntu rules (SSH brute, DDoS, Web Attack, Port Scan) → auto iptables  
- FTP brute + Honeypot + Mail rules → deleted (OBSOLETE)  
**Next:**  
- Ubuntu VM မှာ: `sudo python3 scripts/src/defense_agent.py --vm ubuntu` run  
- pfSense မှာ: PFSENSE_API_KEY set ပြီး `python3 scripts/src/defense_agent.py --vm pfsense` run  
- Render environment မှာ secrets verify  

---

### [2026-07-16] — IP→Device Name Display + Forwarder targetHost Fix

**Status:** ✅ Done  
**What:** Dashboard မှာ raw IP တွေကို device name (bank-web, customer-db, Kali) နဲ့ ပြပေးတဲ့ feature ထည့်  
**How:**  
- `artifacts/aegis-dashboard/src/lib/host-utils.tsx` — `HostLabel` component + `resolveHostLabel()` utility  
  - Priority: live network_hosts DB → static lab IP map → raw value  
  - Color coding: defender=green, attacker=red, infra=purple  
  - Static map: 10.10.10.10→bank-web, 10.20.20.20→customer-db, 10.30.30.10→aegis-forwarder, 192.168.122.132→Kali  
- `pages/events.tsx` — sourceIp + targetHost columns → HostLabel  
- `pages/connections.tsx` — Ip component → HostLabel  
- `pages/defense.tsx` — blocked IPs + defense action targetIp → HostLabel  
- `scripts/src/aegis_forwarder.py` — watch_ssh() + watch_fail2ban() → added `dest_ip`/`target_ip` = local VM IP  
  (so SSH/Fail2ban events know which VM was attacked)  
**Result:**  
- 10.10.10.10 → "bank-web" (green), 10.20.20.20 → "customer-db" (green)  
- Kali 192.168.122.132 → "Kali (attacker)" (red)  
- showIp=true on hover shows raw IP  
**Next:** Run `aegis_forwarder.py` on aegis-forwarder VM to register hosts in network_hosts table

---

### [2026-07-17] — Hub Mode: Single Script Covers All VMs

**Status:** ✅ Done  
**What:** `aegis_forwarder.py` ကို hub mode (`--mode hub`) ထည့်ပြီး AEGIS VM တစ်ခုထဲကနေ bank-web, customer-db, pfSense အကုန်လုပ်ဖြစ်အောင် လုပ်  
**How:**  
- **New sensor threads (remote):**  
  - `_watch_remote_modsecurity()` — bank-web `/var/log/apache2/modsec_audit.log` SSH tail → SQLi/XSS/LFI/RFI events  
  - `_watch_remote_ftp()` — bank-web `/var/log/vsftpd.log` SSH tail → FTP session events  
  - `_watch_remote_postgresql()` — customer-db `/var/log/postgresql/*.log` SSH tail → auth failures + SQL anomalies  
- **Per-host sensor config** in `REMOTE_HOSTS`:  
  - bank-web: `[suricata, snort, fail2ban, ssh, http, ftp]`  
  - customer-db: `[suricata, fail2ban, ssh, postgresql]`  
- **Hub defense routing** (`_dispatch_defense_hub()`):  
  - `targetVm=pfsense` → pfSense REST API (`PFSENSE_IP=10.30.30.1`)  
  - `targetVm=bank-web/customer-db` → SSH iptables into that VM  
  - `targetVm=aegis` or default → local iptables  
- **`defense_agent_loop(hub_mode=True)`** — polls for ALL VMs (`HUB_DEFENSE_VMS = [aegis, pfsense, bank-web, customer-db]`) in one loop  
- **`_exec_defense_ssh_remote()`** — SSHes into bank VM and runs `sudo iptables ...`  
- **`run_hub_mode()`** — replaces old `run_remote_mode()`, sensor-aware per host  
- Updated `aegis_forwarder.local.conf.example` with hub-mode config (PFSENSE_IP, REMOTE_SSH_USER, PFSENSE_API_KEY)  
**Result:**  
- One command on AEGIS VM covers everything: `python3 aegis_forwarder.py --mode hub`  
- bank-web web server logs → dashboard  
- customer-db database logs → dashboard  
- pfSense firewall rules → controlled from dashboard  
**Next:**  
1. SSH key setup on AEGIS VM: `ssh-copy-id sithu@10.10.10.10` + `ssh-copy-id sithu@10.20.20.20`  
2. pfSense REST API package install + API key generate  
3. Fill `aegis_forwarder.local.conf` with real keys, run `python3 aegis_forwarder.py --mode hub`

---

### [2026-07-17] — Replit Dev Environment Setup (Dependencies + Secrets)

**Status:** ✅ Done  
**What:** GitHub မှ import လုပ်ပြီးနောက် Replit dev environment ကို fully working ဖြစ်အောင် configure လုပ်ခဲ့သည်  
**How:**  
```bash
# Root workspace မှ dependencies အကုန် install
pnpm install   # 440 packages installed

# Replit Secrets (encrypted) မှာ သိမ်းထားသော env vars:
# SUPABASE_DB_URL  — Supabase pooler (aws-1-ap-southeast-2:6543)
# AEGIS_INGEST_KEY — Sensor auth key (X-AEGIS-Key header)
# AEGIS_ADMIN_KEY  — Admin key (X-AEGIS-Admin-Key header)
# GROQ_API_KEY     — Groq llama-3.3-70b AI summaries
# TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID — Alert notifications
# SESSION_SECRET   — (pre-existing)

# Workflows (both RUNNING):
# "Start application" → pnpm --filter @workspace/aegis-dashboard run dev (port 5000)
# "API Server"        → PORT=3000 pnpm --filter @workspace/api-server run dev (port 3000)
```
**Result:**  
- Dashboard UI: http://localhost:5000 ✅ — Command Center မှာ live data ပြနေသည် (15 events, 1 critical, 7 alerts)  
- API Server: http://localhost:3000 ✅ — Supabase connected, auto-report scheduler started (1440 min interval)  
- Real-time SSE (/api/stream) ✅ working  
**Notes:**  
- Replit = code editing only; production URL များ: Render (`https://aegis-api-server-jp3b.onrender.com`) + Vercel  
- Render free tier cold start ~50s — expected, not a bug  
- `pnpm --filter @workspace/db run push` — schema changes ရှိရင် Supabase ကို push ဖို့  
**Next:**  
1. Render API server ကို `SUPABASE_DB_URL`, `AEGIS_INGEST_KEY`, `AEGIS_ADMIN_KEY` secrets ထည့်ပြီး deploy လုပ်  
2. AEGIS VM (10.30.30.10) မှာ `aegis_forwarder.local.conf` ဖြည့်ပြီး `python3 aegis_forwarder.py --mode hub` run  
3. pfSense REST API package install + PFSENSE_API_KEY generate

---

### [2026-07-17] — Bug Fixes: AI Analysis, Defense Rules, System Status, Network Monitor

**Status:** ✅ Done  
**What:** Screenshot တွေမှာ တွေ့ခဲ့သော bugs 5 ခု fix လုပ်ခဲ့သည်

**① AI Event Analysis — response ကြာ + truncate ဖြစ်နေ**
**How:**
- `artifacts/api-server/src/routes/ai.ts` — `analyze-event` prompt ကို 3-4 ကြောင်းသာ output ဖြစ်အောင် ချုပ်  
- `maxTokens: 1500 → 400` (ရှည်တဲ့ response မရအောင်)  
- `SOC_SYSTEM` prompt ကို ကြာ / section များနဲ့ ဖြည့်ရေးပဲ မဟုတ်ဘဲ plain paragraph output ဖြစ်အောင် ချုပ်  
**Result:** AI က 3-4 ကြောင်းသာ ပြန်ပြော — modal မှာ text ပြတ်မသွား

**② AI Rule Suggestions — JSON parse error**
**How:**
- `recommend-rules` endpoint ၏ JSON extraction ကို ပြင်  
- Groq က ` ```json ``` ` code block ထဲ wrap တတ် → regex ကို `codeBlock[1]` extract ဦးစွာ ကြိုးစားပြီး fallback direct `{...}` match  
**Result:** JSON parse error မဖြစ်တော့

**③ Defense Rules — MITM rule ဖြုတ်**
**How:**
- `artifacts/api-server/src/lib/auto-defense.ts` — `"MITM / ARP Spoof → Incident"` ကို `OBSOLETE_RULE_NAMES` ထဲ ထည့်  
- Cowrie honeypot, bank-mail ဟာ ဖြုတ်ပြီးသားဆိုတော့ MITM dedicated sensor မရှိ → rule မလိုတော့  
- Active rules: SSH brute, DDoS, Web attack, Port scan, FTP brute, pfSense WAN blocks (6 rules) — lab ကိုက်ညီ  
**Result:** Defense Rules page မှာ လက်ရှိ lab နဲ့ မသက်ဆိုင်တဲ့ rule မကျန်တော့

**④ System Status — Suricata + Fail2ban per-host ပြဒဖို့ seed**
**How:**
- `artifacts/api-server/src/routes/system.ts` — `PER_HOST_SENSORS` array ထည့်  
- bank-web (10.10.10.10): Suricata IDS, Fail2ban → "unknown" state seed  
- customer-db (10.20.20.20): Suricata IDS, Fail2ban → "unknown" state seed  
- Forwarder run ရင် → online update; run မနေရင် "unknown" ပြ  
**Result:** System Status page မှာ forwarder မ run ခင်ကတည်းက sensor entries ပြ; SYSTEMS ONLINE 6/14 ဖြစ်ပြ

**⑤ Network Monitor — MONITORED always "ACTIVE" ဖြစ်နေ**
**How:**
- `artifacts/aegis-dashboard/src/pages/network.tsx` — `isMonitored` flag check မဟုတ်ဘဲ `lastSeen` timestamp အပေါ် မူတည်  
  - `lastSeen < 2 min` → `🟢 LIVE`  
  - `2–15 min` → `⚠️ STALE (Xm ago)`  
  - `> 15 min` → `🔴 OFFLINE`  
**Result:** Host detail panel မှာ forwarder ရပ်သွားရင် real-time status ပြ

**Lab sensor အကြံပြုချက် (user မေးထားသည်):**
lab setup (bank-web: Suricata+Fail2ban+Apache+vsftpd, customer-db: Suricata+Fail2ban+PostgreSQL) အတွက် လုံလောက်သော sensors:
- Suricata — network attack detection (port scan, DDoS, SQLi, XSS)  
- Fail2ban — brute force auto-ban (SSH, FTP, Apache)  
- ထပ်ထည့်ရင် ကောင်း: ModSecurity WAF (bank-web Apache မှာ web attack logging)

**Next:** API server ကို Render မှာ redeploy လုပ်ပြီး changes live ဖြစ် အောင် push

---

## [2026-07-17] — Complete System State Documentation (Replit Session)

**Status:** ✅ Done  
**What:** Project ကို GitHub မှ Replit import ပြီးနောက် လက်ရှိ system state အကုန်ကို မှတ်တမ်းတင်သည်  
**Purpose:** Panel/judges အတွက် + future agents အတွက် reference document

---

### ① Deployment Architecture (Current)

```
[Kali Linux — Attacker]
  IP: 192.168.122.132/24  GW: 192.168.122.2
         │
    [Switch1 (GNS3 Ethernet Switch)]
         │
    [Router-1 — MikroTik CHR 7.15.3]
      ether1: 192.168.122.2/24  ← Attacker/virbr0 side
      ether2: DISABLED           ← NAT cloud (disabled 2026-07-16)
      ether3: 10.0.23.1/30      ← pfSense WAN link (direct, R2 removed 2026-07-16)
         │
    [pfSense 2.7.2 CE]
      WAN  (em0): 10.0.23.2/30   GW: 10.0.23.1
      DMZ  (em1): 10.10.10.1/24  DHCP: 100-200
      INT  (em2): 10.20.20.1/24  DHCP: 100-200
      MGMT (em3): 10.30.30.1/24  DHCP: 100-200
         │
    ┌────┴──────────────┐────────────────────────┐
 [DMZ 10.10.10.0/24]  [INT 10.20.20.0/24]   [MGMT 10.30.30.0/24]
       │                      │                        │
  [bank-web]            [customer-db]          [aegis-forwarder]
  10.10.10.10           10.20.20.20             10.30.30.10
  Apache2, DVWA         PostgreSQL               Hub script
  vsftpd (FTP)          Suricata                 SSH → bank-web
  Suricata              Fail2ban                 SSH → customer-db
  Fail2ban                                       pfSense REST API
```

**Code hosting:** Replit (code editor only — Replit URL ကို source code ထဲ မသုံးရ)  
**API server:** Render — `https://aegis-api-server-jp3b.onrender.com` (Singapore, free tier)  
**Dashboard:** Vercel — static React build, `/api/*` → Render via vercel.json rewrites  
**Database:** Supabase PostgreSQL — pooler `aws-1-ap-southeast-2.pooler.supabase.com:6543`

---

### ② VM Inventory (2026-07-17 Current State)

| VM | OS | IP | Role | Status |
|---|---|---|---|---|
| Kali Linux | Kali | 192.168.122.132/24 | Red Team attacker | ✅ Active |
| Router-1 | MikroTik CHR 7.15.3 | ether1:192.168.122.2, ether3:10.0.23.1 | Edge router | ✅ Configured |
| pfSense | pfSense 2.7.2 CE | WAN:10.0.23.2, DMZ:10.10.10.1, INT:10.20.20.1, MGMT:10.30.30.1 | Firewall | ✅ Running |
| bank-web | Ubuntu Desktop | 10.10.10.10/24 GW:10.10.10.1 | Web/FTP server | ✅ Static IP, services running |
| customer-db | Ubuntu Desktop | 10.20.20.20/24 GW:10.20.20.1 | PostgreSQL DB | ⏳ IP set, services pending |
| aegis-forwarder | Ubuntu Desktop | 10.30.30.10/24 GW:10.30.30.1 | Hub forwarder | ⏳ Script ready, not yet running hub mode |

**Removed from topology (2026-07-16):** Router-2, bank-mail, teller-pc

---

### ③ Monorepo Structure

```
/
├── artifacts/
│   ├── aegis-dashboard/    ← React 19 + Vite + TailwindCSS v4 + shadcn/ui (port 5000)
│   └── api-server/         ← Express 5 API (port 3000 dev / 3000 Render)
├── lib/
│   ├── db/                 ← Drizzle ORM schema + Supabase client
│   ├── api-spec/           ← openapi.yaml (source of truth for API contract)
│   ├── api-client-react/   ← Generated React Query hooks (Orval)
│   └── api-zod/            ← Generated Zod schemas (Orval)
├── scripts/
│   └── src/
│       └── aegis_forwarder.py   ← Python forwarder (1528 lines)
├── render.yaml             ← Render deployment config
├── vercel.json             ← Vercel deployment config
└── pnpm-workspace.yaml     ← pnpm monorepo config
```

**Stack:** Node.js 24, TypeScript 5.9, pnpm 10  
**API build:** esbuild → `dist/index.mjs` (ESM bundle)  
**DB driver:** `postgres.js` + Drizzle ORM, SSL required, custom URL parser (lastIndexOf method for special chars in password)

---

### ④ Database Schema (Supabase PostgreSQL)

| Table | Key Columns | Purpose |
|---|---|---|
| `security_events` | id, type, subtype, severity, sourceIp, targetHost, toolUsed, description, status, layer, createdAt | All ingest events |
| `alerts` | id, message, severity, channel, acknowledged, eventId | High/critical alerts |
| `incidents` | id, title, description, severity, status, sourceIp, attackType, affectedHost | Grouped attack incidents |
| `defense_rules` | id, name, triggerAttackType, triggerSeverity, triggerThreshold, triggerWindowSecs, actionType, defenseType, actionParams, targetVm, priority, isActive | Auto-defense rules |
| `defense_commands` | id, commandType, commandText, undoCommand, targetIp, targetVm, status, errorMsg, createdAt, executedAt | Command queue (forwarder polls) |
| `blocked_ips` | id, ip, reason, blockedBy, targetHost, isActive, blockedAt, unblockedAt | IP block log |
| `defense_actions` | id, type, action, targetIp, targetHost, reason, performedBy, status, createdAt | Defense audit log |
| `network_hosts` | id, ip, mac, hostname, os, role, status, isMonitored, openPorts, lastSeen | Registered hosts |
| `system_status` | id, component, layer, status, description, metrics, hostIp, lastCheck | Sensor health |
| `app_settings` | key, value, updatedAt | Runtime settings (autoDefenseEnabled, telegramEnabled, reportInterval) |
| `ssh_sessions` | id, sourceIp, username, status, authMethod, failures, bannedBy, createdAt, endedAt | SSH session log |
| `ftp_sessions` | id, sourceIp, username, command, filePath, fileSize, status, createdAt | FTP session log |
| `encrypted_traffic` | id, sourceIp, destIp, destPort, tlsVersion, cipherSuite, sni, certIssuer, isSuspicious, reason | TLS traffic log |
| `http_attacks` | id, sourceIp, targetUrl, method, statusCode, attackType, payload, userAgent, blocked | HTTP attack log |
| `reports` | id, title, summary, severity, status, generatedBy, createdAt | AI-generated reports |

---

### ⑤ API Server — Complete Endpoint List

**Base URL (dev):** `http://localhost:3000/api`  
**Base URL (prod):** `https://aegis-api-server-jp3b.onrender.com/api`

#### Health
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/healthz` | None | Server health check |

#### Dashboard
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/dashboard/summary` | None | KPI counts (events, alerts, incidents, blocked IPs) + attack volume trend |

#### Security Events
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/events` | None | List events (filter: severity, type, sourceIp, targetHost, limit) |
| GET | `/events/recent` | None | Latest 50 events |
| GET | `/events/:id` | None | Single event detail |

#### Ingest (X-AEGIS-Key header required)
| Method | Path | Key Fields | Description |
|---|---|---|---|
| POST | `/ingest/event` | sourceIp, description, type, subtype, severity, targetHost, toolUsed, layer | Generic event |
| POST | `/ingest/snort` | priority, msg, src, dst, proto | Snort alert_fast |
| POST | `/ingest/suricata` | alert.signature, alert.severity, src_ip, dest_ip, proto | Suricata EVE JSON alert |
| POST | `/ingest/suricata/tls` | src_ip, dest_ip, tls.version, tls.sni, tls.subject | Suricata TLS events |
| POST | `/ingest/fail2ban` | ip, jail, failures, action | Fail2ban ban/unban |
| POST | `/ingest/ssh` | src_ip, dest_ip, status, username, auth_method, failures, banned_by | auth.log SSH events |
| POST | `/ingest/ftp` | src_ip, username, command, file_path, file_size, status | vsftpd/proftpd events |
| POST | `/ingest/http` | src_ip, url, method, status_code, attack_type, payload, user_agent, blocked | ModSecurity/Nginx attacks |
| POST | `/ingest/mail` | src_ip, from_addr, to_addr, subject, attack_type | SMTP/mail events |
| POST | `/ingest/ddos` | src_ip, target, protocol, packet_rate, attack_type | DDoS/flood detection |
| POST | `/ingest/dns` | src_ip, query, attack_type | DNS anomalies |
| POST | `/ingest/cowrie` | src_ip, eventid, username, password, input | Cowrie honeypot |
| POST | `/ingest/traffic` | inbound, outbound, blocked, timestamp | Traffic stats |
| POST | `/network/hosts` | ip, mac, hostname, os, role, isMonitored, openPorts | Host heartbeat/registration |

#### Incidents
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/incidents` | None | List incidents (filter: status) |
| POST | `/incidents` | None | Create incident |
| GET | `/incidents/:id` | None | Incident detail |
| PATCH | `/incidents/:id` | None | Update status/description |

#### Alerts
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/alerts` | None | List alerts |
| PATCH | `/alerts/:id/acknowledge` | None | Acknowledge alert |

#### Network
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/network/hosts` | None | List registered hosts |
| DELETE | `/network/hosts/:id` | Admin | Remove host |
| PATCH | `/network/hosts/:id/offline` | Admin | Force offline |
| GET | `/network/hosts/:ip/events` | None | Events for specific host |
| GET | `/network/traffic` | None | Traffic trend (12h) |

#### System Status
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/system/status` | None | All component statuses (stale detection: >3 min = offline) |
| POST | `/system/status` | None | Forwarder posts sensor health |

#### Defense (X-AEGIS-Admin-Key required)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/defense/status` | None | Fail2ban/Suricata active, total blocked, per-host sensors |
| GET | `/defense/blocks` | None | Active blocked IPs |
| POST | `/defense/blocks` | Admin | Manual block IP |
| DELETE | `/defense/blocks/:id` | Admin | Unblock IP |
| GET | `/defense/actions` | None | Defense audit log |
| GET | `/defense/commands/pending` | Admin | Forwarder polls for commands |
| POST | `/defense/commands/:id/done` | Admin | Forwarder marks command done |

#### Defense Rules
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/defense-rules` | None | List all rules |
| POST | `/defense-rules` | Admin | Create rule |
| PATCH | `/defense-rules/:id` | Admin | Update rule |
| DELETE | `/defense-rules/:id` | Admin | Delete rule |

#### Firewall
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/ui/firewall/rules` | None | List firewall rules |
| POST | `/ui/firewall/rules` | Admin | Add rule (iptables/pfSense) |
| DELETE | `/ui/firewall/rules/:id` | Admin | Deactivate rule |
| GET | `/ui/firewall/rules/export` | None | Export as bash script |

#### Connection Logs
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/connections/ssh` | None | SSH session history |
| GET | `/connections/ftp` | None | FTP session history |
| GET | `/connections/tls` | None | TLS traffic log |
| GET | `/connections/tls/suspicious` | None | Suspicious TLS only |
| GET | `/connections/http-attacks` | None | HTTP attack log |

#### AI Analysis (Groq llama-3.3-70b-versatile)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/ai/status` | None | Check if Groq configured |
| GET | `/ai/threat-analysis` | None | 24h threat briefing (Burmese) |
| POST | `/ai/defend` | None | IP-specific defense recommendation (body: {ip}) |
| GET | `/ai/analyze-event/:id` | None | Single event explanation (3-4 lines, concise) |
| POST | `/ai/recommend-rules` | None | AI-suggested defense rules based on attack patterns (JSON) |

#### Reports
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/reports` | None | List reports |
| POST | `/reports/generate` | None | Generate AI report |

#### Settings
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/settings` | None | Get all settings |
| POST | `/settings/report-interval` | None | Set auto-report interval (minutes) |
| POST | `/settings/telegram` | None | Toggle Telegram alerts |
| POST | `/settings/test-telegram` | None | Test Telegram bot |
| POST | `/settings/send-report-now` | None | Trigger immediate report |

#### Stream (SSE)
| Method | Path | Description |
|---|---|---|
| GET | `/stream` | Server-Sent Events — real-time push (security_event, alert, stats_update, defense_command, service_status_change) |

---

### ⑥ Auto-Defense Rules (Current Active — 2026-07-17)

| # | Rule Name | Trigger | Threshold | Window | Action | Defense | Target VM | Priority |
|---|---|---|---|---|---|---|---|---|
| 1 | SSH Brute Force → Auto Block | ssh_brute / any | 5 | 60s | auto | block_ip | ubuntu | 10 |
| 2 | DDoS → Null Route | ddos / any | 50 | 30s | auto | null_route | ubuntu | 8 |
| 3 | Web Attack (High) → Auto Block | web_attack / high | 1 | 60s | auto | block_ip | ubuntu | 15 |
| 4 | Port Scan → Auto Block | port_scan / any | 1 | 60s | auto | block_ip | ubuntu | 20 |
| 5 | Critical Attack → pfSense Block | any / critical | 1 | 60s | auto | pfsense_block | pfsense | 50 |
| 6 | Web Attack → pfSense Block | web_attack / high | 1 | 60s | auto | pfsense_block | pfsense | 45 |
| 7 | FTP Brute Force → Block | ftp_brute / any | 3 | 60s | auto | block_ip | ubuntu | 12 |
| 8 | FTP Brute → pfSense Block | ftp_brute / any | 5 | 120s | auto | pfsense_block | pfsense | 32 |

**Auto-defense default:** OFF (dashboard မှ toggle မမိချင်း မအလုပ်လုပ်)

**Obsolete rules (DB startup မှာ auto-delete):**
- Honeypot Touch → Instant Block (Cowrie removed)
- Mail Spam → Auto Block (bank-mail removed)
- MITM / ARP Spoof → Incident (dedicated MITM sensor မရှိ)
- Critical Attack → pfSense Block (suggest version → auto version re-seeded)
- Web Attack → pfSense Block (suggest version → auto version re-seeded)

---

### ⑦ System Status Components (Seeded)

**Global (hostIp = null):**
| Component | Layer | Initial Status |
|---|---|---|
| pfSense Firewall | perimeter | unknown |
| AEGIS API Server | brain | online |

**Per-host sensors (seeded as "unknown", forwarder updates to online/offline):**
| Component | Layer | Host IP | Host |
|---|---|---|---|
| Suricata IDS | sensor | 10.10.10.10 | bank-web |
| Fail2ban | sensor | 10.10.10.10 | bank-web |
| Suricata IDS | sensor | 10.20.20.20 | customer-db |
| Fail2ban | sensor | 10.20.20.20 | customer-db |

**Staleness rule:** hostIp ရှိပြီး lastCheck > 3 minutes → status = "offline" (live inference, DB မပြောင်း)

---

### ⑧ Dashboard Pages (React Frontend)

| Page | Route | Key Features |
|---|---|---|
| Command Center | `/` | KPI cards (events/threats/alerts/systems), attack volume chart, events by type chart, recent events table |
| Security Events | `/events` | Full event feed, severity filter, AI analyze button per event |
| Incidents | `/incidents` | Case management, open/closed filter, incident detail |
| Active Alerts | `/alerts` | Priority alerts, acknowledge action |
| Connection Logs | `/connections` | SSH sessions (stale detect), FTP sessions, TLS traffic, HTTP attacks |
| Network Monitor | `/network` | Host map, per-host events, LIVE/STALE/OFFLINE real-time status, delete host |
| Defense Center | `/defense` | Auto-defense toggle, block/unblock IPs, per-host Suricata/Fail2ban status, AI rule suggestions, defense action log |
| Defense Rules | `/defense-rules` | Active rules table, firewall rules, command execution history |
| System Status | `/system` | All component health cards (online/offline/warning/unknown) |
| Reports | `/reports` | AI Threat Briefing, generate report, search history |
| Architecture | `/architecture` | GNS3 lab topology diagram |
| Settings | `/settings` | Auto-report interval, Telegram toggle, test Telegram, send report now |
| Setup Guide | `/setup` | Lab configuration instructions (Burmese) |

**Device filter:** Top-right dropdown → "All Devices" or specific host → scopes all pages to that host's data  
**Real-time:** SSE via `/api/stream` — events, alerts, stats auto-push to dashboard (no polling needed for new data)

---

### ⑨ aegis_forwarder.py — Modes & Sensors

**File:** `scripts/src/aegis_forwarder.py` (1528 lines)  
**Config:** `aegis_forwarder.local.conf` (gitignored, not committed)  
**API target:** `AEGIS_URL=https://aegis-api-server-jp3b.onrender.com/api`

#### Run Modes
| Mode | Command | Covers |
|---|---|---|
| hub | `python3 aegis_forwarder.py --mode hub` | All VMs (AEGIS + bank-web + customer-db + pfSense) via SSH |
| remote | `--mode remote` | AEGIS VM only (no SSH to other VMs) |
| suricata | `--mode suricata` | Single sensor: Suricata only |
| fail2ban | `--mode fail2ban` | Single sensor: Fail2ban only |
| ssh | `--mode ssh` | Single sensor: auth.log only |
| (others) | `--mode snort/ftp/http/cowrie/postgresql` | Single sensor each |

#### Hub Mode Sensor Threads
| Thread | Source File | POST Endpoint | Host |
|---|---|---|---|
| suricata | `/var/log/suricata/eve.json` (SSH tail) | `/ingest/suricata` | bank-web |
| snort | `/var/log/snort/alert` (SSH tail) | `/ingest/snort` | bank-web |
| fail2ban | `/var/log/fail2ban.log` (SSH tail) | `/ingest/fail2ban` | bank-web |
| ssh | `/var/log/auth.log` (SSH tail) | `/ingest/ssh` | bank-web |
| http | `/var/log/apache2/modsec_audit.log` (SSH tail) | `/ingest/http` | bank-web |
| ftp | `/var/log/vsftpd.log` (SSH tail) | `/ingest/ftp` | bank-web |
| suricata | `/var/log/suricata/eve.json` (SSH tail) | `/ingest/suricata` | customer-db |
| fail2ban | `/var/log/fail2ban.log` (SSH tail) | `/ingest/fail2ban` | customer-db |
| ssh | `/var/log/auth.log` (SSH tail) | `/ingest/ssh` | customer-db |
| postgresql | `/var/log/postgresql/*.log` (SSH tail) | `/ingest/event` | customer-db |
| heartbeat | — | `/network/hosts` | aegis-forwarder |
| service_health | — | `/system/status` | all VMs |
| defense_agent | DB poll: `/defense/commands/pending` | — | all VMs |

#### Defense Routing (hub mode)
- `targetVm=pfsense` → pfSense REST API (`http://10.30.30.1/api/v1`)
- `targetVm=bank-web` → SSH into 10.10.10.10 → `sudo iptables ...`
- `targetVm=customer-db` → SSH into 10.20.20.20 → `sudo iptables ...`
- `targetVm=ubuntu` / default → local iptables on AEGIS VM

---

### ⑩ Deployment Config

**render.yaml (API Server on Render):**
```yaml
type: web
name: aegis-api-server
env: node
region: singapore
plan: free
rootDir: artifacts/api-server
buildCommand: cd ../.. && pnpm install && pnpm --filter @workspace/api-server run build
startCommand: node --enable-source-maps ./dist/index.mjs
envVars:
  PORT: 3000
  NODE_ENV: production
  AEGIS_INGEST_KEY: (sync: false — set in Render dashboard)
  AEGIS_ADMIN_KEY:  (sync: false — set in Render dashboard)
  SUPABASE_DB_URL:  (sync: false — set in Render dashboard)
```

**vercel.json (Dashboard on Vercel):**
```json
buildCommand: "pnpm --filter @workspace/aegis-dashboard run build"
outputDirectory: "artifacts/aegis-dashboard/dist/public"
rewrites: ["/api/:path*" → "https://aegis-api-server-jp3b.onrender.com/api/:path*"]
```

**Replit Dev (code editor only):**
```
Start application: pnpm --filter @workspace/aegis-dashboard run dev  → port 5000
API Server:        PORT=3000 pnpm --filter @workspace/api-server run dev → port 3000
```

---

### ⑪ Environment Variables & Secrets

**Replit Secrets (dev):**
| Secret | Purpose |
|---|---|
| SUPABASE_DB_URL | Supabase pooler URI (port 6543) |
| AEGIS_INGEST_KEY | Sensor auth (X-AEGIS-Key header) |
| AEGIS_ADMIN_KEY | Admin auth (X-AEGIS-Admin-Key header) |
| GROQ_API_KEY | Groq API (llama-3.3-70b AI analysis) |
| TELEGRAM_BOT_TOKEN | Telegram bot for alert push |
| TELEGRAM_CHAT_ID | Telegram chat/channel ID |
| SESSION_SECRET | Express session secret |

**Render (prod) — set manually in Render dashboard:**
SUPABASE_DB_URL, AEGIS_INGEST_KEY, AEGIS_ADMIN_KEY  
*(GROQ_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID — optional but recommended)*

---

### ⑫ AI Features (Groq llama-3.3-70b-versatile)

| Feature | Endpoint | Output |
|---|---|---|
| Event Analysis | GET `/ai/analyze-event/:id` | 3-4 ကြောင်း (ဘာဖြစ်သလဲ + severity + action) |
| Threat Briefing | GET `/ai/threat-analysis` | 24h attack summary + recommendations (Burmese) |
| IP Defense | POST `/ai/defend` | IP-specific defense steps + iptables commands |
| Rule Suggestions | POST `/ai/recommend-rules` | JSON defense rules based on attack patterns |

**Language:** မြန်မာ (Burmese) + English technical terms  
**Report storage:** `reports` table ၏ `summary` column (fallback template ရှိ — Groq မရှိလဲ report generate ဖြစ်)  
**Telegram alerts:** high/critical event တိုင်း → Telegram bot push (telegramEnabled setting မှ ထိန်းချုပ်)

---

### ⑬ Pending Items (2026-07-17 Current)

| Item | Status | Next Step |
|---|---|---|
| Render redeploy (code changes live) | ⏳ Pending | Render dashboard → Manual Deploy trigger |
| aegis-forwarder hub mode run | ⏳ Pending | `git pull && python3 aegis_forwarder.py --mode hub` |
| SSH key setup (AEGIS VM → bank-web, customer-db) | ⏳ Pending | `ssh-copy-id sithu@10.10.10.10` + `ssh-copy-id sithu@10.20.20.20` |
| pfSense REST API package + PFSENSE_API_KEY | ⏳ Pending | pfSense → System → Package Manager → API install |
| customer-db: Suricata + Fail2ban install | ⏳ Pending | `sudo apt install suricata fail2ban` on 10.20.20.20 |
| aegis-forwarder systemd service | ⏳ Pending | `systemctl enable aegis-forwarder` (auto-start on boot) |
| Kali route persistent (reboot) | ⏳ Pending | nmcli connection ထဲ static route ထည့် |
| bank-web: ModSecurity WAF (optional) | ⏳ Optional | Apache2 mod_security install |
| Auto-defense live test | ⏳ Pending | Dashboard toggle ON → Kali attack → block event confirm |

---

**Commit:** `fix: AI concise responses, JSON parse, defense rules cleanup, system status sensor seed, network monitor live status`  
**GitHub:** `https://github.com/sohu2723-star/aegis-soc-dashboard`  
**Branch:** main

---

### [2026-07-17] — System Status: 10.30.30.10 Sensors + Purge Bug Fix

**Status:** ✅ Done  
**Trigger:** Screenshot မှာ 10.30.30.10 (aegis-forwarder) အောက်မှာ "Morgan HTTP Logger" + "PostgreSQL Monitor" (OFFLINE) ပေါ်နေတာ မြင်ရ — ဒါတွေ wrong host မှာ ရောက်နေတဲ့ stale entries ဖြစ်တယ်

---

#### ① Bug: Fail2ban/Suricata per-host entries ချက်ချင်း delete ဖြစ်နေ

**Root cause:**  
`OBSOLETE_COMPONENTS` array ထဲမှာ `"Fail2ban"` ပါနေတယ်  
`purgeStaleRows()` က component name တူတိုင်း delete လုပ်တယ် — hostIp ကြည့်မနေဘဲ  
→ seed လုပ်ပြီးသား per-host `Fail2ban` entries တွေ startup တိုင်း ချက်ချင်း ပျောက်နေတယ်  
→ Dashboard မှာ Fail2ban မပေါ်တာ ဒါကြောင့်ဖြစ်တယ်

**Fix:**  
`purgeStaleRows()` logic ကို 3 ပိုင်း ခွဲပြင်:

| Delete Condition | Old | New |
|---|---|---|
| ALWAYS_DELETE (wrong sensors) | မရှိ | `Morgan HTTP Logger`, `PostgreSQL Monitor` → unconditionally delete |
| GLOBAL_OBSOLETE (hostIp=null) | OBSOLETE_COMPONENTS (hostIp မကြည့်) | hostIp IS NULL ဖြစ်တဲ့ rows သာ delete |
| Seeded entries protection | မရှိ | PER_HOST_SENSORS pairs → never delete (protected set) |
| Orphaned per-host rows | hostIp not in network_hosts | ကိုယ်တိုင် seed ထားတဲ့ rows ကလွဲ → delete |

---

#### ② 10.30.30.10 (aegis-forwarder) — ဘာကြောင့် sensors ထည့်ရသလဲ

**VM role:** Ubuntu Desktop — hub forwarder script (aegis_forwarder.py) run တဲ့ host  
**Network:** MGMT zone (10.30.30.0/24) — pfSense em3 interface

**Attack vector:**
```
Kali (192.168.122.132)
  → R1 (10.0.23.1)
  → pfSense WAN (10.0.23.2)
  → pfSense MGMT zone (10.30.30.0/24)
  → 10.30.30.10 port 22 (SSH)
```

Hub script က bank-web/customer-db ကို SSH ဝင်ဖို့ **port 22 ဖွင့်ထားရတယ်**  
pfSense MGMT rule မှာ WAN→MGMT Allow ပွင့်ထားရင် Kali ကနေ တိုက်ရိုက် SSH brute force ဝင်လာနိုင်တယ်  
MGMT zone ဖြစ်ပေမယ့် isolate ဆိုတာ မရှိ — routing ပွင့်ရင် reachable ဖြစ်မယ်

**ဒါကြောင့် sensors 3 ခု ထည့်:**

| Sensor | ဘာကြောင့် |
|---|---|
| Hub Forwarder | forwarder process ရပ်သွားရင် monitoring blind spot ဖြစ်မယ် — process health ကြည့်ဖို့ |
| SSH Monitor | MGMT zone ကနေ SSH brute force attack detect ဖို့ |
| Fail2ban | SSH brute force auto-ban — forwarder VM ကိုယ်တိုင် self-protect |

---

#### ③ Per-host sensor matrix (Final — 2026-07-17)

| Sensor | bank-web `10.10.10.10` | customer-db `10.20.20.20` | aegis-forwarder `10.30.30.10` |
|---|:---:|:---:|:---:|
| Suricata IDS | ✅ | ✅ | ❌ (Suricata install မရှိ) |
| Fail2ban | ✅ | ✅ | ✅ SSH ကာကွယ် |
| SSH Monitor | ✅ | ✅ | ✅ |
| FTP Monitor (vsftpd) | ✅ | ❌ | ❌ |
| Apache Monitor | ✅ | ❌ | ❌ |
| PostgreSQL Monitor | ❌ | ✅ | ❌ |
| Hub Forwarder | ❌ | ❌ | ✅ process health |

**Global (hostIp=null):**
- pfSense Firewall (perimeter)
- AEGIS API Server (brain)

**Forwarder behavior:** hub mode run ရင် POST `/system/status` → rows တွေ online/offline update ဖြစ်မယ်  
Forwarder မ run ခင် → "unknown" ပြ (seed ထားတာ)  
Stale: lastCheck > 3 min → dashboard မှာ offline ပြ (DB မပြောင်း — live inference)

**Commits:**  
- `fix: system status — correct per-host sensor seeds, fix purge logic, remove wrong sensors`  
- `feat: add aegis-forwarder (10.30.30.10) sensors — Hub Forwarder, SSH Monitor, Fail2ban`
