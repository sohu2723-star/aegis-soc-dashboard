# AEGIS-SecureBank — Project Book
> **Internship Final Project — Network Security Lab**
> **Topology Version:** v4 (Final — 2026-07-20)
> **Author:** Sithu
> **Project:** AEGIS SOC Dashboard with GNS3 Lab

---

## အခန်း 1 — Project Overview

### ဘာ Project လဲ?

AEGIS-SecureBank သည် ဘဏ်စနစ်ကို simulate လုပ်ထားသော cybersecurity lab တစ်ခုဖြစ်သည်။  
Kali Linux Attacker မှ bank services များကို attack လုပ်ရာ Suricata/Fail2ban တို့က detect လုပ်၍  
AEGIS SOC Dashboard ပေါ်တွင် real-time alert ပြသကာ auto-defense (IP block) အထိ အလိုအလျောက် လုပ်ဆောင်သည်။

### System Components

| Component | Platform | URL / IP |
|-----------|----------|----------|
| SOC Dashboard (Frontend) | Vercel | https://aegis-soc-dashboard-aegis-dashboard.vercel.app |
| API Server (Backend) | Render | https://aegis-api-server-jp3b.onrender.com |
| Database | Supabase | PostgreSQL (pooler) |
| GNS3 Lab | Local VM | 10.x.x.x network |

---

## အခန်း 2 — GNS3 Network Topology (v4 Final)

### Topology Diagram

```
                    ┌──────────────────────────────────────────────┐
                    │           INTERNET (virbr0 NAT)               │
                    │           192.168.122.0/24                    │
                    └─────────────────┬────────────────────────────┘
                                      │ (GNS3 Cloud Node)
                              ┌───────┴───────┐
                              │    Router      │  MikroTik CHR
                              │  e0: 192.168.122.2/24  ← Internet
                              │  e1: 192.168.10.1/24   ← Attacker
                              │  e2: 10.0.23.1/30      ← pfSense WAN
                              └───────┬───────┘
                         ┌────────────┘    └──────────┐
                    ┌────┴────┐                ┌──────┴──────┐
                    │ Attacker│                │   pfSense    │
                    │  Kali   │                │  e0(WAN):   │
                    │DHCP .99 │                │  10.0.23.2  │
                    └─────────┘                │  e1(DMZ):   │
                                               │  10.10.10.1 │
                                               │  e2(INT):   │
                                               │  10.20.20.1 │
                                               │  e3(MGMT):  │
                                               │  10.30.30.1 │
                                               └──┬───┬───┬──┘
                    ┌──────────────────┐          │   │   │
                    │  Public-Services │◄──────────┘   │   └────────────────┐
                    │  OVS Switch      │               │                    │
                    │  eth0←pfSense e1 │        ┌──────┴──────┐      ┌──────┴──────┐
                    │  eth1→bank-web   │        │  Internal-   │      │ aegis-ADMIN │
                    │  eth2→DNS-Server │        │  Services    │      │ 10.30.30.10 │
                    └──────┬──────┬───┘        │  OVS Switch  │      └─────────────┘
                           │      │             │  eth0←pfSense│
                    ┌──────┴──┐ ┌─┴──────────┐ │  eth1→cust-db│
                    │bank-web │ │ DNS-Server  │ │  eth2→LDAP   │
                    │10.10.10.│ │ 10.10.10.20 │ └───┬──────┬───┘
                    │   10    │ │             │     │      │
                    └─────────┘ └─────────────┘ ┌───┴──┐ ┌─┴────────┐
                                                 │cust- │ │LDAP-     │
                                                 │db    │ │Server    │
                                                 │.20.10│ │.20.20    │
                                                 └──────┘ └──────────┘
```

### IP Address Plan (v4 Final)

| Node | Interface | IP Address | Subnet | Role |
|------|-----------|------------|--------|------|
| Internet | virbr0 | 192.168.122.1 | /24 | NAT Gateway (Host) |
| Router | e0 | 192.168.122.2 | /24 | Internet side |
| Router | e1 | 192.168.10.1 | /24 | Attacker DHCP gateway |
| Router | e2 | 10.0.23.1 | /30 | pfSense WAN link |
| Attacker (Kali) | eth0 | 192.168.10.99 (DHCP) | /24 | Red Team |
| pfSense | e0 (WAN) | 10.0.23.2 | /30 | WAN |
| pfSense | e1 (DMZ) | 10.10.10.1 | /24 | Public Services gateway |
| pfSense | e2 (INT) | 10.20.20.1 | /24 | Internal Services gateway |
| pfSense | e3 (MGMT) | 10.30.30.1 | /24 | Management gateway |
| Public-Services Switch | eth0 | — | — | pfSense e1 မှ ချိတ် |
| bank-web | e0 | 10.10.10.10 | /24 | Web Server (Apache+PHP) |
| DNS-Server | e0 | 10.10.10.20 | /24 | DNS (BIND9) |
| Internal-Services Switch | eth0 | — | — | pfSense e2 မှ ချိတ် |
| customer-db | e0 | 10.20.20.10 | /24 | Database (MySQL) |
| LDAP-Server | e0 | 10.20.20.20 | /24 | Auth Server (OpenLDAP) |
| aegis-ADMIN | e0 | 10.30.30.10 | /24 | AEGIS Hub Agent |

### Network Segments

| Segment | Subnet | Purpose |
|---------|--------|---------|
| Internet | 192.168.122.0/24 | GNS3 NAT cloud (virbr0) |
| Attacker | 192.168.10.0/24 | Kali Linux attack network |
| Router↔pfSense | 10.0.23.0/30 | WAN link (point-to-point) |
| DMZ (Public) | 10.10.10.0/24 | bank-web, DNS-Server |
| Internal | 10.20.20.0/24 | customer-db, LDAP-Server |
| Management | 10.30.30.0/24 | aegis-ADMIN (SOC agent) |

---

## အခန်း 3 — Router (MikroTik CHR) Setup

### ဘာကြောင့် MikroTik CHR သုံးတာလဲ?
MikroTik CHR (Cloud Hosted Router) သည် lightweight router OS ဖြစ်ပြီး GNS3 lab တွင် real router behavior simulate လုပ်ရန် သုံးသည်။ NAT, DHCP, routing ကို အပြည့်အဝ support လုပ်သည်။

### GNS3 Console ကနေ Router Configure

```routeros
# ── Interface IP Assignment ──────────────────────────────────────
# e0 → Internet (virbr0 NAT cloud ဘက်)
/ip address add address=192.168.122.2/24 interface=ether1
# ဘာကြောင့်: Host machine ရဲ့ virbr0 (192.168.122.1) network နဲ့ connect ဖို့

# e1 → Attacker (Kali) network
/ip address add address=192.168.10.1/24 interface=ether2
# ဘာကြောင့်: Kali VM တွေကို DHCP ပေးမဲ့ gateway ဖြစ်ဖို့

# e2 → pfSense WAN (point-to-point /30)
/ip address add address=10.0.23.1/30 interface=ether3
# ဘာကြောင့်: Router နဲ့ pfSense ကြား direct link (/30 = 2 host သာ လို)

# ── Default Route ───────────────────────────────────────────────
/ip route add dst-address=0.0.0.0/0 gateway=192.168.122.1
# ဘာကြောင့်: Internet traffic အားလုံးကို host machine NAT ကတဆင့် ထုတ်ဖို့

# ── Internal Route ──────────────────────────────────────────────
/ip route add dst-address=10.0.0.0/8 gateway=10.0.23.2
# ဘာကြောင့်: 10.x.x.x network (bank services) ကို pfSense ကတဆင့် ရောက်ဖို့

# ── NAT Masquerade ──────────────────────────────────────────────
/ip firewall nat add chain=srcnat action=masquerade out-interface=ether1
# ဘာကြောင့်: Lab network (10.x.x.x, 192.168.10.x) ရဲ့ traffic ကို
#            internet ထွက်ရင် router IP နဲ့ replace လုပ်ဖို့ (NAT)

# ── Firewall Allow Forward ──────────────────────────────────────
/ip firewall filter add chain=forward action=accept place-before=0
# ဘာကြောင့်: MikroTik default က forward traffic ကို block တယ်
#            place-before=0 = list ထိပ်မှာ ထည့် (priority အမြင့်ဆုံး)

# ── DHCP Pool for Kali ──────────────────────────────────────────
/ip pool add name=kali-pool ranges=192.168.10.2-192.168.10.100
# ဘာကြောင့်: Kali VM ကို auto IP ပေးဖို့ pool သတ်မှတ်

/ip dhcp-server add name=kali-dhcp interface=ether2 address-pool=kali-pool disabled=no
/ip dhcp-server network add address=192.168.10.0/24 gateway=192.168.10.1 dns-server=8.8.8.8
# ဘာကြောင့်: ether2 (Kali ဘက်) မှာ DHCP server run ဖို့
#            dns-server=8.8.8.8 = Google DNS သတ်မှတ်

# ── Verify ──────────────────────────────────────────────────────
/ip address print          # IP တွေ မှန်မမှန် စစ်
/ip route print            # Route table ကြည့်
/ip dhcp-server print      # DHCP server status
/ping 8.8.8.8 count=4     # Internet ရောက်မရောက် test
```

### Command Flags ရှင်းလင်းချက်

| Flag/Option | အဓိပ္ပါယ် |
|-------------|---------|
| `chain=srcnat` | Source NAT — outgoing traffic မှာ source IP ပြောင်း |
| `action=masquerade` | Dynamic NAT — interface IP နဲ့ auto replace |
| `place-before=0` | Rule list ထိပ်မှာ insert (0 = first position) |
| `dst-address=0.0.0.0/0` | Default route (any destination) |
| `/30` | Point-to-point subnet — host IP 2 ခုသာ (/30 = 255.255.255.252) |

---

## အခန်း 4 — pfSense Firewall Setup

### ဘာကြောင့် pfSense သုံးတာလဲ?
pfSense သည် open-source firewall/router OS ဖြစ်ပြီး real enterprise firewall behavior ကို lab တွင် simulate လုပ်ရန် အသုံးပြုသည်။ Network segment ခွဲခြားခြင်း၊ traffic filtering၊ firewall rules များကို WebGUI မှ ထိန်းချုပ်နိုင်သည်။

### 4a. Console Interface Assignment

pfSense boot ဖြစ်ရင် console မှာ **Option 1 — Assign Interfaces** ရွေး:

```
WAN  → vtnet0  (e0)   ← Router e2 မှ WAN traffic ဝင်
DMZ  → vtnet1  (e1)   ← Public Services (bank-web, DNS)
INT  → vtnet2  (e2)   ← Internal Services (customer-db, LDAP)
MGMT → vtnet3  (e3)   ← Management (aegis-ADMIN)
```

### 4b. Console IP Assignment (Option 2)

```
Interface  IP              Gateway    DHCP Range
─────────  ──────────────  ─────────  ─────────────────
WAN        10.0.23.2/30    10.0.23.1  (none)
DMZ        10.10.10.1/24   (none)     10.10.10.100–200
INT        10.20.20.1/24   (none)     10.20.20.100–200
MGMT       10.30.30.1/24   (none)     10.30.30.100–200
```

### 4c. WebGUI Firewall Rules

WebGUI: `http://10.30.30.1` (MGMT interface မှ access)

**WAN Rules — Attacker traffic ခွင့်ပြု:**
```
Action: Pass | Interface: WAN | Source: 192.168.10.0/24 | Destination: any
```
*ဘာကြောင့်: Kali (192.168.10.x) မှ lab network ထဲ ဝင်နိုင်ဖို့*

**DMZ Rules — bank-web, DNS outbound ခွင့်ပြု + Internal ပိတ်:**
```
Action: Pass  | Interface: DMZ | Source: DMZ net | Destination: any
Action: Block | Interface: DMZ | Source: DMZ net | Destination: 10.20.20.0/24
```
*ဘာကြောင့်: bank-web က internet ရနိုင်သော်လည်း customer-db ကို တိုက်ရိုက် မဝင်နိုင်ဖို့*

**INT Rules — Internal outbound ခွင့်ပြု:**
```
Action: Pass | Interface: INT | Source: INT net | Destination: any
```
*ဘာကြောင့်: customer-db, LDAP တို့ internet ရနိုင်ဖို့ (update, etc.)*

**MGMT Rules — AEGIS agent အတွက် အကုန် ခွင့်ပြု:**
```
Action: Pass | Interface: MGMT | Source: MGMT net | Destination: any | Port: any
```
*ဘာကြောင့်: aegis-ADMIN (10.30.30.10) က bank-web, customer-db ကို SSH ဝင်နိုင်ဖို့*

### 4d. pfSense SSH Enable (AEGIS agent access အတွက်)

```
WebGUI → System → Advanced → Admin Access
→ Secure Shell Server
→ ☑ Enable Secure Shell    ← tick ပေး
→ Save
```

### 4e. pfSense SSH Key ထည့် (password မတောင်းဘဲ access ဖို့)

```
WebGUI → System → User Manager → admin → Edit
→ Authorized SSH Keys box ထဲ aegis-ADMIN ရဲ့ public key paste
→ Save
```

*AEGIS VM ကနေ public key ကြည့်ဖို့:*
```bash
cat ~/.ssh/pfsense_key.pub
```

---

## အခန်း 5 — OVS Switch (Open vSwitch) Setup

### ဘာကြောင့် Open vSwitch သုံးတာလဲ?
GNS3 ရဲ့ built-in Ethernet switch သည် VLAN feature မပါ။ Open vSwitch (OVS) သည် software-defined switch ဖြစ်ပြီး VLAN tagging, trunk port, access port တို့ကို support လုပ်သည်။

### ဘာကြောင့် VLAN ခွဲတာလဲ?
- **Security segmentation** — Public (DMZ) network မှ Internal network ကို isolate လုပ်ဖို့
- **Traffic control** — VLAN tag ပြည့်မှ switch ကတဆင့် traffic ဖြတ်သွားနိုင်
- Switch တစ်ခုတည်းသုံးပြီး VLAN ခွဲ = node နည်းသည်၊ topology ရိုးရှင်းသည်

### Public-Services Switch (bank-web + DNS)

GNS3 မှ Public-Services OVS console ဖွင့်ပြီး:

```bash
# ရှိပြီးသား port တွေ ကြည့်
ovs-vsctl show
# ဘာကြောင့်: bridge ထဲ ဘာ port တွေ ရှိနေလဲ သိဖို့ (add မလုပ်ရသောကြောင့် show ကြည့်ရသည်)

# eth0 = pfSense e1 ချိတ် — trunk port (VLAN tag မသတ်မှတ် = all VLANs ဖြတ်)
# eth1 = bank-web ချိတ် — VLAN 10 access port
ovs-vsctl set port eth1 tag=10
# ဘာကြောင့်: eth1 ကနေ ဝင်လာတဲ့ traffic ကို VLAN 10 tag တပ်ဖို့

# eth2 = DNS-Server ချိတ် — VLAN 10 access port
ovs-vsctl set port eth2 tag=10
# ဘာကြောင့်: DNS-Server လည်း Public DMZ (VLAN 10) မှာ ရှိတဲ့ အတွက်

# Verify — VLAN tag မှန်မမှန် စစ်
ovs-vsctl show
```

### Internal-Services Switch (customer-db + LDAP)

```bash
# eth0 = pfSense e2 ချိတ် — trunk
# eth1 = customer-db ချိတ် — VLAN 20 access port
ovs-vsctl set port eth1 tag=20
# ဘာကြောင့်: customer-db သည် Internal (VLAN 20) မှာ ရှိ

# eth2 = LDAP-Server ချိတ် — VLAN 20 access port
ovs-vsctl set port eth2 tag=20
# ဘာကြောင့်: LDAP-Server လည်း Internal (VLAN 20) မှာ ရှိ

# Verify
ovs-vsctl show
```

### OVS Command ရှင်းချက်

| Command | အဓိပ္ပါယ် |
|---------|---------|
| `ovs-vsctl show` | OVS bridge နဲ့ port အားလုံး ပြ |
| `ovs-vsctl set port <port> tag=<vlan>` | Port ကို access port အဖြစ် VLAN သတ်မှတ် |
| `ovs-vsctl add-port <bridge> <port>` | Port အသစ် ထည့် (GNS3 မှာ cable ချိတ်ရင် auto ရှိပြီ) |
| `tag=10` | VLAN ID 10 = Public/DMZ segment |
| `tag=20` | VLAN ID 20 = Internal segment |

### VLAN vs No-VLAN

| | Switch မပါ | Switch + VLAN |
|-|-----------|--------------|
| Segment | မရ | ရ |
| Security | အားလုံး တစ် network | DMZ/Internal ခွဲ |
| Node count | နည်း | Switch node ပါ |

---

## အခန်း 6 — Ubuntu VM Static IP Setup (Netplan)

### ဘာကြောင့် Static IP သတ်မှတ်ရတာလဲ?
Lab မှာ DHCP သုံးရင် reboot တိုင်း IP ပြောင်းသည်။ Scripts, firewall rules, SSH config တွေ IP ပေါ် depend လုပ်တဲ့ အတွက် static IP မဖြစ်မနေ လိုသည်။

### Netplan ဆိုတာဘာလဲ?
Ubuntu 18.04+ မှ network configuration management tool ဖြစ်သည်။ `/etc/netplan/` folder ထဲ YAML file ရေးပြီး `netplan apply` နှိပ်ရင် network setting အသက်ဝင်သည်။

### bank-web (10.10.10.10)

```bash
sudo nano /etc/netplan/00-installer-config.yaml
```
```yaml
network:
  version: 2
  ethernets:
    ens3:
      addresses: [10.10.10.10/24]    # Static IP သတ်မှတ်
      routes:
        - to: default
          via: 10.10.10.1             # pfSense DMZ interface = gateway
      nameservers:
        addresses: [10.10.10.20, 8.8.8.8]  # DNS-Server ပထမ၊ Google DNS backup
```
```bash
sudo netplan apply    # Setting အသက်ဝင်
ip addr show ens3     # IP မှန်မမှန် စစ်
ping 10.10.10.1       # Gateway (pfSense) reach ဖြစ်မဖြစ် test
```

### DNS-Server (10.10.10.20)

```yaml
network:
  version: 2
  ethernets:
    ens3:
      addresses: [10.10.10.20/24]
      routes:
        - to: default
          via: 10.10.10.1
      nameservers:
        addresses: [127.0.0.1, 8.8.8.8]  # ကိုယ့် DNS server ကိုယ် သုံး
```

### customer-db (10.20.20.10)

```yaml
network:
  version: 2
  ethernets:
    ens3:
      addresses: [10.20.20.10/24]
      routes:
        - to: default
          via: 10.20.20.1             # pfSense INT interface = gateway
      nameservers:
        addresses: [10.10.10.20, 8.8.8.8]
```

### LDAP-Server (10.20.20.20)

```yaml
network:
  version: 2
  ethernets:
    ens3:
      addresses: [10.20.20.20/24]
      routes:
        - to: default
          via: 10.20.20.1
      nameservers:
        addresses: [10.10.10.20, 8.8.8.8]
```

### aegis-ADMIN (10.30.30.10)

```yaml
network:
  version: 2
  ethernets:
    ens3:
      addresses: [10.30.30.10/24]
      routes:
        - to: default
          via: 10.30.30.1             # pfSense MGMT interface = gateway
      nameservers:
        addresses: [10.10.10.20, 8.8.8.8]
```

```bash
# ရိုက်ပြီးရင် apply
sudo netplan apply

# Verify
ip addr show ens3
ping 8.8.8.8            # Internet ရောက်မရောက်
ping 10.10.10.10        # bank-web reach ဖြစ်မဖြစ် (aegis-ADMIN မှ)
```

---

## အခန်း 7 — SSH Key Authentication Setup

### ဘာကြောင့် SSH Key သုံးတာလဲ?
AEGIS hub script သည် bank-web, customer-db, pfSense တွင် remote command execute လုပ်ရန် SSH ကို auto-login (password မပါဘဲ) လိုသည်။ Password-based auth သည် script တွင် password hardcode လုပ်ရသောကြောင့် insecure ဖြစ်သည်။ SSH key pair (private/public) သုံးရင် password မပါဘဲ authenticate နိုင်သည်။

### SSH Key အလုပ်လုပ်ပုံ

```
aegis-ADMIN                          bank-web
~/.ssh/aegis_id_rsa (private)        ~/.ssh/authorized_keys
~/.ssh/aegis_id_rsa.pub (public)  →  (public key ထည့်ထားသည်)
          │                                  │
          └── SSH connect ────────────────→  └── public key match → OK (password မလို)
```

### aegis-ADMIN မှာ SSH Key Generate

```bash
# Bank VMs အတွက် key
ssh-keygen -t ed25519 -f ~/.ssh/aegis_id_rsa -N ""
# -t ed25519   : Key type (modern, secure)
# -f           : Output file path
# -N ""        : Passphrase မထည့် (script အတွက် interactive prompt မဖြစ်ဖို့)

# pfSense အတွက် သပ်သပ် key (admin user ကွာတဲ့ အတွက်)
ssh-keygen -t ed25519 -f ~/.ssh/pfsense_key -N ""
```

### Bank VMs တွေထဲ Public Key ကူး

```bash
# bank-web
ssh-copy-id -i ~/.ssh/aegis_id_rsa.pub sithu@10.10.10.10
# -i : ကူးမဲ့ public key file ကို သတ်မှတ်
# ဒီ command က remote VM ရဲ့ ~/.ssh/authorized_keys ထဲ auto append လုပ်ပေးတယ်

# DNS-Server
ssh-copy-id -i ~/.ssh/aegis_id_rsa.pub sithu@10.10.10.20

# customer-db
ssh-copy-id -i ~/.ssh/aegis_id_rsa.pub sithu@10.20.20.10

# LDAP-Server
ssh-copy-id -i ~/.ssh/aegis_id_rsa.pub sithu@10.20.20.20
```

### pfSense SSH Key ထည့်နည်း
pfSense ကို ssh-copy-id မသုံးနိုင် — WebGUI မှတဆင့် ထည့်ရသည်:
```bash
cat ~/.ssh/pfsense_key.pub   # ဒီ output ကို copy
```
```
WebGUI → System → User Manager → admin → Edit
→ Authorized SSH Keys → paste → Save
```

### Known Hosts ပြဿနာ ဖြေရှင်းနည်း

VM ကို reinstall/recreate လုပ်ရင် SSH host key ပြောင်းသွားသည် — warning ပေါ်လာသည်:
```
WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!
```
```bash
# ဟောင်းတဲ့ key ဖြုတ်
ssh-keygen -f "/home/sithu/.ssh/known_hosts" -R "10.10.10.10"
# -f : known_hosts file path
# -R : Remove (ဖြုတ်) လုပ်မဲ့ host IP
```

### SSH Test Commands

```bash
# Key auth အလုပ်လုပ်မလုပ် test
ssh -i ~/.ssh/aegis_id_rsa -o BatchMode=yes sithu@10.10.10.10 echo "OK"
# -i          : သုံးမဲ့ private key file
# -o BatchMode=yes : password prompt မပေါ်ဖို့ (non-interactive)
# echo "OK"   : remote မှာ run မဲ့ command — "OK" ပြရင် key auth အလုပ်လုပ်ပြီ

# Verbose mode — ဘာ error ဆိုတာ detail ကြည့်
ssh -v -i ~/.ssh/aegis_id_rsa sithu@10.10.10.10
# -v : verbose (detail log ပြ) — debug အတွက်

# Port စစ် (SSH service running လား)
nc -zv 10.10.10.10 22
# -z : zero I/O mode (scan only, data မပို့)
# -v : verbose output
```

### SSH Service ပြဿနာ ဖြေရှင်းနည်း

```bash
# SSH service မ run ရင်
sudo systemctl start ssh
sudo systemctl enable ssh    # Reboot ရင် auto start
sudo systemctl status ssh    # Status ကြည့်

# sshd_config ပြင် (PubkeyAuthentication # ပိတ်ထားရင်)
sudo sed -i 's/#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config
sudo systemctl restart ssh

# ufw firewall port 22 ပိတ်ထားရင်
sudo ufw allow 22/tcp
sudo ufw reload
# (သို့) test အတွက် ufw disable
sudo ufw disable
```

---

## အခန်း 8 — Bank Services Setup

### 8a. bank-web (10.10.10.10) — Apache + PHP + MySQL Client

#### ဘာ services တွေ ထားတာလဲ?
- **Apache2** — Web server (HTTP port 80)
- **PHP + php-mysqli** — Bank web app (login, dashboard, transfer)
- **ModSecurity WAF** — SQL injection, XSS attack detection
- **Suricata IDS** — Network traffic analysis
- **Fail2ban** — Brute force protection

```bash
sudo apt update

# Web server + PHP
sudo apt install apache2 php php-mysqli libapache2-mod-php -y
# apache2      : HTTP web server
# php          : PHP interpreter
# php-mysqli   : PHP MySQL extension (db.php မှာ mysqli သုံးတဲ့ အတွက်)
# libapache2-mod-php : Apache မှ PHP files process လုပ်ဖို့

# ModSecurity WAF
sudo apt install libapache2-mod-security2 -y
sudo a2enmod security2
# a2enmod : Apache module enable လုပ်
sudo cp /etc/modsecurity/modsecurity.conf-recommended /etc/modsecurity/modsecurity.conf
sudo sed -i 's/SecRuleEngine DetectionOnly/SecRuleEngine On/' /etc/modsecurity/modsecurity.conf
# DetectionOnly → On : WAF ကို blocking mode သို့ ပြောင်း

# Suricata IDS
sudo add-apt-repository ppa:oisf/suricata-stable -y
sudo apt install suricata -y
sudo suricata-update    # Rules update
sudo suricata -c /etc/suricata/suricata.yaml -i ens3 -D
# -c : config file
# -i ens3 : monitor မဲ့ interface
# -D : daemon mode (background run)

# Fail2ban
sudo apt install fail2ban -y
sudo systemctl enable --now fail2ban

# Apache restart
sudo systemctl restart apache2
sudo systemctl enable apache2
```

#### Web App Deploy

```bash
# GitHub မှ files ဆွဲ
sudo wget -O /tmp/bank-web.zip \
  https://github.com/sohu2723-star/aegis-soc-dashboard/archive/main.zip
sudo apt install unzip -y
sudo unzip /tmp/bank-web.zip "aegis-soc-dashboard-main/lab/bank-web/*" -d /tmp/
sudo cp -r /tmp/aegis-soc-dashboard-main/lab/bank-web/* /var/www/html/
sudo chown -R www-data:www-data /var/www/html/
# www-data : Apache process user — file owner ဖြစ်ရမယ်

sudo systemctl restart apache2
```

### 8b. DNS-Server (10.10.10.20) — BIND9

#### ဘာကြောင့် DNS Server ထားတာလဲ?
Lab network တွင် `bank.local` domain ကို resolve လုပ်ဖို့ local DNS server လိုသည်။ ထို့အပြင် DNS attack (DNS spoofing, DNS flood) demo လုပ်ရန်လည်း target ဖြစ်သည်။

```bash
sudo apt update
sudo apt install bind9 bind9utils fail2ban suricata -y
# bind9      : DNS server
# bind9utils : dig, nslookup tools
sudo systemctl enable --now bind9
sudo systemctl enable --now fail2ban

# BIND9 config — bank.local zone
sudo nano /etc/bind/named.conf.local
```
```
zone "bank.local" {
    type master;
    file "/etc/bind/db.bank.local";
};
```
```bash
sudo nano /etc/bind/db.bank.local
```
```
$TTL 604800
@   IN  SOA  dns-server.bank.local. root.bank.local. (
              2         ; Serial
              604800    ; Refresh
              86400     ; Retry
              2419200   ; Expire
              604800 )  ; Negative Cache TTL

@       IN  NS   dns-server.bank.local.
@       IN  A    10.10.10.20
bank-web IN A    10.10.10.10
customer-db IN A 10.20.20.10
ldap-server IN A 10.20.20.20
aegis   IN  A    10.30.30.10
```
```bash
sudo systemctl restart bind9

# Test
dig @10.10.10.20 bank-web.bank.local
# @10.10.10.20 : ဒီ DNS server ကိုမေး
```

### 8c. customer-db (10.20.20.10) — MySQL

#### ဘာကြောင့် MySQL သုံးတာလဲ?
bank-web ရဲ့ `db.php` သည် `mysqli` (MySQL) extension သုံးသည်။ PostgreSQL ဆိုရင် PHP code ပြင်ရသည် — MySQL ထည့်တာ ပိုလွယ်သည်။

```bash
sudo apt install mysql-server fail2ban suricata -y

# bankdb + bankuser create
sudo mysql -e "CREATE DATABASE bankdb;"
sudo mysql -e "CREATE USER 'bankuser'@'%' IDENTIFIED BY 'bank1234';"
sudo mysql -e "GRANT ALL ON bankdb.* TO 'bankuser'@'%';"
sudo mysql -e "FLUSH PRIVILEGES;"
# '%' : any IP မှ connect ခွင့်ပြု (lab only)

# Remote connection ခွင့်ပြု (bind 0.0.0.0)
sudo nano /etc/mysql/mysql.conf.d/mysqld.cnf
# bind-address = 127.0.0.1 → bind-address = 0.0.0.0
# ဘာကြောင့်: Default က localhost ဘဲ listen တယ်
#            bank-web (10.10.10.10) မှ connect ဖို့ 0.0.0.0 လို

sudo systemctl restart mysql
sudo systemctl enable mysql

# Demo data seed — attack တွင် ခိုးယူမဲ့ data
sudo mysql bankdb << 'EOF'
CREATE TABLE accounts (
  id int AUTO_INCREMENT PRIMARY KEY,
  full_name varchar(100),
  acc_no varchar(20),
  pin varchar(10),
  balance decimal(12,2) DEFAULT 0,
  status varchar(10) DEFAULT 'active'
);
INSERT INTO accounts (full_name, acc_no, pin, balance) VALUES
  ('Ko Htet', '1001', '1234', 5000000.00),
  ('Ma Aye',  '1002', '5678', 2500000.00),
  ('U Kyaw',  '1003', '9999', 8750000.00);
EOF

# Test remote connection (bank-web ကနေ)
mysql -h 10.20.20.10 -u bankuser -pbank1234 bankdb -e "SELECT * FROM accounts;"
```

### 8d. LDAP-Server (10.20.20.20) — OpenLDAP

#### ဘာကြောင့် LDAP Server ထားတာလဲ?
Real bank system တွင် staff/admin login authentication ကို LDAP server မှ manage လုပ်သည်။ Database တွင် customer data သိမ်းသလို LDAP တွင် user credentials (username, password, role) သိမ်းသည်။ Lab တွင် LDAP brute force, credential dump attack demo လုပ်ရန် target ဖြစ်သည်။

```bash
sudo apt install slapd ldap-utils fail2ban -y
# slapd     : OpenLDAP server daemon
# ldap-utils: ldapsearch, ldapadd tools

# Configure
sudo dpkg-reconfigure slapd
# → Omit OpenLDAP server configuration: No
# → DNS domain name: bank.local
# → Organization name: SecureBank
# → Administrator password: (သတ်မှတ်)
# → Do you want the database to be removed when slapd is purged? No
# → Move old database? Yes

sudo systemctl enable --now slapd
sudo systemctl enable --now fail2ban

# Test
ldapsearch -x -H ldap://localhost -b "dc=bank,dc=local"
# -x  : simple authentication (no SASL)
# -H  : LDAP URI
# -b  : search base (root dn)

# Staff account ထည့်
cat > /tmp/staff.ldif << 'EOF'
dn: ou=staff,dc=bank,dc=local
objectClass: organizationalUnit
ou: staff

dn: cn=teller01,ou=staff,dc=bank,dc=local
objectClass: inetOrgPerson
cn: teller01
sn: Teller
userPassword: teller@123
EOF

ldapadd -x -H ldap://localhost \
  -D "cn=admin,dc=bank,dc=local" \
  -W -f /tmp/staff.ldif
# -D : bind DN (admin account)
# -W : password prompt
# -f : LDIF file မှ read
```

---

## အခန်း 9 — AEGIS Hub Agent Setup (aegis-ADMIN)

### ဘာကြောင့် Hub Agent လိုတာလဲ?
AEGIS SOC Dashboard (Render မှာ) က lab VMs တွင် ဘာဖြစ်နေသည်ကို မသိနိုင်။ aegis-ADMIN VM တွင် Python script run ပြီး bank VMs တွင် SSH remote log tail လုပ်ကာ Dashboard ထဲသို့ events POST လုပ်သည်။

```bash
# Script ဆွဲ
sudo git clone https://github.com/sohu2723-star/aegis-soc-dashboard.git /opt/aegis
cd /opt/aegis/scripts/src

# Python dependency
pip3 install requests

# Config file
cp aegis_forwarder.local.conf.example aegis_forwarder.local.conf
nano aegis_forwarder.local.conf
```
```ini
AEGIS_URL=https://aegis-api-server-jp3b.onrender.com/api
AEGIS_KEY=<AEGIS_INGEST_KEY>
AEGIS_ADMIN_KEY=<AEGIS_ADMIN_KEY>
REMOTE_SSH_USER=sithu
PFSENSE_IP=10.30.30.1
VM_NAME=ubuntu
```
```bash
# Test run
python3 aegis_forwarder.py --mode hub

# Systemd service
sudo tee /etc/systemd/system/aegis-forwarder.service << 'EOF'
[Unit]
Description=AEGIS Forwarder Hub
After=network.target

[Service]
Type=simple
User=sithu
WorkingDirectory=/opt/aegis/scripts/src
ExecStart=/usr/bin/python3 /opt/aegis/scripts/src/aegis_forwarder.py --mode hub
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now aegis-forwarder
sudo journalctl -u aegis-forwarder -f    # Live logs
# -f : follow mode (tail -f နဲ့ တူ)
```

---

## အခန်း 10 — Connectivity Tests (Full Lab)

### Network Reachability Matrix

| From ↓ \ To → | Router | pfSense WAN | bank-web | DNS-Server | customer-db | LDAP | aegis |
|---------------|--------|-------------|----------|------------|-------------|------|-------|
| Attacker | ✅ | ✅ (via R) | ✅ | ✅ | ✅ | ✅ | ✅ |
| bank-web | ✅ | ✅ | — | ✅ | ❌ (pfSense Block) | ❌ | ✅ |
| customer-db | ✅ | ✅ | ❌ | ✅ | — | ✅ | ✅ |
| aegis-ADMIN | ✅ | ✅ | ✅ (SSH) | ✅ (SSH) | ✅ (SSH) | ✅ (SSH) | — |

### Test Commands

```bash
# ── aegis-ADMIN မှ အကုန် test ──────────────────────────────────
ping -c 2 10.10.10.10    # bank-web
ping -c 2 10.10.10.20    # DNS-Server
ping -c 2 10.20.20.10    # customer-db
ping -c 2 10.20.20.20    # LDAP-Server
ping -c 2 10.30.30.1     # pfSense MGMT

# SSH test (password မတောင်းဘဲ OK ထွက်ရမယ်)
ssh -i ~/.ssh/aegis_id_rsa -o BatchMode=yes sithu@10.10.10.10 echo "bank-web OK"
ssh -i ~/.ssh/aegis_id_rsa -o BatchMode=yes sithu@10.10.10.20 echo "dns-server OK"
ssh -i ~/.ssh/aegis_id_rsa -o BatchMode=yes sithu@10.20.20.10 echo "customer-db OK"
ssh -i ~/.ssh/aegis_id_rsa -o BatchMode=yes sithu@10.20.20.20 echo "ldap-server OK"
ssh -i ~/.ssh/pfsense_key  -o BatchMode=yes admin@10.30.30.1  echo "pfsense OK"

# Internet reach test (VM တစ်ခုစီမှ)
ping -c 2 8.8.8.8

# DNS resolve test
dig @10.10.10.20 bank-web.bank.local

# MySQL remote test (bank-web မှ)
mysql -h 10.20.20.10 -u bankuser -pbank1234 bankdb -e "SELECT COUNT(*) FROM accounts;"

# Web app test
curl -s -o /dev/null -w "%{http_code}" http://10.10.10.10
# 200 ထွက်ရမယ်
```

---

## အခန်း 11 — Attack Demo Scenarios

### Demo 1: SSH Brute Force → Auto Block

```bash
# Kali မှ
hydra -l root -P /usr/share/wordlists/rockyou.txt ssh://10.10.10.10 -t 4
# hydra  : Password brute force tool
# -l     : username
# -P     : password wordlist
# -t 4   : 4 parallel threads

# Dashboard မှာ → Security Events → SSH brute-force alert ပေါ်မယ်
# Auto-defense → IP block command execute မယ်
```

### Demo 2: SQL Injection → customer-db Data Theft

```bash
# Kali မှ sqlmap သုံး
sqlmap -u "http://10.10.10.10/?id=1" --dbs --batch
# -u     : target URL
# --dbs  : databases list ထုတ်
# --batch: interactive prompt မပေါ်ဘဲ auto-answer

# Bank web login form မှာ SQLi
# Username field: ' OR '1'='1
# Password field: anything
```

### Demo 3: Network Scan → Suricata Alert

```bash
# Kali မှ
nmap -sV -p 22,80,443,3306 10.10.10.0/24
# -sV        : service version detection
# -p         : specific ports scan
# 10.10.10.0/24 : entire DMZ subnet scan

# Suricata alert → Dashboard Security Events
sudo tail -f /var/log/suricata/eve.json | python3 -m json.tool | grep alert
```

---

## အခန်း 12 — Troubleshooting Guide

### SSH Connection Timeout (Trying... မဆုံးဘူး)
```bash
# pfSense firewall rule စစ် — MGMT → destination port 22 allow ရှိမရှိ
# bank-web မှာ ufw ပိတ်ထားလား
sudo ufw status
sudo ufw allow 22/tcp

# SSH service running လား
sudo systemctl status ssh
sudo systemctl start ssh
```

### Web (10.10.10.10) မကျဘူး — DB Connection Error
```bash
# customer-db မှာ MySQL running လား
sudo systemctl status mysql
# bind-address 0.0.0.0 ဖြစ်မဖြစ်
sudo grep bind-address /etc/mysql/mysql.conf.d/mysqld.cnf
# bank-web မှ port ရောက်မရောက်
telnet 10.20.20.10 3306
```

### OVS VLAN မ Set ရဘူး
```bash
# port ရှိမရှိ စစ်
ovs-vsctl show
# Error: "already exists" ဆိုရင် add မလုပ်နဲ့ — set ဘဲ လုပ်
ovs-vsctl set port eth1 tag=10
```

### Known Hosts Warning
```bash
ssh-keygen -f "/home/sithu/.ssh/known_hosts" -R "<IP>"
# -R : Remove host entry
```

---

## Quick Reference Card

### Network IPs
```
Internet Gateway : 192.168.122.1
Router          : 192.168.122.2 (e0), 192.168.10.1 (e1), 10.0.23.1 (e2)
Attacker (Kali) : 192.168.10.99 (DHCP)
pfSense WAN     : 10.0.23.2
pfSense DMZ     : 10.10.10.1
pfSense INT     : 10.20.20.1
pfSense MGMT    : 10.30.30.1
bank-web        : 10.10.10.10
DNS-Server      : 10.10.10.20
customer-db     : 10.20.20.10
LDAP-Server     : 10.20.20.20
aegis-ADMIN     : 10.30.30.10
```

### Useful Commands

```bash
# Netplan apply
sudo netplan apply

# SSH test
ssh -i ~/.ssh/aegis_id_rsa -o BatchMode=yes sithu@<IP> echo "OK"

# OVS VLAN set
ovs-vsctl set port <port> tag=<vlan>
ovs-vsctl show

# pfSense SSH
ssh -i ~/.ssh/pfsense_key admin@10.30.30.1

# AEGIS agent
sudo systemctl status aegis-forwarder
sudo journalctl -u aegis-forwarder -f

# MySQL remote
mysql -h 10.20.20.10 -u bankuser -pbank1234 bankdb

# Suricata live alerts
sudo tail -f /var/log/suricata/eve.json | grep '"event_type":"alert"'
```

### SSH Keys Location (aegis-ADMIN)
```
~/.ssh/aegis_id_rsa      ← Bank VMs (bank-web, DNS, customer-db, LDAP) private key
~/.ssh/aegis_id_rsa.pub  ← Public key (VM တွေ authorized_keys ထဲ ထည့်ထားရ)
~/.ssh/pfsense_key       ← pfSense private key
~/.ssh/pfsense_key.pub   ← pfSense WebGUI User Manager ထဲ paste ထားရ
```
