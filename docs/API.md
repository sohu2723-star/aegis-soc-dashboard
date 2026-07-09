# AEGIS API Reference

Base URL: `https://aegis-api-server-jp3b.onrender.com/api`

---

## Authentication

Ingest endpoints require the `X-AEGIS-Key` header:
```
X-AEGIS-Key: your-aegis-ingest-key
```

Set the key via environment variable: `AEGIS_INGEST_KEY`

---

## Dashboard

### GET /api/dashboard/summary
Returns overall system statistics.

**Response:**
```json
{
  "totalEvents": 42,
  "criticalThreats": 3,
  "activeAlerts": 7,
  "systemsOnline": 13,
  "systemsTotal": 15
}
```

---

## Security Events

### GET /api/events
List security events with optional filters.

**Query params:**
- `severity` — `critical | high | medium | low`
- `type` — event type string
- `limit` — max results (default 100)

**Response:** Array of SecurityEvent objects

### GET /api/events/recent
Returns last 20 events for the live feed.

### GET /api/events/stream
SSE stream — subscribe for real-time event push.

```javascript
const es = new EventSource('/api/events/stream');
es.onmessage = (e) => console.log(JSON.parse(e.data));
```

---

## Ingest (Sensor → AEGIS)

All ingest endpoints require `X-AEGIS-Key` header.

### POST /api/ingest/event
Generic security event from any source.

**Body:**
```json
{
  "source": "ubuntu",
  "type": "network_scan | web_attack | brute_force | malware | honeypot | dos",
  "subtype": "Port Scan",
  "severity": "critical | high | medium | low",
  "sourceIp": "192.168.122.132",
  "targetHost": "ubuntu-server",
  "description": "nmap SYN scan detected",
  "toolUsed": "nmap"
}
```

### POST /api/ingest/snort
Snort IDS alert format.

**Body:**
```json
{
  "alert": "[1:1000001:1] ET SCAN nmap SYN scan",
  "sourceIp": "192.168.122.132",
  "destIp": "10.10.10.10",
  "protocol": "TCP",
  "srcPort": 54321,
  "destPort": 22
}
```

### POST /api/ingest/suricata
Suricata EVE JSON format (pass directly from eve.json).

**Body:** Raw EVE JSON event object

### POST /api/ingest/fail2ban
Fail2ban ban/unban event.

**Body:**
```json
{
  "action": "Ban",
  "ip": "192.168.122.132",
  "jail": "sshd",
  "timestamp": "2026-07-01T08:00:00Z"
}
```

### POST /api/ingest/cowrie
Cowrie honeypot session event.

**Body:** Raw Cowrie JSON log entry

---

## Incidents

### GET /api/incidents
List all incidents.

### POST /api/incidents
Create a new incident.

### GET /api/incidents/:id
Get incident by ID.

### PATCH /api/incidents/:id
Update incident status.

---

## Alerts

### GET /api/alerts
List alerts. Query: `?status=open|acknowledged|resolved`

### PATCH /api/alerts/:id
Update alert (acknowledge or resolve).

---

## Network

### GET /api/network/hosts
List all registered network hosts.

### POST /api/network/hosts
Register or update a host (upsert by IP).

**Body:**
```json
{
  "ip": "192.168.122.132",
  "hostname": "kali-attacker",
  "role": "kali | ubuntu | honeypot | router | unknown",
  "os": "Kali Linux 2024",
  "mac": "08:00:27:xx:xx:xx",
  "openPorts": "22,80,443",
  "status": "online",
  "isMonitored": true
}
```

### GET /api/network/traffic
Returns 24h traffic timeseries data (inbound/outbound/blocked Mb/s).

---

## Defense

### GET /api/defense/status
Returns auto-defense system status.

**Response:**
```json
{
  "autoDefenseEnabled": true,
  "fail2banActive": true,
  "suricataActive": true,
  "totalBlocked": 5,
  "recentActions": [...]
}
```

### GET /api/defense/blocks
List all blocked IPs (active and history).

### POST /api/defense/block
Block an IP address.

**Body:**
```json
{
  "ip": "192.168.122.132",
  "reason": "Port scan detected",
  "blockedBy": "manual | auto"
}
```

### DELETE /api/defense/block/:ip
Unblock an IP address.

### GET /api/defense/actions
List recent defense actions (last 100).

---

## System Status

### GET /api/system/status
Returns status of all monitored system components.

---

## Simulate (Development Only)

### POST /api/simulate/trigger
Trigger a single simulated attack event.

### POST /api/simulate/start
Start auto-simulation (fires events every 10s).

### POST /api/simulate/stop
Stop auto-simulation.

### GET /api/simulate/status
Check if simulation is running.
