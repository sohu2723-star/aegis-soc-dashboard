# Router-2 — MikroTik CHR 7.15.3
> **GNS3 node:** Router-2 | **Console:** telnet (double-click in GNS3)
> **Last updated:** 2026-07-04

---

## Interface Map

| GNS3 | MikroTik | Connected to | IP |
|---|---|---|---|
| e0 | ether1 | Router-1 ether3 | 10.0.12.2/30 |
| e1 | ether2 | pfSense e0 (WAN) | 10.0.23.1/30 |

---

## Full Configuration Commands (အစမှ အဆုံး)

### Step 1 — Change Password (first boot)

```routeros
# Login: admin / (no password)
# System prompts password change → set a password
```

### Step 2 — IP Addresses

```routeros
/ip address
add address=10.0.12.2/30 interface=ether1
add address=10.0.23.1/30 interface=ether2
```

### Step 3 — Static Routes

```routeros
/ip route
add dst-address=0.0.0.0/0 gateway=10.0.12.1        # default → Router-1
add dst-address=10.10.10.0/24 gateway=10.0.23.2     # DMZ → pfSense
add dst-address=10.20.20.0/24 gateway=10.0.23.2     # Internal → pfSense
add dst-address=10.30.30.0/24 gateway=10.0.23.2     # Management → pfSense
```

---

## Verify Commands

```routeros
/ip address print
/ip route print
/ping 10.0.12.1 count=4     # Router-1 link
/ping 8.8.8.8 count=4       # Internet (Router-1 ကိုဖြတ်)
/ping 10.0.23.2 count=4     # pfSense WAN (pfSense configure ပြီးမှ)
```

**Expected results:**
- `ping 10.0.12.1` → reply ✅
- `ping 8.8.8.8` → 0% packet-loss, TTL=114, ~31ms ✅

---

## Status: ✅ Complete (2026-07-04 02:29)
