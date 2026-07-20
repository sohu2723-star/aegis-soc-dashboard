# VM Configuration Guide

> **Last Updated:** 2026-07-20
> **Topology:** v4 Final — OVS switches, DNS-Server (10.10.10.20), LDAP-Server (10.20.20.20), customer-db=10.20.20.10

---

## pfSense 2.7.2

### Interface Assignment (Console — Option 1)
```
WAN  → em0   IP: 10.0.23.2/30     GW: 10.0.23.1
DMZ  → em1   IP: 10.10.10.1/24    (Public Services — bank-web, DNS-Server)
INT  → em2   IP: 10.20.20.1/24    (Internal Services — customer-db, LDAP-Server)
MGMT → em3   IP: 10.30.30.1/24    (aegis-ADMIN)
```

WebGUI: `https://10.0.23.2` (from Router) — admin / pfsense

### Firewall Rules

**WAN Rules:**
- Source: `192.168.10.0/24` → Destination: any → Action: **Pass** (allow attacker subnet)

**DMZ (em1):**
- Allow all from DMZ → Internet (HTTP/HTTPS/DNS)

**INT (em2):**
- Allow Internal → Internet (for updates only)

**MGMT (em3):**
- Allow aegis-ADMIN outbound HTTPS to API server

### Static Route (Required — Kali return path)
```
System → Routing → Static Routes → Add
  Network:    192.168.10.0/24
  Gateway:    10.0.23.1  (Router ether3)
  Description: Return path to Kali attacker network
```

### Default Gateway
```
System → Routing → Gateways → Default IPv4: WANGW (10.0.23.1)
Interfaces → WAN → uncheck "Block private networks"
Interfaces → WAN → uncheck "Block bogon networks"
```

---

## Ubuntu Bank VMs — Netplan Config

### bank-web (10.10.10.10)
```yaml
# /etc/netplan/00-installer-config.yaml
network:
  ethernets:
    ens3:
      addresses: [10.10.10.10/24]
      routes:
        - to: default
          via: 10.10.10.1
      nameservers:
        addresses: [10.10.10.20, 8.8.8.8]
  version: 2
```

### DNS-Server (10.10.10.20)
```yaml
network:
  ethernets:
    ens3:
      addresses: [10.10.10.20/24]
      routes:
        - to: default
          via: 10.10.10.1
      nameservers:
        addresses: [127.0.0.1, 8.8.8.8]
  version: 2
```

### customer-db (10.20.20.10)
```yaml
network:
  ethernets:
    ens3:
      addresses: [10.20.20.10/24]
      routes:
        - to: default
          via: 10.20.20.1
      nameservers:
        addresses: [10.10.10.20, 8.8.8.8]
  version: 2
```

### LDAP-Server (10.20.20.20)
```yaml
network:
  ethernets:
    ens3:
      addresses: [10.20.20.20/24]
      routes:
        - to: default
          via: 10.20.20.1
      nameservers:
        addresses: [10.10.10.20, 8.8.8.8]
  version: 2
```

### aegis-ADMIN (10.30.30.10)
```yaml
network:
  ethernets:
    ens3:
      addresses: [10.30.30.10/24]
      routes:
        - to: default
          via: 10.30.30.1
      nameservers:
        addresses: [10.10.10.20, 8.8.8.8]
  version: 2
```

---

## Kali / Attacker VM

Connected directly to Router ether2 — no switch.

```
# /etc/network/interfaces
auto eth0
iface eth0 inet dhcp
    post-up ip route add 10.0.0.0/8 via 192.168.10.1 || true
```

```bash
sudo systemctl restart networking
# Verify
ip a show eth0         # should get 192.168.10.x
ping -c 2 8.8.8.8     # internet ✅
ping -c 2 10.10.10.10 # bank-web ✅
```

---

## Services to Install

### bank-web (10.10.10.10)
```bash
sudo apt update
sudo apt install -y apache2 php libapache2-mod-php php-mysql \
    vsftpd suricata fail2ban openssh-server libapache2-mod-security2
```

### DNS-Server (10.10.10.20)
```bash
sudo apt update
sudo apt install -y bind9 bind9utils fail2ban openssh-server
```

### customer-db (10.20.20.10)
```bash
sudo apt update
sudo apt install -y mysql-server suricata fail2ban openssh-server
```

### LDAP-Server (10.20.20.20)
```bash
sudo apt update
sudo apt install -y slapd ldap-utils fail2ban openssh-server
```

### aegis-ADMIN (10.30.30.10)
```bash
sudo apt update
sudo apt install -y python3 python3-pip python3-requests openssh-client
# Deploy aegis_forwarder.py from GitHub raw URL
wget -O /opt/aegis/scripts/src/aegis_forwarder.py \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py
```
