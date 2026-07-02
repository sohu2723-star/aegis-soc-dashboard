# AEGIS SOC — Code Flow Documentation

> **Production stack**: Render (API) + Vercel (Frontend) + Supabase PostgreSQL  
> **Replit = code editing only**. Do NOT use Replit URLs in any source code.

---

## 1. Repository Layout

```
workspace/
├── artifacts/
│   ├── aegis-dashboard/        # React 19 + Vite frontend (→ Vercel)
│   └── api-server/             # Express 5 API server (→ Render)
├── lib/
│   ├── db/                     # Drizzle ORM schema + migrations (Supabase PostgreSQL)
│   ├── api-spec/               # OpenAPI 3.1 contract (openapi.yaml) — source of truth
│   ├── api-client-react/       # Generated: React Query hooks (Orval)
│   └── api-zod/                # Generated: Zod schemas (Orval)
├── scripts/
│   └── src/
│       ├── aegis_forwarder.py  # Ubuntu VM log forwarder (Suricata/Snort/Fail2ban/auth.log)
│       └── defense_agent.py    # Ubuntu/pfSense agent — polls pending commands, executes them
└── docs/                       # Architecture + flow documentation
```

---

## 2. API Server Code Flow

### Startup sequence (`artifacts/api-server/src/index.ts`)

```
1. Read PORT env var → throw if missing
2. Import app (app.ts)
3. app.ts mounts:
   ├── pinoHttp middleware (structured logging)
   ├── cors()
   ├── express.json() + express.urlencoded()
   └── /api → router (routes/index.ts)
4. seedDefaultRules() → inserts 9 default defense rules if table is empty
5. app.listen(port)
```

### Route map (`artifacts/api-server/src/routes/`)

| File | Path prefix | Purpose |
|---|---|---|
| `health.ts` | `/api/health` | Liveness probe |
| `dashboard.ts` | `/api/dashboard/*` | Aggregated stats for Command Center |
| `stream.ts` | `/api/stream` | SSE — push real-time events to dashboard |
| `ingest.ts` | `/api/ingest/*` | Receive events from Ubuntu VM sensors |
| `events.ts` | `/api/events` | Query stored security events |
| `incidents.ts` | `/api/incidents` | CRUD for incidents |
| `alerts.ts` | `/api/alerts` | CRUD for alerts |
| `system.ts` | `/api/system/status` | System health (from system_status table) |
| `reports.ts` | `/api/reports` | Generate + retrieve reports |
| `network.ts` | `/api/network/hosts` | Connected host inventory |
| `defense.ts` | `/api/defense/*` | Block/unblock IPs, defense status |
| `firewall.ts` | `/api/firewall/rules` | Firewall rule CRUD + export |
| `connections.ts` | `/api/connections/*` | SSH/FTP sessions, TLS traffic, HTTP attacks |
| `defense-rules.ts` | `/api/defense/rules` | Defense rule CRUD |

### Ingest flow (`artifacts/api-server/src/routes/ingest.ts`)

```
POST /api/ingest/<source>
│
├─ auth middleware: check X-AEGIS-Key header vs AEGIS_INGEST_KEY env var
│   └─ 401 if missing/wrong
│
├─ Parse + validate body (Zod schemas per endpoint)
│
├─ insertEvent(values)
│   ├─ INSERT INTO security_events
│   ├─ broadcaster.broadcast("security_event", row)    → SSE to all dashboard clients
│   ├─ broadcaster.broadcast("stats_update", ts)       → SSE stats refresh
│   └─ evaluateEvent(row)                              → Auto-Defense Engine
│
└─ Return 201 + inserted row
```

#### Specialized ingest endpoints

| Endpoint | Source | Extra table written |
|---|---|---|
| `POST /api/ingest/snort` | Snort IDS | `security_events` |
| `POST /api/ingest/suricata` | Suricata EVE JSON | `security_events` |
| `POST /api/ingest/suricata/tls` | Suricata TLS | `encrypted_traffic` |
| `POST /api/ingest/fail2ban` | Fail2ban ban | `security_events` + auto-block IP |
| `POST /api/ingest/ssh` | auth.log | `ssh_sessions` + `security_events` |
| `POST /api/ingest/ftp` | vsftpd/proftpd | `ftp_sessions` + `security_events` |
| `POST /api/ingest/http` | ModSecurity/Nginx | `http_attacks` + `security_events` |
| `POST /api/ingest/cowrie` | Cowrie honeypot | `security_events` |

---

## 3. Auto-Defense Engine (`artifacts/api-server/src/lib/auto-defense.ts`)

### `evaluateEvent(event)` — called after every ingest

```
1. Skip if sourceIp is missing or "unknown"
2. Normalize attack type: toTriggerType(event.type, event.subtype)
   → maps to one of: ssh_brute, port_scan, ddos, web_attack,
     phishing, mail_attack, ftp_brute, honeypot, tls_suspicious,
     dns_attack, mitm, any
3. Load all active defense rules from DB (isActive = true)
4. Sort rules by priority (ascending — lower number = higher priority)
5. For each rule:
   a. typeMatch: rule.triggerAttackType == "any" OR == actualTriggerType
   b. sevMatch:  rule.triggerSeverity  == "any" OR event.severity >= rule.triggerSeverity
   c. If not matching → skip rule
   d. recordAttack(sourceIp, counterKey, windowSecs) → in-memory counter
      └─ If count < rule.triggerThreshold → skip rule
   e. Rule fires:
      ├─ actionType == "auto"    → executeAutoDefense(rule, event)
      └─ actionType == "suggest" → suggestManualDefense(rule, event)
   f. BREAK — only highest-priority rule fires per event
```

### `executeAutoDefense(rule, event)`

```
1. sanitizeIp(sourceIp)    → validates; throws on private/loopback/invalid IP
2. parseActionParams(rule.actionParams)  → validates JSON params; throws on unsafe values
3. buildCommand(rule, sourceIp, eventId) → returns { commandType, commandText, undoCommand }
   defense types:
   ├─ block_ip       → iptables -I INPUT -s <IP> -j DROP
   ├─ null_route     → ip route add blackhole <IP>/32
   ├─ rate_limit     → iptables rate-limit + DROP chain
   ├─ port_block     → iptables -p tcp --dport <port> -j DROP
   ├─ dns_block      → printf '0.0.0.0 <domain>' >> /etc/hosts
   ├─ pfsense_block  → JSON payload for pfSense REST API
   ├─ pfsense_port_block → JSON payload for pfSense port block
   ├─ waf_rule       → modsec_ban.sh <IP>
   └─ alert_only     → logger command (no block)
4. INSERT INTO defense_commands (status="pending", targetVm)
5. If block_ip/null_route/pfsense_block:
   └─ INSERT INTO blocked_ips (if not already active)
6. INSERT INTO defense_actions (type="auto", status="queued")
7. broadcaster.broadcast("defense_action", ...) → SSE to dashboard
8. broadcaster.broadcast("stats_update", ...)
```

### `suggestManualDefense(rule, event)`

```
1. buildCommand() to get suggested commandText
2. INSERT INTO incidents (title="[ACTION NEEDED] ...", notes=suggested command)
3. INSERT INTO alerts (channel="dashboard", acknowledged=false)
4. broadcaster.broadcast("alert", ...)
5. broadcaster.broadcast("incident", ...)
```

### Attack counter (`artifacts/api-server/src/lib/attack-tracker.ts`)

```
In-memory Map: { "sourceIp:attackType" → [timestamp1, timestamp2, ...] }
recordAttack(ip, type, windowSecs):
  1. Prune timestamps older than windowSecs
  2. Append current timestamp
  3. Return count within window
```

---

## 4. Real-Time SSE (`artifacts/api-server/src/lib/broadcaster.ts`)

```
Singleton broadcaster:
  clients: Set<Response>

broadcaster.addClient(res):
  1. Set SSE headers (Content-Type: text/event-stream)
  2. Add res to clients set
  3. On req close → remove from clients

broadcaster.broadcast(eventType, payload):
  1. Serialize payload to JSON
  2. Write "event: <eventType>\ndata: <json>\n\n" to every client
  3. Flush (if writable)
```

**Event types broadcast**:
| Event | Triggered by |
|---|---|
| `security_event` | Every ingest call |
| `stats_update` | Every ingest + defense action |
| `defense_action` | Auto-defense fires |
| `alert` | Manual/auto alert created |
| `incident` | Incident created |

---

## 5. Database Schema (`lib/db/src/schema/`)

| Table | File | Purpose |
|---|---|---|
| `security_events` | `security_events.ts` | All raw security events from sensors |
| `incidents` | `incidents.ts` | Aggregated attack incidents |
| `alerts` | `alerts.ts` | Priority notifications |
| `system_status` | `system_status.ts` | Sensor health (pushed by forwarder) |
| `reports` | `reports.ts` | Generated SOC reports |
| `network_hosts` | `network_hosts.ts` | Connected host inventory |
| `defense_actions` | `defense_actions.ts` | Log of all block/unblock actions |
| `ssh_sessions` | `connections.ts` | SSH login history |
| `ftp_sessions` | `connections.ts` | FTP session history |
| `encrypted_traffic` | `connections.ts` | TLS/SSL anomaly log |
| `http_attacks` | `connections.ts` | HTTP attack detail (SQLi/XSS/LFI/RFI) |
| `defense_rules` | `defense_engine.ts` | Active auto-defense rules |
| `defense_commands` | `defense_engine.ts` | Pending commands for VM agent |
| `blocked_ips` | `defense_engine.ts` | Currently blocked IPs |
| `attack_counters` | `defense_engine.ts` | (legacy — counters now in-memory) |
| `firewall_rules` | (firewall schema) | Manual firewall rules |

### Connection (`lib/db/src/index.ts`)

```
SUPABASE_DB_URL (pooler, port 6543) required
parseConnectionUrl() → handles special chars in password (lastIndexOf + safeDecode)
postgres({ ...conn, ssl: "require", max: 10 })
drizzle(client, { schema })
```

---

## 6. Frontend Code Flow (`artifacts/aegis-dashboard/src/`)

### Entry point

```
main.tsx
└─ <QueryClientProvider>          (React Query — all data fetching)
   └─ <Router>                    (Wouter — client-side routing)
      └─ pages/layout.tsx         (sidebar + header shell)
         └─ <Route path="/*">     (page components)
```

### Data fetching pattern

```
Page component
├─ useQuery (from @tanstack/react-query)
│   ├─ queryFn: fetch(`${BASE}/api/<endpoint>`)
│   └─ refetchInterval: N ms  (polling)
└─ Generated hooks from @workspace/api-client-react
    └─ Orval-generated from lib/api-spec/openapi.yaml
```

### SSE real-time connection

```
[Dashboard page] → useEffect → EventSource("/api/stream")
  onmessage → parse JSON → queryClient.invalidateQueries(...)
  → React Query refetches stale data → UI updates
```

### API proxy (dev vs prod)

```
Development (Vite):
  vite.config.ts → server.proxy: { "/api": "http://localhost:3000" }
  
Production (Vercel):
  vercel.json → rewrites: [{ source: "/api/:path*", destination: "https://aegis-api-server-jp3b.onrender.com/api/:path*" }]
```

### Defense Center status logic

```
/api/defense/status (defense.ts route)
├─ activeBlocks    = SELECT * FROM blocked_ips WHERE isActive = true
├─ recentActions   = SELECT * FROM defense_actions ORDER BY createdAt DESC LIMIT 5
└─ sensorRows      = SELECT * FROM system_status
    ├─ fail2banActive = sensorRows.find("fail2ban")?.status === "online"
    └─ suricataActive = sensorRows.find("suricata")?.status === "online"
    
If Ubuntu VM forwarder has never connected → fail2banActive = false, suricataActive = false
(Previously these were hardcoded true — now reflect real sensor state)
```

---

## 7. Code Generation (`lib/api-spec/`)

```
lib/api-spec/openapi.yaml          ← source of truth for API contract
    │
    ▼ pnpm --filter @workspace/api-spec run codegen (Orval)
    │
    ├─ lib/api-client-react/        ← React Query hooks (useGetEvents, useGetAlerts, ...)
    └─ lib/api-zod/                 ← Zod schemas (EventSchema, AlertSchema, ...)
```

When adding a new API endpoint:
1. Add to `openapi.yaml`
2. Run `pnpm --filter @workspace/api-spec run codegen`
3. Use generated hook in the frontend component

---

## 8. Build & Deployment

### API Server (Render)

```
pnpm --filter @workspace/api-server run build
└─ node ./build.mjs
   └─ esbuild bundles src/index.ts → dist/index.mjs (ESM)
      also bundles: pino-worker.mjs, pino-file.mjs, pino-pretty.mjs

pnpm --filter @workspace/api-server run start
└─ node --enable-source-maps ./dist/index.mjs
```

### Frontend (Vercel)

```
pnpm --filter @workspace/aegis-dashboard run build
└─ vite build → dist/public/   (static assets)

Served via Vercel CDN
/api/* → rewritten to https://aegis-api-server-jp3b.onrender.com
```

### Schema push (Supabase)

```
pnpm --filter @workspace/db run push
└─ drizzle-kit push --config ./drizzle.config.ts
   reads SUPABASE_DB_URL (port 6543 pooler)
   compares schema → applies DDL diff
```

---

## 9. Security Boundaries

| Layer | Mechanism |
|---|---|
| Ingest auth | `X-AEGIS-Key` header must match `AEGIS_INGEST_KEY` |
| Admin auth | `X-AEGIS-Admin-Key` header must match `AEGIS_ADMIN_KEY` |
| IP sanitization | `defense-sanitize.ts` validates IP before any shell command |
| Port sanitization | Only numeric 1–65535 allowed |
| Protocol sanitization | Only `tcp`/`udp`/`icmp` allowed |
| No raw user input in shell | All defense commands use sanitized values only |
| Supabase SSL | `ssl: "require"` on all DB connections |
