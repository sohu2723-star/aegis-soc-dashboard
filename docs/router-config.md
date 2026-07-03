# Router Configuration Commands

## R1 — MikroTik CHR (Edge Router)

```mikrotik
# IP Addresses
/ip address
add address=192.168.122.2/24 interface=ether1 comment="To Cloud/virbr0 (Kali side)"
add address=10.0.12.1/30     interface=ether3 comment="To R2"

# Default route via virbr0 host (internet)
/ip route
add dst-address=0.0.0.0/0    gateway=192.168.122.1 comment="Internet via KVM NAT"
add dst-address=10.10.0.0/16 gateway=10.0.12.2     comment="Bank zone via R2"

# NAT masquerade (so bank VMs reach internet via R1)
/ip firewall nat
add chain=srcnat out-interface=ether1 action=masquerade
```

---

## R2 — MikroTik CHR (Core Router)

```mikrotik
# IP Addresses
/ip address
add address=10.0.12.2/30  interface=ether1 comment="To R1"
add address=10.10.0.1/30  interface=ether2 comment="To pfSense WAN"

# Routes
/ip route
add dst-address=0.0.0.0/0          gateway=10.0.12.1  comment="Internet via R1"
add dst-address=192.168.122.0/24   gateway=10.0.12.1  comment="Kali network via R1"
add dst-address=10.10.10.0/24      gateway=10.10.0.2  comment="DMZ via pfSense"
add dst-address=10.10.20.0/24      gateway=10.10.0.2  comment="INT via pfSense"
add dst-address=10.10.30.0/24      gateway=10.10.0.2  comment="MGMT via pfSense"
```

---

## Verification Commands

```mikrotik
# Check interfaces
/ip address print

# Check routes
/ip route print

# Ping test
/ping 192.168.122.1    # virbr0 host
/ping 10.0.12.2        # R2 (from R1)
/ping 10.10.0.2        # pfSense WAN (from R2)
```
