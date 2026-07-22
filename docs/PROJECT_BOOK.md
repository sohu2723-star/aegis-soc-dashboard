# AEGIS-SecureCompany — Project Book
> **Internship Final Project — Network Security Lab**
> **Topology Version:** v4 (Final — 2026-07-20)
> **Author:** Sithu
> **Project:** AEGIS SOC Dashboard with GNS3 Lab

---

## အခန်း 1 — Project Overview

### ဘာ Project လဲ?

AEGIS-SecureCompany သည် ဘဏ်စနစ်ကို simulate လုပ်ထားသော cybersecurity lab တစ်ခုဖြစ်သည်။  
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
                    │  eth1→company-web-server   │        │  Internal-   │      │ aegis-company-admin │
                    │  eth2→DNS-Server │        │  Services    │      │ 10.30.30.10 │
                    └──────┬──────┬───┘        │  OVS Switch  │      └─────────────┘
                           │      │             │  eth0←pfSense│
                    ┌──────┴──┐ ┌─┴──────────┐ │  eth1→cust-db│
                    │company-web-server │ │ DNS-Server  │ │  eth2→LDAP   │
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
| company-web-server | e0 | 10.10.10.10 | /24 | Web Server (Apache+PHP) |
| DNS-Server | e0 | 10.10.10.20 | /24 | DNS (BIND9) |
| Internal-Services Switch | eth0 | — | — | pfSense e2 မှ ချိတ် |
| company-customer-db | e0 | 10.20.20.10 | /24 | Database (MySQL) |
| LDAP-Server | e0 | 10.20.20.20 | /24 | Auth Server (OpenLDAP) |
| aegis-company-admin | e0 | 10.30.30.10 | /24 | AEGIS Hub Agent |

### Network Segments

| Segment | Subnet | Purpose |
|---------|--------|---------|
| Internet | 192.168.122.0/24 | GNS3 NAT cloud (virbr0) |
| Attacker | 192.168.10.0/24 | Kali Linux attack network |
| Router↔pfSense | 10.0.23.0/30 | WAN link (point-to-point) |
| DMZ (Public) | 10.10.10.0/24 | company-web-server, DNS-Server |
| Internal | 10.20.20.0/24 | company-customer-db, LDAP-Server |
| Management | 10.30.30.0/24 | aegis-company-admin (SOC agent) |

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
/ip dhcp-server network add address=192.168.10.0/24 gateway=192.168.10.1 company-dns-server=8.8.8.8
# ဘာကြောင့်: ether2 (Kali ဘက်) မှာ DHCP server run ဖို့
#            company-dns-server=8.8.8.8 = Google DNS သတ်မှတ်

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
DMZ  → vtnet1  (e1)   ← Public Services (company-web-server, DNS)
INT  → vtnet2  (e2)   ← Internal Services (company-customer-db, LDAP)
MGMT → vtnet3  (e3)   ← Management (aegis-company-admin)
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

**DMZ Rules — company-web-server, DNS outbound ခွင့်ပြု + Internal ပိတ်:**
```
Action: Pass  | Interface: DMZ | Source: DMZ net | Destination: any
Action: Block | Interface: DMZ | Source: DMZ net | Destination: 10.20.20.0/24
```
*ဘာကြောင့်: company-web-server က internet ရနိုင်သော်လည်း company-customer-db ကို တိုက်ရိုက် မဝင်နိုင်ဖို့*

**INT Rules — Internal outbound ခွင့်ပြု:**
```
Action: Pass | Interface: INT | Source: INT net | Destination: any
```
*ဘာကြောင့်: company-customer-db, LDAP တို့ internet ရနိုင်ဖို့ (update, etc.)*

**MGMT Rules — AEGIS agent အတွက် အကုန် ခွင့်ပြု:**
```
Action: Pass | Interface: MGMT | Source: MGMT net | Destination: any | Port: any
```
*ဘာကြောင့်: aegis-company-admin (10.30.30.10) က company-web-server, company-customer-db ကို SSH ဝင်နိုင်ဖို့*

### 4d. pfSense SSH Enable (AEGIS agent access အတွက်)

```
WebGUI → System → Advanced → Admin Access
→ Secure Shell Server
→ ☑ Enable Secure Shell    ← tick ပေး
→ Save
```

### 4e. pfSense SSH Key ထည့် (password မတောင်းဘဲ access ဖို့)

pfSense သည် standard `ssh-copy-id` ကို support မလုပ် (shell က `/etc/rc.initial` menu ဖြစ်တာကြောင့်)။

**Recommended Method — scp + Diagnostics Command Prompt** (Browser paste line-break ပြဿနာ မဖြစ်):

**① Aegis VM မှာ key verify + push:**
```bash
# Key file တစ်ကြောင်းတည်းဆိုတာ confirm
wc -l ~/.ssh/pfsense_key.pub   # 1 ထွက်ရမည်

# Key pair မကိုက်မကိုက် verify (generate အသစ်ပြီးမှ မဖြစ်ဖို့ စစ်ပါ)
ssh-keygen -y -f ~/.ssh/pfsense_key | diff - ~/.ssh/pfsense_key.pub && echo "MATCH" || echo "MISMATCH"

# pfSense ထဲ scp နဲ့ push (password auth သုံး)
scp ~/.ssh/pfsense_key.pub admin@10.30.30.1:/tmp/pfsense_key.pub
```

**② pfSense WebGUI → Diagnostics → Command Prompt:**
```sh
mkdir -p /root/.ssh && chmod 700 /root/.ssh && cat /tmp/pfsense_key.pub > /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys
```
→ Execute နှိပ် — output မပေါ်ရင် OK (error မပါမချင်း success)

**③ Test (agent bypass):**
```bash
ssh -i ~/.ssh/pfsense_key \
    -o IdentityAgent=none \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=no \
    admin@10.30.30.1 exit
echo "Exit: $?"   # 0 ထွက်ရမည်
```

*ဘာကြောင့် WebGUI paste မသုံးဘဲ scp သုံးသလဲ:* Browser မှတဆင့် paste လုပ်ရင် `ssh-ed25519 AAAA...` key တစ်ကြောင်းကို ၂ ကြောင်း split ဖြစ်သွားတတ်သည်။ pfSense ကတနည်းနဲ့ partial key ကို read ပြီး auth fail ဖြစ်သည်။ scp + Command Prompt သည် file ကို raw transfer လုပ်သောကြောင့် format မပျက်။

---

## အခန်း 5 — OVS Switch (Open vSwitch) Setup

### ဘာကြောင့် Open vSwitch သုံးတာလဲ?
GNS3 ရဲ့ built-in Ethernet switch သည် VLAN feature မပါ။ Open vSwitch (OVS) သည် software-defined switch ဖြစ်ပြီး VLAN tagging, trunk port, access port တို့ကို support လုပ်သည်။

### ဘာကြောင့် VLAN ခွဲတာလဲ?
- **Security segmentation** — Public (DMZ) network မှ Internal network ကို isolate လုပ်ဖို့
- **Traffic control** — VLAN tag ပြည့်မှ switch ကတဆင့် traffic ဖြတ်သွားနိုင်
- Switch တစ်ခုတည်းသုံးပြီး VLAN ခွဲ = node နည်းသည်၊ topology ရိုးရှင်းသည်

### Public-Services Switch (company-web-server + DNS)

GNS3 မှ Public-Services OVS console ဖွင့်ပြီး:

```bash
# ရှိပြီးသား port တွေ ကြည့်
ovs-vsctl show
# ဘာကြောင့်: bridge ထဲ ဘာ port တွေ ရှိနေလဲ သိဖို့ (add မလုပ်ရသောကြောင့် show ကြည့်ရသည်)

# eth0 = pfSense e1 ချိတ် — trunk port (VLAN tag မသတ်မှတ် = all VLANs ဖြတ်)
# eth1 = company-web-server ချိတ် — VLAN 10 access port
ovs-vsctl set port eth1 tag=10
# ဘာကြောင့်: eth1 ကနေ ဝင်လာတဲ့ traffic ကို VLAN 10 tag တပ်ဖို့

# eth2 = DNS-Server ချိတ် — VLAN 10 access port
ovs-vsctl set port eth2 tag=10
# ဘာကြောင့်: DNS-Server လည်း Public DMZ (VLAN 10) မှာ ရှိတဲ့ အတွက်

# Verify — VLAN tag မှန်မမှန် စစ်
ovs-vsctl show
```

### Internal-Services Switch (company-customer-db + LDAP)

```bash
# eth0 = pfSense e2 ချိတ် — trunk
# eth1 = company-customer-db ချိတ် — VLAN 20 access port
ovs-vsctl set port eth1 tag=20
# ဘာကြောင့်: company-customer-db သည် Internal (VLAN 20) မှာ ရှိ

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

### company-web-server (10.10.10.10)

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

### company-customer-db (10.20.20.10)

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

### aegis-company-admin (10.30.30.10)

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
ping 10.10.10.10        # company-web-server reach ဖြစ်မဖြစ် (aegis-company-admin မှ)
```

---

## အခန်း 7 — SSH Key Authentication Setup

### ဘာကြောင့် SSH Key သုံးတာလဲ?
AEGIS hub script သည် company-web-server, company-customer-db, pfSense တွင် remote command execute လုပ်ရန် SSH ကို auto-login (password မပါဘဲ) လိုသည်။ Password-based auth သည် script တွင် password hardcode လုပ်ရသောကြောင့် insecure ဖြစ်သည်။ SSH key pair (private/public) သုံးရင် password မပါဘဲ authenticate နိုင်သည်။

### SSH Key အလုပ်လုပ်ပုံ

```
aegis-company-admin                          company-web-server
~/.ssh/aegis_id_rsa (private)        ~/.ssh/authorized_keys
~/.ssh/aegis_id_rsa.pub (public)  →  (public key ထည့်ထားသည်)
          │                                  │
          └── SSH connect ────────────────→  └── public key match → OK (password မလို)
```

### aegis-company-admin မှာ SSH Key Generate

```bash
# Company VMs အတွက် key
ssh-keygen -t ed25519 -f ~/.ssh/aegis_id_rsa -N ""
# -t ed25519   : Key type (modern, secure)
# -f           : Output file path
# -N ""        : Passphrase မထည့် (script အတွက် interactive prompt မဖြစ်ဖို့)

# pfSense အတွက် သပ်သပ် key (admin user ကွာတဲ့ အတွက်)
ssh-keygen -t ed25519 -f ~/.ssh/pfsense_key -N ""
```

### Company VMs တွေထဲ Public Key ကူး

```bash
# company-web-server
ssh-copy-id -i ~/.ssh/aegis_id_rsa.pub sithu@10.10.10.10
# -i : ကူးမဲ့ public key file ကို သတ်မှတ်
# ဒီ command က remote VM ရဲ့ ~/.ssh/authorized_keys ထဲ auto append လုပ်ပေးတယ်

# DNS-Server
ssh-copy-id -i ~/.ssh/aegis_id_rsa.pub sithu@10.10.10.20

# company-customer-db
ssh-copy-id -i ~/.ssh/aegis_id_rsa.pub sithu@10.20.20.10

# LDAP-Server
ssh-copy-id -i ~/.ssh/aegis_id_rsa.pub sithu@10.20.20.20
```

### pfSense SSH Key ထည့်နည်း (Correct Method)

pfSense အတွက် Section 4e တွင် ဖော်ပြထားသော **scp + Diagnostics Command Prompt** method ကို သုံးပါ။ WebGUI paste method သည် browser line-break ကြောင့် key corrupt ဖြစ်တတ်သည်။

---

### SSH Keypair Mismatch — ဘာကြောင့် ဖြစ်တာလဲ?

#### Error message
```
identity_sign: private key /home/sithu/.ssh/pfsense_key contents do not match public key
```

#### Concept
SSH key pair ဆိုသည်မှာ private key + public key ကွင်းဆက်ဖြစ်ပြီး တစ်ပြိုင်နက် generate လုပ်မှ match ဖြစ်သည်။

```
generate တစ်ကြိမ်တည်း → private key A ↔ public key A   (match ✅)

ပြဿနာ ဖြစ်တတ်တဲ့ scenarios:
  - Private key ကို overwrite လုပ်ပြီး public key ကို မ overwrite (သို့)
  - Public key ကို တစ်ဖိုင်မှ copy၊ private key က တစ်ခြား generate မှ
  → private key B ↔ public key A   (mismatch ❌)
```

#### Verify
```bash
ssh-keygen -y -f ~/.ssh/pfsense_key | diff - ~/.ssh/pfsense_key.pub && echo "MATCH" || echo "MISMATCH"
# ssh-keygen -y : private key ကနေ public key ထုတ် (private key ကို test လုပ်)
# diff          : derive ထုတ်တဲ့ public key နဲ့ .pub file ကို နှိုင်းယှဉ်
```

#### Fix
```bash
# Keypair အသစ် generate (ဟောင်းတဲ့ mismatched files ကို overwrite)
ssh-keygen -t ed25519 -f ~/.ssh/pfsense_key -N "" -C "sithu@Aegis-admin"
# overwrite prompt ပေါ်ရင် y နှိပ်

# Verify ထပ်စစ်
ssh-keygen -y -f ~/.ssh/pfsense_key | diff - ~/.ssh/pfsense_key.pub && echo "MATCH OK"

# ပြီးရင် Section 4e method နဲ့ pfSense ထဲ key ထည့်
```

---

### SSH Agent Refused Operation — ဘာကြောင့် ဖြစ်တာလဲ?

#### Error message
```
sign_and_send_pubkey: signing failed for ED25519 "key" from agent: agent refused operation
```

#### Concept
SSH Agent (`ssh-agent`) သည် private key တွေကို memory ထဲ cache လုပ်ထားသော background process ဖြစ်သည်။

```
ssh-agent cache ထဲ key ရှိနေတာ → SSH က file ကို bypass ကာ agent ကိုသာ သုံး
Agent refuse ဖြစ်ရတဲ့ အကြောင်းများ:
  ① Key ကို passphrase ပါပါ cache လုပ်ထားပြီး passphrase expire/lost
  ② Key ကို confirm constraint (-c flag) နဲ့ add ထားလို့ interactive confirm မဖြစ်
  ③ Agent ထဲ key ရှိပေမဲ့ private file ကိုက်မကိုက် internal validation fail
  ④ Agent socket stale (session restart ပြဿနာ)
```

#### `-i` flag ပါပေမဲ့ ဘာကြောင့် agent ကို သုံးနေတာလဲ?
```
ssh -i ~/.ssh/pfsense_key → key file ကနေ public key extract → agent ထဲ match ရှာ
Agent မှာ match ရှိတဲ့ key ကို sign ဖို့ request → agent refuse → fail (file fallback မလုပ်)
```

#### Fix ၂ နည်း

**Option A — IdentityAgent=none (ချက်ချင်း fix)**
```bash
# Agent ကို လုံးဝ bypass — key file ကို တိုက်ရိုက် သုံး
ssh -i ~/.ssh/pfsense_key \
    -o IdentityAgent=none \
    -o BatchMode=yes \
    admin@10.30.30.1 exit
```

**Option B — Agent ကို restart**
```bash
# Agent kill ပြီး session အသစ် start
eval $(ssh-agent -k)    # ဟောင်း agent ကို kill
eval $(ssh-agent)       # အသစ် start
ssh-add ~/.ssh/pfsense_key  # key ထည့်

# Test
ssh -i ~/.ssh/pfsense_key -o BatchMode=yes admin@10.30.30.1 exit
```

> **AEGIS forwarder အတွက် note:** `aegis_forwarder.py` သည် SSH command တိုင်းတွင် `-i key_file` နဲ့ `-o IdentityAgent=none` သုံးသောကြောင့် agent ပြဿနာ မသက်ဆိုင်

---

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

### 8a. company-web-server (10.10.10.10) — Apache + PHP + MySQL Client

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
sudo wget -O /tmp/company-web-server.zip \
  https://github.com/sohu2723-star/aegis-soc-dashboard/archive/main.zip
sudo apt install unzip -y
sudo unzip /tmp/company-web-server.zip "aegis-soc-dashboard-main/lab/company-web-server/*" -d /tmp/
sudo cp -r /tmp/aegis-soc-dashboard-main/lab/company-web-server/* /var/www/html/
sudo chown -R www-data:www-data /var/www/html/
# www-data : Apache process user — file owner ဖြစ်ရမယ်

sudo systemctl restart apache2
```

### 8b. DNS-Server (10.10.10.20) — BIND9

#### ဘာကြောင့် DNS Server ထားတာလဲ?

**Real-world ရှင်းချက်:**
ကုမ္ပဏီ network တစ်ခုတွင် services တွေကို IP address ဖြင့် တိုက်ရိုက် ခေါ်ခြင်းမပြုဘဲ domain name (hostname) ဖြင့် ခေါ်သည် — real world ၌ ဤသို့ ဖြစ်သည်။

```
# Real company ထဲ (production):
http://web.goldenmyanmar.trading.com   → DNS → 10.10.10.10
ldap://ldap.goldenmyanmar.trading.com  → DNS → 10.20.20.20
mysql db.goldenmyanmar.trading.com     → DNS → 10.20.20.10

# IP တိုက်ရိုက် မသုံးဘဲ name သုံးရတဲ့ အကြောင်း:
# - Server IP ပြောင်းရင် config file တစ်ခုတည်းပြင်ရ (DNS record)
# - Service တစ်ခုချင်း hostname မှာ ဘာ server run နေသလဲ ရှင်းလင်း
# - Load balancer / failover အတွက် DNS ကို single point of truth သဖွယ် သုံးနိုင်
```

**Lab ထဲ DNS Server ထားတဲ့ အကြောင်း ၃ ချက်:**

| အကြောင်း | ရှင်းချက် |
|---|---|
| **① Internal name resolution** | company-web-server က DB ကို IP မဟုတ်ဘဲ hostname နဲ့ ချိတ် — real app code နဲ့ ကိုက်ညီ |
| **② DNS attack target** | DNS flood, DNS spoofing, zone transfer attack demo လုပ်ဖို့ real DNS service လို |
| **③ Complete company simulation** | HTTP → web → DB → LDAP chain ဖြစ်ဖို့ name resolution မဖြစ်မနေ လို |

Lab network တွင် `bank.local` (လက်ရှိ) / `goldenmyanmar.trading.com` (future) domain ကို resolve လုပ်ဖို့ local DNS server လိုသည်။

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
@   IN  SOA  company-dns-server.bank.local. root.bank.local. (
              2         ; Serial
              604800    ; Refresh
              86400     ; Retry
              2419200   ; Expire
              604800 )  ; Negative Cache TTL

@       IN  NS   company-dns-server.bank.local.
@       IN  A    10.10.10.20
company-web-server IN A    10.10.10.10
company-customer-db IN A 10.20.20.10
company-ldap-server IN A 10.20.20.20
aegis   IN  A    10.30.30.10
```
```bash
sudo systemctl restart bind9

# Test
dig @10.10.10.20 company-web-server.bank.local
# @10.10.10.20 : ဒီ DNS server ကိုမေး
```

### 8c. company-customer-db (10.20.20.10) — MySQL

#### ဘာကြောင့် MySQL သုံးတာလဲ?
company-web-server ရဲ့ `db.php` သည် `mysqli` (MySQL) extension သုံးသည်။ PostgreSQL ဆိုရင် PHP code ပြင်ရသည် — MySQL ထည့်တာ ပိုလွယ်သည်။

```bash
sudo apt install mysql-server fail2ban suricata -y

# companydb + companyuser create
sudo mysql -e "CREATE DATABASE companydb;"
sudo mysql -e "CREATE USER 'companyuser'@'%' IDENTIFIED BY 'company1234';"
sudo mysql -e "GRANT ALL ON companydb.* TO 'companyuser'@'%';"
sudo mysql -e "FLUSH PRIVILEGES;"
# '%' : any IP မှ connect ခွင့်ပြု (lab only)

# Remote connection ခွင့်ပြု (bind 0.0.0.0)
sudo nano /etc/mysql/mysql.conf.d/mysqld.cnf
# bind-address = 127.0.0.1 → bind-address = 0.0.0.0
# ဘာကြောင့်: Default က localhost ဘဲ listen တယ်
#            company-web-server (10.10.10.10) မှ connect ဖို့ 0.0.0.0 လို

sudo systemctl restart mysql
sudo systemctl enable mysql

# Demo data seed — attack တွင် ခိုးယူမဲ့ data
sudo mysql companydb << 'EOF'
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

# Test remote connection (company-web-server ကနေ)
mysql -h 10.20.20.10 -u companyuser -pcompany1234 companydb -e "SELECT * FROM accounts;"
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
# → Organization name: SecureCompany
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

## အခန်း 9 — AEGIS Hub Agent Setup (aegis-company-admin)

### ဘာကြောင့် Hub Agent လိုတာလဲ?
AEGIS SOC Dashboard (Render မှာ) က lab VMs တွင် ဘာဖြစ်နေသည်ကို မသိနိုင်။ aegis-company-admin VM တွင် Python script run ပြီး company VMs တွင် SSH remote log tail လုပ်ကာ Dashboard ထဲသို့ events POST လုပ်သည်။

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

| From ↓ \ To → | Router | pfSense WAN | company-web-server | DNS-Server | company-customer-db | LDAP | aegis |
|---------------|--------|-------------|----------|------------|-------------|------|-------|
| Attacker | ✅ | ✅ (via R) | ✅ | ✅ | ✅ | ✅ | ✅ |
| company-web-server | ✅ | ✅ | — | ✅ | ❌ (pfSense Block) | ❌ | ✅ |
| company-customer-db | ✅ | ✅ | ❌ | ✅ | — | ✅ | ✅ |
| aegis-company-admin | ✅ | ✅ | ✅ (SSH) | ✅ (SSH) | ✅ (SSH) | ✅ (SSH) | — |

### Test Commands

```bash
# ── aegis-company-admin မှ အကုန် test ──────────────────────────────────
ping -c 2 10.10.10.10    # company-web-server
ping -c 2 10.10.10.20    # DNS-Server
ping -c 2 10.20.20.10    # company-customer-db
ping -c 2 10.20.20.20    # LDAP-Server
ping -c 2 10.30.30.1     # pfSense MGMT

# SSH test (password မတောင်းဘဲ OK ထွက်ရမယ်)
ssh -i ~/.ssh/aegis_id_rsa -o BatchMode=yes sithu@10.10.10.10 echo "company-web-server OK"
ssh -i ~/.ssh/aegis_id_rsa -o BatchMode=yes sithu@10.10.10.20 echo "company-dns-server OK"
ssh -i ~/.ssh/aegis_id_rsa -o BatchMode=yes sithu@10.20.20.10 echo "company-customer-db OK"
ssh -i ~/.ssh/aegis_id_rsa -o BatchMode=yes sithu@10.20.20.20 echo "company-ldap-server OK"
ssh -i ~/.ssh/pfsense_key  -o BatchMode=yes admin@10.30.30.1  echo "pfsense OK"

# Internet reach test (VM တစ်ခုစီမှ)
ping -c 2 8.8.8.8

# DNS resolve test
dig @10.10.10.20 company-web-server.bank.local

# MySQL remote test (company-web-server မှ)
mysql -h 10.20.20.10 -u companyuser -pcompany1234 companydb -e "SELECT COUNT(*) FROM accounts;"

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

### Demo 2: SQL Injection → company-customer-db Data Theft

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
# company-web-server မှာ ufw ပိတ်ထားလား
sudo ufw status
sudo ufw allow 22/tcp

# SSH service running လား
sudo systemctl status ssh
sudo systemctl start ssh
```

### Web (10.10.10.10) မကျဘူး — DB Connection Error
```bash
# company-customer-db မှာ MySQL running လား
sudo systemctl status mysql
# bind-address 0.0.0.0 ဖြစ်မဖြစ်
sudo grep bind-address /etc/mysql/mysql.conf.d/mysqld.cnf
# company-web-server မှ port ရောက်မရောက်
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

### pfSense SSH Auth Fail — Permission denied (publickey)

**Symptom:**
```
admin@10.30.30.1: Permission denied (publickey,password,keyboard-interactive)
```

**ဆင့်ဆင့် diagnose:**

**① Key pair match စစ်ဦး (အရေးကြီးဆုံး)**
```bash
ssh-keygen -y -f ~/.ssh/pfsense_key | diff - ~/.ssh/pfsense_key.pub && echo "MATCH" || echo "MISMATCH"
```
→ `MISMATCH` ရရင် → keypair generate အသစ် လုပ်ရမည်:
```bash
ssh-keygen -t ed25519 -f ~/.ssh/pfsense_key -N "" -C "sithu@Aegis-admin"
# overwrite → y
```

**② pfSense ထဲ key ရောက်မရောက် စစ်**

pfSense WebGUI → Diagnostics → Command Prompt:
```sh
cat /root/.ssh/authorized_keys
```
→ `ssh-ed25519 AAAA...` တစ်ကြောင်းတည်း ပေါ်ရမည်
→ ၂ ကြောင်း သို့မဟုတ် မပေါ်ရင် → key ကို re-install လုပ်ရမည် (Section 4e method)

**③ Agent bypass နဲ့ test**
```bash
ssh -i ~/.ssh/pfsense_key \
    -o IdentityAgent=none \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=no \
    admin@10.30.30.1 exit
echo "Exit: $?"
```

**Root causes summary:**

| Error message | ဘာဖြစ်တာလဲ | Fix |
|---|---|---|
| `identity_sign: private key contents do not match public key` | Keypair mismatch | Generate အသစ် + pfSense re-install |
| `agent refused operation` + Permission denied | Agent cache conflict | `-o IdentityAgent=none` သုံး |
| `Permission denied` (agent error မပါ) | pfSense authorized_keys မှားနေ | scp + Diagnostics Command Prompt |

### pfSense SSH Key Install — Browser Paste Line-break ပြဿနာ

**Symptom:** WebGUI Authorized SSH Keys box ထဲ paste ပြီး Save လုပ်သောလည်း auth fail ဆက်ဖြစ်နေ

**ဘာကြောင့်:** Browser clipboard မှ paste လုပ်ရင် `ssh-ed25519 AAAA...TjWCt sithu@Aegis-admin` ဟုသော တစ်ကြောင်းကို ၂ ကြောင်းခွဲသောကြောင့် pfSense က valid key မဟုတ်ဟု ပယ်ချသည်

**Correct fix:**
```bash
# Aegis VM မှာ scp နဲ့ push (format ပျက်မည် မဟုတ်)
scp ~/.ssh/pfsense_key.pub admin@10.30.30.1:/tmp/pfsense_key.pub
```
pfSense WebGUI → **Diagnostics → Command Prompt** (User Manager မဟုတ်):
```sh
cat /tmp/pfsense_key.pub > /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys
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
company-web-server        : 10.10.10.10
DNS-Server      : 10.10.10.20
company-customer-db     : 10.20.20.10
LDAP-Server     : 10.20.20.20
aegis-company-admin     : 10.30.30.10
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
mysql -h 10.20.20.10 -u companyuser -pcompany1234 companydb

# Suricata live alerts
sudo tail -f /var/log/suricata/eve.json | grep '"event_type":"alert"'
```

### SSH Keys Location (aegis-company-admin)
```
~/.ssh/aegis_id_rsa      ← Company VMs (company-web-server, DNS, company-customer-db, LDAP) private key
~/.ssh/aegis_id_rsa.pub  ← Public key (VM တွေ authorized_keys ထဲ ထည့်ထားရ)
~/.ssh/pfsense_key       ← pfSense private key
~/.ssh/pfsense_key.pub   ← pfSense /root/.ssh/authorized_keys ထဲ ထည့်ထားရ (scp + Diagnostics method)
```

### pfSense SSH Commands

```bash
# Keypair match verify
ssh-keygen -y -f ~/.ssh/pfsense_key | diff - ~/.ssh/pfsense_key.pub && echo "MATCH"

# Key push to pfSense (password auth)
scp ~/.ssh/pfsense_key.pub admin@10.30.30.1:/tmp/pfsense_key.pub

# pfSense Diagnostics → Command Prompt မှာ:
# cat /tmp/pfsense_key.pub > /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys

# Auth test (agent bypass)
ssh -i ~/.ssh/pfsense_key -o IdentityAgent=none -o BatchMode=yes -o StrictHostKeyChecking=no admin@10.30.30.1 exit
echo "Exit: $?"   # 0 = OK

# pfSense authorized_keys content စစ်
# pfSense WebGUI → Diagnostics → Command Prompt:
# cat /root/.ssh/authorized_keys
```

### check_connectivity.sh — Full Lab Diagnostic Script

```bash
# aegis-company-admin မှာ run (latest version download)
wget -O ~/check_connectivity.sh \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/check_connectivity.sh
chmod +x ~/check_connectivity.sh
./check_connectivity.sh
```

Script သည် section ၁၀ ခု check လုပ်သည်:
```
0. Pre-flight: SSH key file existence + permissions
1. Ping reachability (all hosts)
2. SSH passwordless auth (all company VMs + pfSense)
3. Port check (22/80/53/3306/389/443)
4. Service status (apache2/named/mysql/slapd/suricata/fail2ban)
5. Log file existence (auth.log/fail2ban.log/named.log/mysql/syslog)
6. iptables blocked IPs per VM + pfSense EasyRuleBlockHosts
7. Fail2ban banned IPs per VM
8. DNS resolution (bank.local + goldenmyanmar.trading.com zones)
9. aegis-forwarder service status + journal
10. AEGIS API healthz check
→ PASS/FAIL/WARN count summary at end
```

---

## အခန်း 13 — Defense Architecture Concepts

> ဤအခန်းသည် AEGIS defense system ၏ design rationale နှင့် component တစ်ခုချင်းစီ၏ role ကို ရှင်းလင်းဖော်ပြသည်။ Panel/judges များအတွက် concept ရှင်းလင်းချက် မှတ်တမ်း ဖြစ်သည်။

---

### 13a. Rule အမျိုးအစား ၃ မျိုး

AEGIS defense system တွင် rule အမျိုးအစား ၃ မျိုး ရှိသည်။ တစ်မျိုးချင်းစီ role မတူ၊ scope မတူ၊ trigger မတူ။

#### ① Fail2ban (VM-local tool)

- Company VM တစ်ခုချင်းစီ၏ **OS level** တွင် run နေသော external security tool
- `auth.log`, `apache.log` တို့ကို **ကိုယ်တိုင် တိုက်ရိုက် monitor** လုပ်သည်
- Attack detect ရင် → ထို VM ၏ **iptables မှာ ချက်ချင်း IP block** — AEGIS မပါဘဲ
- AEGIS နဲ့ ဆက်သွယ်ပုံ — `aegis_forwarder.py` က `fail2ban.log` ကို tail လုပ်ပြီး **event POST** သာ လုပ်ပေးသည်

```
Fail2ban ban ဖြစ် → fail2ban.log ကျ → forwarder POST /api/ingest/fail2ban
→ AEGIS evaluateEvent() → pfSense ကိုပါ ထပ်ဆင့် block + Telegram alert
```

**Role:** VM ၏ first line of defense — AEGIS မသိဘဲ fast local response

---

#### ② Auto-Defense Rules (`defense_rules` table)

- **Render cloud** တွင် run နေသော AEGIS engine
- Event တစ်ခု ဝင်တိုင်း `evaluateEvent()` က active rules အားလုံးနဲ့ match စစ်သည်
- Match ဖြစ်ရင် → `defense_commands` queue ထဲ ထည့် → `aegis_forwarder.py` agent ဆွဲ → VM/pfSense တွင် execute

**Match conditions:**
| Field | ဥပမာ |
|---|---|
| `triggerAttackType` | `ssh_brute`, `web_attack`, `ddos`, `port_scan` |
| `triggerSeverity` | `high`, `critical`, `any` |
| `triggerThreshold` | 5 ကြိမ် |
| `triggerWindowSecs` | 60 စက္ကန့် |

**Default Rules:**

| Rule | Trigger | Block နေရာ |
|---|---|---|
| SSH Brute Force | 5 ကြိမ်/60s | VM iptables |
| DDoS → Null Route | 50 event/30s | VM blackhole route |
| Web Attack (High) | ပထမကြိမ် | company-web-server iptables |
| Port Scan | ပထမကြိမ် | company-web-server iptables |
| Critical → pfSense | severity=critical | pfSense WAN easyrule |
| Web Attack → pfSense | severity=high | pfSense WAN easyrule |

**Mode ၂ မျိုး:**
- `"auto"` → agent က တိုက်ရိုက် execute
- `"suggest"` → dashboard မှာ ပြ၊ human confirm မှ execute

**Role:** Pattern-based cross-VM automated response — multi-source event ကို correlate လုပ်ပြီး smart decision

---

#### ③ Firewall Rules (`firewall_rules` table)

- Dashboard ကနေ **admin ကိုယ်တိုင်** ဆောက်တဲ့ structured iptables rules
- `chain`, `action`, `protocol`, `sourceIp`, `destPort`, `interface` အားလုံး သတ်မှတ်နိုင်
- **Agent ကို တိုက်ရိုက် မပို့** — DB မှာ save ဘဲ၊ "Export" button နှိပ်မှ bash script ထွက်ပြီး VM မှာ manual apply ရသည်
- Auto-defense မမမိတဲ့ custom case (port policy, protocol block) အတွက် သုံးသည်

**Role:** Human analyst ၏ judgment-based network policy — system မမြင်တဲ့ threat အတွက်

---

#### ④ Admin Block / Unblock (`blocked_ips` table)

- Dashboard Defense Center မှ IP တစ်ခု **ချက်ချင်း block/unblock**
- POST တစ်ချက်ဖြင့် → VM iptables + pfSense WAN easyrule **နှစ်ခုလုံး execute**
- Single IP သို့မဟုတ် CIDR (`192.168.10.0/24`) ထည့်နိုင်သည်
- Dashboard မှ unblock နိုင် + မှတ်တမ်း (`defense_actions`) ရှိ

**Firewall Rule နဲ့ ကွာတာ:**

| | Admin Block/Unblock | Firewall Rule |
|--|---|---|
| Agent execute | ချက်ချင်း | Export မှ manual apply |
| Scope | IP ဘဲ | IP + port + protocol + chain |
| Unblock | Dashboard မှ တစ်ချက် | `isActive=false` ဘဲ — VM မဖြုတ် |
| သုံးရတဲ့ ကိစ္စ | "ဒီ IP ကို ယခုချင်း block" | "ဒီ port policy ကို VM မှာ apply" |

---

### 13b. ဘာကြောင့် Suricata IPS မသုံးဘဲ AEGIS Auto-Defense ဆောက်သလဲ

Suricata တွင် mode ၂ မျိုးရှိသည်—

| Mode | ဘာလုပ်သလဲ |
|---|---|
| **IDS** (Detection only) | Alert ဘဲ ပြ — block မလုပ် |
| **IPS** (Inline Prevention) | Traffic ကြားထဲ ထိုင်ပြီး packet DROP |

ဒီ lab တွင် **IDS mode ဘဲ သုံးသည်** — IPS မသုံးတဲ့ အကြောင်းရင်း—

**① Inline mode = network ဖွဲ့စည်းပုံ ပြန်ဆောက်ရ**
> Suricata IPS က traffic path ထဲ ဝင်ထိုင်ရသည် (NFQUEUE/bridge mode)။ pfSense က gateway ဖြစ်နေတဲ့ topology တွင် IPS inline ထည့်ဖို့ lab ပြန်ဆောက်ရမည် — complexity မလိုအပ်ဘဲ ဖြစ်တယ်။

**② Single VM ဘဲ ကာကွယ်နိုင်**
> company-web-server မှာ Suricata IPS run ရင် ထို VM ဘဲ ကာကွယ်နိုင်သည်။ company-customer-db, pfSense WAN ကို cross-block မလုပ်နိုင်။

**③ Multi-source correlation မရ**
> Suricata IPS က Suricata alert ဘဲ ကြည့်သည်။ AEGIS က Suricata + Fail2ban + SSH + Cowrie အားလုံးကို correlate လုပ်ပြီး threshold ပြည့်မှ block — false positive နည်းသည်။

**④ Visibility မရှိ**
> Suricata IPS က block လုပ်ပြီး ကိစ္စပြတ်သည် — dashboard မှတ်တမ်း မရှိ၊ unblock မရ၊ Telegram မပို့။ AEGIS က block မှတ်တမ်း + Telegram + AI analysis + Dashboard unblock ပါ ရသည်။

**Suricata IPS + Telegram ရောက်မလား?**
> ရောက်တယ် — Suricata IPS ကလည်း eve.json မှာ record ကျတယ်၊ forwarder က tail လုပ်ပြီး AEGIS ကို POST လုပ်သည်၊ Telegram ရောက်သည်။ **ဒါပေမယ့် — block ဖြစ်ပြီးမှ AEGIS သိသည်**၊ AEGIS auto-defense မှာတော့ detect ချင်း Telegram ပို့ပြီး block command ကို ထုတ်သည်။

---

### 13c. VM + pfSense Cross-block — ဘာကြောင့် နှစ်ခုလုံး လိုသလဲ

**Defense in Depth** — layer တစ်ခု fail ဖြစ်ရင် နောက် layer က cover လုပ်သည်။

```
pfSense WAN block  →  Network ဝင်ပေါက်မှာ ပိတ် (boundary defense)
VM iptables block  →  pfSense bypass ဖြစ်ရင် VM ကိုယ်တိုင် ကာကွယ် (host defense)
```

| Scenario | pfSense WAN block | VM iptables block |
|---|---|---|
| External attacker (normal case) | ✅ ထိ | ✅ ထိ |
| pfSense down/restart | ❌ ကာမကွယ်နိုင် | ✅ ကာကွယ်နိုင် |
| Internal pivot (compromised VM) | ❌ မထိ | ✅ ထိ |

pfSense WAN block တစ်ခုဘဲ လုပ်ရင် — pfSense ပျက်ချိန် VM တွေ unprotected ဖြစ်မည်။ VM block တစ်ခုဘဲ လုပ်ရင် — attacker က တခြား VM တွေကို pivot လုပ်နိုင်သေးသည်။

**pfSense block scope:** `easyrule block WAN <ip>` သည် **single IP ဘဲ** block သည်။ Network တစ်ခုလုံး block ချင်ရင် CIDR (`192.168.10.0/24`) ထည့်ရသည် — `sanitizeIp()` က CIDR ကို accept လုပ်သည်။

---

### 13d. External vs Insider Threat Coverage

#### External Attacker (Kali — 192.168.10.x)

```
Kali → Router → pfSense WAN → VM တွေ
```

- pfSense WAN block → ✅ network ဝင်ပေါက်မှာ ပိတ်
- VM Suricata/Fail2ban → ✅ detect + block
- AEGIS auto-defense → ✅ cross-VM + pfSense
- Telegram → ✅
- **Coverage: ပြည့်တယ်**

---

#### Insider Threat အမျိုးအစား ၂ မျိုး

**Case 1 — Compromised VM (pivot attack)**

> Kali က company-web-server hack အောင်မြင်သည်။ ယခု company-web-server (10.10.10.10) ကနေ company-customer-db ကို port scan / brute force လုပ်သည်။

```
company-web-server (10.10.10.10) → company-customer-db တိုက်
        │
pfSense မကြည့် (internal traffic) ← pfSense WAN block မထိ
        │
company-customer-db Suricata detect (scan/brute force pattern)
        │
AEGIS → 10.10.10.10 ကို company-customer-db မှာ cross-block ✅
Telegram ✅
```

**pfSense မထိ — VM cross-block ထိ**

---

**Case 2 — လူ insider (Staff)**

> ကုမ္ပဏီ ဝန်ထမ်းက valid credential သုံးပြီး တိုက်သည်။

```
Staff → valid SSH login → valid MySQL query
        │
Suricata မမိ (attack pattern မဟုတ်)
Fail2ban မမိ (brute force မဟုတ်)
AEGIS မသိ → block မလုပ်နိုင် ❌
```

**ဒီ system တစ်ခုလုံး မထိဘူး** — behavior analytics (UEBA / SIEM) မှ ထိမည်

---

#### Coverage Summary

| Threat အမျိုးအစား | pfSense block | VM Cross-block | Telegram |
|---|---|---|---|
| External attacker | ✅ | ✅ | ✅ |
| Compromised VM (pivot) | ❌ | ✅ | ✅ |
| Staff insider (valid cred) | ❌ | ❌ | ❌ |

> **ဒီ system ၏ primary target = External attacker**
> Compromised VM pivot = partial coverage (VM cross-block)
> လူ insider = out of scope — UEBA/SIEM လိုမည်

---

## အခန်း 14 — Future Roadmap: goldenmyanmar.trading.com Company Infrastructure

> ဤအခန်းသည် project ၏ next phase plan ဖြစ်သည်။ လက်ရှိ lab (bank.local) ကို real company simulation (goldenmyanmar.trading.com) သို့ upgrade လုပ်မည်ဆိုသော plan၊ concept နှင့် rationale များ မှတ်တမ်းတင်သည်။

---

### 14a. ဘာကြောင့် Company Simulation လိုသလဲ?

Real company infrastructure တစ်ခုပုံစံ ဆောက်ရတဲ့ ရည်ရွယ်ချက်:

```
[Goal] Attack → Detect → Defend cycle ကို real-world ဖြစ်ရပ်နဲ့ ကိုက်ညီအောင် လုပ်ဖို့

Real company ထဲ:
  ✅ Web server → customer ဝင်ကြည့်တဲ့ company website
  ✅ DNS server → internal hostname resolution (web, db, ldap ကို name နဲ့ reach)
  ✅ Database   → customer data, transaction records
  ✅ LDAP server → staff/admin login authentication
  ✅ Firewall   → network segmentation (DMZ / Internal / MGMT)
  ✅ IDS        → Suricata on perimeter (pfSense)
  ✅ SIEM/SOC   → AEGIS dashboard (real-time monitoring)

Lab ထဲ simulation တူရမယ်:
  10.10.10.10 ကို browser ထဲ ထည့်ရင် → company website ပေါ်
  web server က DB ကို hostname နဲ့ query လုပ်
  staff login form → LDAP authenticate
  attacker ဝင်ရင် → AEGIS detect + block + Telegram alert
```

### 14b. Company Name: goldenmyanmar.trading.com

| Item | Value |
|---|---|
| **Company name** | Golden Myanmar Trading Co., Ltd. |
| **Internal domain** | `goldenmyanmar.trading.com` (lab internal — not real DNS) |
| **Web server** | company-web-server (10.10.10.10) |
| **DNS server** | company-dns-server (10.10.10.20) |
| **Database** | company-customer-db (10.20.20.10) |
| **LDAP** | company-ldap-server (10.20.20.20) |

> **⚠️ Important:** `goldenmyanmar.trading.com` သည် lab internal domain ဖြစ်သည် — real internet DNS မဟုတ်ဘဲ company-dns-server (10.10.10.20) ဘဲ resolve လုပ်သည်။ Lab machines တွေ nameserver `10.10.10.20` ထည့်ထားမှ ဒီ domain ကို reach နိုင်မည်။

---

### 14c. New Company Services Plan

#### Priority 1 — Core Services (အရင်ဆောက်ရမဲ့)

**① Web Server (company-web-server: 10.10.10.10)**
```
Domain  : http://goldenmyanmar.trading.com
Service : Apache2 + PHP
Content : Golden Myanmar Trading company website
         - Login page (staff portal)
         - Product catalog / trading dashboard
         - Contact / company info
DB Link : PHP → MySQL (company-customer-db via hostname db.goldenmyanmar.trading.com)
LDAP Link: Staff login → LDAP authenticate (ldap.goldenmyanmar.trading.com)
```

**② DNS Server (company-dns-server: 10.10.10.20)**
```
Zone    : goldenmyanmar.trading.com
Records :
  @       → 10.10.10.20   (zone apex)
  web     → 10.10.10.10   (web.goldenmyanmar.trading.com)
  db      → 10.20.20.10   (db.goldenmyanmar.trading.com)
  ldap    → 10.20.20.20   (ldap.goldenmyanmar.trading.com)
  aegis   → 10.30.30.10
```

**③ Database (company-customer-db: 10.20.20.10)**
```
Engine  : MySQL
DB name : goldenmyanmardb (bank→company rename)
Tables  :
  - customers   (ဖောက်သည် profile — name, ID, contact)
  - accounts    (account no, balance, status)
  - transactions(transaction history — amount, date, type)
  - products    (trading products catalog)
User    : gmuser@'%' with password (lab use)
```

**④ LDAP Server (company-ldap-server: 10.20.20.20)**
```
Engine  : OpenLDAP (slapd)
Base DN : dc=goldenmyanmar,dc=com
OU      : ou=staff,dc=goldenmyanmar,dc=com
Accounts:
  - cn=admin.staff (HR admin)
  - cn=teller01    (Front office)
  - cn=manager01   (Branch manager)
```

#### Priority 2 — Extended Services (ပိုကောင်းဖို့)

| Service | Purpose | Attack demo |
|---|---|---|
| Email server (Postfix) | company-web-server မှ email ပို့ | Phishing, email spoofing |
| CCTV/VoIP sim | IoT device simulation | IoT brute force |

#### Priority 3 — Advanced (Optional)

| Service | Purpose |
|---|---|
| Active Directory (Samba AD) | Windows-style domain auth — LDAP ထက် real enterprise |
| ATM simulation | Financial transaction system |

---

### 14d. DNS Resolution: Why + How (Technical Detail)

#### ဘာကြောင့် IP မဟုတ်ဘဲ DNS ကို သုံးသလဲ

```
❌ Bad practice (IP hardcode):
   php: $db = new mysqli("10.20.20.10", "user", "pass", "db");
   Problem: DB IP ပြောင်းရင် PHP file အားလုံး ပြင်ရ

✅ Good practice (DNS name):
   php: $db = new mysqli("db.goldenmyanmar.trading.com", "user", "pass", "db");
   Benefit: IP ပြောင်းရင် DNS record ဘဲ update — code မပြောင်းနဲ့
```

#### DNS Resolution Chain (lab ထဲ ဘယ်လို အလုပ်လုပ်သလဲ)

```
company-web-server (10.10.10.10)
    │
    │  1. PHP: connect "db.goldenmyanmar.trading.com"
    │  2. OS resolv.conf: nameserver 10.10.10.20
    │  3. Query → company-dns-server (10.10.10.20)
    │  4. BIND9: zone goldenmyanmar.trading.com → db → 10.20.20.10
    │  5. Return IP: 10.20.20.10
    │
    └─→ MySQL connect: 10.20.20.10:3306
```

#### DNS Resolution Test Commands

```bash
# ── company-dns-server မှ zone check ────────────────────────────
# Named configuration syntax check
sudo named-checkconf
sudo named-checkzone goldenmyanmar.trading.com /etc/bind/db.goldenmyanmar.trading.com

# ── aegis-company-admin မှ DNS query test ───────────────────────
# DNS-Server ကို directly query
dig @10.10.10.20 web.goldenmyanmar.trading.com A
# @10.10.10.20 : ဒီ DNS server ကို query
# A            : A record (IPv4 address) တောင်း
# Expected: 10.10.10.10

dig @10.10.10.20 db.goldenmyanmar.trading.com A
# Expected: 10.20.20.10

dig @10.10.10.20 ldap.goldenmyanmar.trading.com A
# Expected: 10.20.20.20

# Full answer section ကြည့်
dig @10.10.10.20 goldenmyanmar.trading.com ANY
# ANY: A, NS, SOA အကုန် ကြည့်

# ── company-web-server မှ resolve test (system DNS ကိုသုံး) ──────
# nameserver 10.10.10.20 ထည့်ထားရင် ဒီ command က resolve ဖြစ်ရမယ်
nslookup db.goldenmyanmar.trading.com
host ldap.goldenmyanmar.trading.com

# ── Reverse DNS test (IP → hostname) ────────────────────────────
dig @10.10.10.20 -x 10.10.10.10
# PTR record ရှိမရှိ စစ် (optional — forward zone ဘဲ လိုချင်ရင် ကောင်း)

# ── Zone transfer test (attack simulation) ───────────────────────
# Attacker မှ zone data ခိုးယူဖို့ ကြိုးစားခြင်း
dig @10.10.10.20 goldenmyanmar.trading.com AXFR
# AXFR allow ထားရင် → zone records အကုန် ထွက် (security issue)
# BIND9 ACL block ထားရင် → Transfer failed (ကောင်းတယ်)
```

---

### 14e. Real-World Attack Scenarios (goldenmyanmar.trading.com)

Company services တွေ running ဖြစ်ပြီဆိုရင် ဒီ attack တွေ demo လုပ်မည်:

#### ① HTTP Attack — Web Server (10.10.10.10)

| Attack | Tool | Target | Expected AEGIS alert |
|---|---|---|---|
| SQL Injection | sqlmap | login form / search | `web_attack (sqli)` |
| Brute force login | hydra/burp | staff login page | `ssh_brute / web_brute` |
| DDoS / Flood | hping3, slowloris | port 80 | `ddos` → website down |
| Directory traversal | nikto | Apache paths | `web_attack` |
| XSS | manual / burp | input fields | `web_attack` |

```bash
# DDoS → website down simulation (Kali မှ)
hping3 -S --flood -V -p 80 10.10.10.10
# -S : SYN packets
# --flood : maximum speed
# -p 80   : HTTP port
# Result: company-web-server CPU maxed, Apache unresponsive → "website down"
# AEGIS: ddos event → auto null-route + Telegram alert

# Company website health check (aegis-company-admin မှ)
curl -s -o /dev/null -w "%{http_code}" http://10.10.10.10
# 200 = OK | 503/000 = site down
```

#### ② DNS Attack — DNS Server (10.10.10.20)

| Attack | Tool | Target | Expected AEGIS alert |
|---|---|---|---|
| DNS flood | hping3 / dnsperf | port 53/UDP | `ddos` |
| Zone transfer | dig AXFR | BIND9 | `dns_zone_transfer` |
| DNS spoofing | ettercap/manual | DNS cache | ARP alert (if detected) |
| NXDOMAIN flood | custom script | random hostnames | `dns_query_refused` spike |

```bash
# Zone transfer attempt (Kali မှ)
dig @10.10.10.20 goldenmyanmar.trading.com AXFR
# AEGIS: dns_zone_transfer alert → Telegram

# DNS flood (Kali မှ)
hping3 --udp -p 53 --flood 10.10.10.20
# Result: BIND9 lag → DNS resolution slow/fail → web app DB connect fail chain
```

#### ③ Database Attack — company-customer-db (10.20.20.10)

| Attack | Tool | Target | Expected AEGIS alert |
|---|---|---|---|
| MySQL brute force | hydra | port 3306 | `ssh_brute` (fail2ban) |
| SQLi (via web) | sqlmap | web app form | Web attack → DB data dump |
| Direct connect | mysql client | 3306 direct | fail2ban detect |

```bash
# MySQL brute force (Kali မှ)
hydra -l root -P /usr/share/wordlists/rockyou.txt mysql://10.20.20.10 -t 4
# fail2ban → AEGIS → auto-block + Telegram

# SQLi via web app (data dump)
sqlmap -u "http://10.10.10.10/search?q=1" --dbs --tables --dump --batch
# customers, accounts, transactions tables expose ဖြစ်
```

#### ④ LDAP Attack — company-ldap-server (10.20.20.20)

| Attack | Tool | Target | Expected AEGIS alert |
|---|---|---|---|
| LDAP brute force | hydra | port 389 | `ssh_brute` (fail2ban) |
| Anonymous bind | ldapsearch | dn dump | detect via log |
| Credential dump | ldapsearch -x | all users | Telegram alert |

```bash
# Anonymous LDAP enumeration (Kali မှ)
ldapsearch -x -H ldap://10.20.20.20 -b "dc=goldenmyanmar,dc=com"
# -x : anonymous bind (no credential)
# All user entries expose ဖြစ်မဖြစ် test

# LDAP brute force
hydra -l "cn=admin,dc=goldenmyanmar,dc=com" -P /usr/share/wordlists/rockyou.txt ldap2://10.20.20.20
```

#### ⑤ Website Down Simulation (Full Chain Attack)

```
Attack Goal: goldenmyanmar.trading.com website ကို completely down ဖြစ်အောင် လုပ်ပြ

Chain:
  Step 1: DNS flood → DNS server respond မဖြစ် → hostname resolve မဖြစ်
  Step 2: DDoS web → Apache resources exhausted → HTTP 503
  Step 3: DB brute → MySQL connections maxed → PHP DB connect fail
  Result: http://10.10.10.10 → "Connection refused" / timeout

AEGIS response:
  - DNS flood → ddos alert → null route
  - DDoS web → ddos alert → IP block + Telegram
  - DB brute → fail2ban block → pfSense + VM iptables block
  - Dashboard: multiple red alerts, Telegram notifications burst
```

---

### 14f. Migration Plan (Bank → Company)

**Phase: Future (not current)**

| Item | Old (bank) | New (goldenmyanmar) | Action |
|---|---|---|---|
| Domain | `bank.local` | `goldenmyanmar.trading.com` | BIND9 zone rename |
| DB name | `companydb` (transitional) | `goldenmyanmardb` | MySQL DB rename + re-seed |
| DB user | `companyuser` | `gmuser` | MySQL user recreate |
| Web content | Bank login/dashboard | Golden Myanmar Trading site | New PHP app |
| LDAP base DN | `dc=bank,dc=local` | `dc=goldenmyanmar,dc=com` | slapd dpkg-reconfigure |
| AEGIS host-utils | bank-web aliases | company names (already done) | ✅ Done |
| Netplan nameserver | `10.10.10.20` (keep) | `10.10.10.20` (keep) | No change |

> **Note:** Netplan DNS config (nameserver 10.10.10.20) တွင် domain ကို မသုံးဘဲ IP ဘဲ သုံးထားသည် — zone ပြောင်းသော်လည်း Netplan မပြောင်းနဲ့ OK ဖြစ်သည်။

---

## အခန်း 15 — Session Notes: Pending Diagnostics (2026-07-22)

> ဤအခန်းသည် 2026-07-22 session ၏ ကျန်ရှိသော pending items များ မှတ်တမ်းတင်ထားသည်။ ပြီးဆုံးသောအခါ lab-setup-journal.md ထဲ ဆက်ရေးမည်။

---

### 15a. ✅ Completed This Session

#### DNS Watcher Internal Filter Fix

**Problem:** AEGIS Dashboard Telemetry မှာ `10.30.30.10 → company-dns-server [dns_query_refused]` spam ပေါ်နေ

**Root Cause:** aegis hub VM (10.30.30.10) က routine health check / name resolution လုပ်ရင်း BIND9 refused ဖြေသည်→ `_watch_remote_bind9()` မှာ filter မပါ → dashboard event spam

**Fix applied (`scripts/src/aegis_forwarder.py`):**
```python
# _watch_remote_bind9() ထဲ _defender_ips filter ထည့်
_defender_ips = {h["ip"] for h in REMOTE_HOSTS} | {"10.30.30.10", PFSENSE_IP}
# dns_query_refused → source ∈ _defender_ips → skip (routine internal query)
# dns_zone_transfer (AXFR/IXFR) → always alert (any source = suspicious)
```

**Status:** Code ✅ pushed to GitHub main | VM ⏳ `wget` + `systemctl restart` မလုပ်ရသေး

---

#### pfSense Suricata Watcher: FreeBSD tail -F Fix

**Problem:** pfSense SSH watcher → connect → immediately disconnect (15s reconnect loop)

**Root Cause:** pfSense runs FreeBSD. GNU tail: `tail -F missing_file` → wait/retry. BSD tail: `tail -F missing_file` → **immediately exit**. Suricata eve.json မရှိသေးတဲ့ အတွက် SSH session ချက်ချင်း ပြတ်ကာ reconnect loop ဖြစ်နေ

**Fix applied (`scripts/src/aegis_forwarder.py`):**
```python
# Before:
f"tail -F {log_path} 2>/dev/null"

# After (BSD compatible wait-then-tail):
f"sh -c 'while [ ! -f {log_path} ]; do sleep 5; done; tail -F {log_path} 2>/dev/null'"
```
Also: `ServerAliveInterval` 15→30, `ServerAliveCountMax` 3→6

**Status:** Code ✅ pushed | VM ⏳ script update pending | pfSense ⏳ eve.json still missing

---

### 15b. ✅ Resolved: pfSense Suricata eve.json Path (2026-07-22)

**Problem was:** Code used `/var/db/suricata/suricata_em110/eve.json` — wrong path

**Confirmed via pfSense Diagnostics → Command Prompt:**

| Command | Result |
|---|---|
| `ls /var/db/suricata/suricata_em110/` | `rules/` folder only — no eve.json |
| `ps aux \| grep suricata` | Suricata running ✅ on em1.10 + em2.20 |
| `ls /var/log/suricata/` | **`eve.json` ← here!** |
| YAML `default-log-dir` | `/var/log/suricata/suricata_em1.1042709/` (dynamic PID) |

**Key lesson:**
- `/var/db/suricata/` = rules only — logs မဟုတ်
- `/var/log/suricata/eve.json` = actual combined log (stable path)
- Instance subdirs (`suricata_em1.1042709/`) ထဲ PID number သည် Suricata restart တိုင်း ပြောင်း

**Code fix applied:**
```python
# aegis_forwarder.py — _default_log
"/var/log/suricata/eve.json"   # correct ✅ (was /var/db/suricata/suricata_em110/eve.json)
```

**Files updated:** `aegis_forwarder.py`, `check_connectivity.sh`, `aegis_forwarder.local.conf.example`
**Pushed:** GitHub main ✅

---

### 15c. ⏳ Pending: Aegis VM Script Update

**What to run on aegis-company-admin:**
```bash
# Script update (GitHub မှ latest)
wget -O /opt/aegis/scripts/src/aegis_forwarder.py \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py

# Verify download
head -5 /opt/aegis/scripts/src/aegis_forwarder.py

# Restart service
sudo systemctl restart aegis-forwarder
sudo journalctl -u aegis-forwarder -f   # live log ကြည့်
```

**What these fixes activate:**
1. DNS watcher → aegis hub internal queries filter ✅
2. pfSense watcher → BSD-compatible wait-then-tail ✅ (no more reconnect loop)

---

### 15d. DNS Resolution Test (After goldenmyanmar.trading.com Setup)

**Prerequisite:** BIND9 zone `goldenmyanmar.trading.com` configure ပြီးမှ run ရမည်

```bash
# ── Step 1: Zone file syntax check (DNS-Server မှာ) ──────────────
sudo named-checkconf
sudo named-checkzone goldenmyanmar.trading.com /etc/bind/db.goldenmyanmar.trading.com
# "OK" ထွက်ရမည် — error ရှိရင် zone load မဖြစ်

# ── Step 2: Basic record resolution ─────────────────────────────
dig @10.10.10.20 web.goldenmyanmar.trading.com A
# ANSWER: web.goldenmyanmar.trading.com → 10.10.10.10

dig @10.10.10.20 db.goldenmyanmar.trading.com A
# ANSWER: db.goldenmyanmar.trading.com → 10.20.20.10

dig @10.10.10.20 ldap.goldenmyanmar.trading.com A
# ANSWER: ldap.goldenmyanmar.trading.com → 10.20.20.20

# ── Step 3: End-to-end resolution from company-web-server ────────
# company-web-server resolv.conf မှာ nameserver 10.10.10.20 ရှိမရှိ
cat /etc/resolv.conf

# System DNS ကိုသုံး resolve (resolv.conf မှာ 10.10.10.20 ထည့်မှ OK)
nslookup db.goldenmyanmar.trading.com
# Expected: Address: 10.20.20.10

# ── Step 4: Web → DB connect test via DNS ────────────────────────
# company-web-server မှာ MySQL via hostname test
mysql -h db.goldenmyanmar.trading.com -u gmuser -pgm1234 goldenmyanmardb \
  -e "SELECT COUNT(*) FROM customers;"
# DNS resolve → IP → MySQL connect → query OK ဆိုရင် DNS chain ပြည့်ပြည့်ဝဝ အလုပ်လုပ်

# ── Step 5: Security test — zone transfer block confirm ──────────
dig @10.10.10.20 goldenmyanmar.trading.com AXFR
# "Transfer failed" ထွက်ရမည် (BIND9 ACL မပါရင် all records expose — security risk)
```
