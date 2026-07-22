# DNS Server Setup — company-dns-server (10.10.10.20)

## Install

```bash
sudo apt update
sudo apt install bind9 bind9utils bind9-doc dnsutils fail2ban -y
sudo systemctl enable --now bind9
```

## Deploy Zone Files

```bash
# Copy zone files
sudo cp db.goldenmyanmar.trading.com /etc/bind/
sudo cp db.bank.local /etc/bind/

# Append zone declarations
sudo tee -a /etc/bind/named.conf.local < named.conf.local

# Verify syntax
sudo named-checkconf
sudo named-checkzone goldenmyanmar.trading.com /etc/bind/db.goldenmyanmar.trading.com
sudo named-checkzone bank.local /etc/bind/db.bank.local

# Restart BIND9
sudo systemctl restart bind9
sudo systemctl status bind9
```

## Test Resolution

```bash
# From any lab VM (that has nameserver 10.10.10.20 in resolv.conf / netplan):
dig @10.10.10.20 web.goldenmyanmar.trading.com A
# Expected: 10.10.10.10

dig @10.10.10.20 db.goldenmyanmar.trading.com A
# Expected: 10.20.20.10

dig @10.10.10.20 ldap.goldenmyanmar.trading.com A
# Expected: 10.20.20.20

# Full zone check
dig @10.10.10.20 goldenmyanmar.trading.com ANY
```

## Attack Demo — Zone Transfer (AXFR)

```bash
# From Kali (attacker):
dig @10.10.10.20 goldenmyanmar.trading.com AXFR

# With allow-transfer { none; }  → "Transfer failed"  ✅ secure
# Without the ACL                → all records dumped  ❌ vulnerable
```

To demo the vulnerability: comment out `allow-transfer { none; };` in named.conf.local, restart BIND9, then run the AXFR from Kali.

## Netplan — Point all VMs to this DNS

Each Ubuntu VM's `/etc/netplan/` YAML should include:
```yaml
nameservers:
  addresses: [10.10.10.20, 8.8.8.8]
```
