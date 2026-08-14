# AEGIS Public-Segment Presentation Diagrams

These diagrams use monochrome Mermaid markup so they can be pasted directly
into diagrams.net (draw.io) without exposing credentials or deployment URLs.

## Import into draw.io

1. Open <https://app.diagrams.net/> and create a blank diagram.
2. Select **Arrange → Insert → Advanced → Mermaid**.
3. Paste one complete Mermaid block from this document.
4. Select **Diagram**, click **Insert**, and use **File → Export as** to export
   SVG or PNG for PowerPoint.
5. Keep the aspect ratio locked when resizing the exported image.

The diagrams deliberately use only white fills, black text, black borders, and
dashed black monitoring/control links. Do not place secrets, database URLs,
API keys, tokens, or SSH private-key contents in a presentation diagram.

## 1. Public network architecture

Use this on the **Public Network Architecture** slide. The detailed focus is
the DMZ Web and DNS servers; the internal segment is included only to explain
segmentation and scope boundaries.

```mermaid
%%{init: {"theme":"base","themeVariables":{"primaryColor":"#ffffff","primaryTextColor":"#000000","primaryBorderColor":"#000000","lineColor":"#000000","secondaryColor":"#ffffff","tertiaryColor":"#ffffff","clusterBkg":"#ffffff","clusterBorder":"#000000","fontFamily":"Arial"},"flowchart":{"curve":"linear","htmlLabels":true}}}%%
flowchart LR
    K["Kali Attacker<br/>DHCP: 192.168.10.x"] --> R["MikroTik Router<br/>192.168.10.1 / 10.0.23.1"]
    R --> P["pfSense Firewall + Suricata<br/>WAN: 10.0.23.2"]

    subgraph DMZ["PUBLIC / DMZ — 10.10.10.0/24 — PRESENTATION FOCUS"]
      direction TB
      SW1["Public Services Switch"]
      WEB["Company Web Server<br/>10.10.10.10<br/>HTTP · SSH · Fail2ban"]
      DNS["Company DNS Server<br/>10.10.10.20<br/>BIND9 · SSH · Fail2ban"]
      SW1 --> WEB
      SW1 --> DNS
    end

    subgraph INT["INTERNAL — 10.20.20.0/24 — OTHER TEAM SCOPE"]
      direction TB
      SW2["Internal Services Switch"]
      DB["Customer Database<br/>10.20.20.10"]
      LDAP["LDAP Server<br/>10.20.20.20"]
      SW2 --> DB
      SW2 --> LDAP
    end

    subgraph MGMT["MANAGEMENT — 10.30.30.0/24"]
      HUB["AEGIS Admin / Forwarder<br/>10.30.30.10"]
    end

    P -->|"DMZ gateway 10.10.10.1"| SW1
    P -->|"Internal gateway 10.20.20.1"| SW2
    P -->|"Management gateway 10.30.30.1"| HUB
    HUB -. "SSH monitoring and defense control" .-> P
    HUB -. "SSH log collection" .-> WEB
    HUB -. "SSH log collection" .-> DNS
```

## 2. Layered system architecture

Use this on the **System Architecture Design** slide. It explains which
component detects, collects, processes, stores, displays, and responds.

```mermaid
%%{init: {"theme":"base","themeVariables":{"primaryColor":"#ffffff","primaryTextColor":"#000000","primaryBorderColor":"#000000","lineColor":"#000000","secondaryColor":"#ffffff","tertiaryColor":"#ffffff","clusterBkg":"#ffffff","clusterBorder":"#000000","fontFamily":"Arial"},"flowchart":{"curve":"linear","htmlLabels":true}}}%%
flowchart TB
    subgraph DETECT["1 — DETECTION LAYER"]
      SUR["pfSense Suricata<br/>EVE JSON"]
      F2B["Fail2ban"]
      AUTH["SSH auth.log"]
      APACHE["Apache access.log"]
      BIND["BIND9 named.log"]
    end

    subgraph COLLECT["2 — COLLECTION AND CONTROL LAYER"]
      HUB["AEGIS Python Forwarder<br/>Parse · Normalize · Heartbeat · SSH Control"]
    end

    subgraph PROCESS["3 — API PROCESSING LAYER"]
      API["Express 5 + TypeScript API<br/>Authenticate · Validate · Classify · Correlate"]
      RULE["Auto-Defense Engine<br/>Type · Severity · Threshold · Target"]
    end

    subgraph DATA["4 — DATA LAYER"]
      PG["PostgreSQL / Supabase<br/>Events · Alerts · Rules · Commands · Audit"]
    end

    subgraph PRESENT["5 — PRESENTATION AND NOTIFICATION LAYER"]
      UI["React Dashboard<br/>REST History + SSE Live Updates"]
      TG["Telegram Alerts"]
      AI["Groq Threat Analysis"]
    end

    subgraph DEFEND["6 — DEFENSE LAYER"]
      LINUX["Public Linux Servers<br/>iptables DROP / Rate Limit"]
      PFS["pfSense WAN<br/>SSH + easyrule"]
    end

    SUR --> HUB
    F2B --> HUB
    AUTH --> HUB
    APACHE --> HUB
    BIND --> HUB
    HUB -->|"HTTPS + X-AEGIS-Key"| API
    API --> PG
    API --> RULE
    RULE --> PG
    PG -->|"REST queries"| UI
    API -->|"SSE"| UI
    API --> TG
    API --> AI
    PG -->|"Pending commands"| HUB
    HUB -. "SSH command" .-> LINUX
    HUB -. "SSH command" .-> PFS
    HUB -->|"Execution result"| API
```

## 3. End-to-end security data flow

Use this on the **System Flow and Data Flow** slide. It shows the authoritative
order: persist the event before broadcasting it, then evaluate and execute any
matching defense rule.

```mermaid
%%{init: {"theme":"base","themeVariables":{"primaryColor":"#ffffff","primaryTextColor":"#000000","primaryBorderColor":"#000000","lineColor":"#000000","secondaryColor":"#ffffff","tertiaryColor":"#ffffff","clusterBkg":"#ffffff","clusterBorder":"#000000","fontFamily":"Arial"},"flowchart":{"curve":"linear","htmlLabels":true}}}%%
flowchart LR
    A["1. Approved Lab Attack<br/>Nmap · HTTP Payload · AXFR · Flood"]
    S["2. Security Evidence<br/>Suricata / auth.log / Apache / BIND9"]
    F["3. AEGIS Forwarder<br/>Parse and Normalize"]
    I["4. Ingest API<br/>Authenticate and Validate"]
    C["5. Classify and Correlate<br/>Type · Subtype · Severity"]
    D[("6. PostgreSQL<br/>Persisted Audit Record")]
    L["7. Alert and Rule Evaluation"]
    Q["8. Target-Specific<br/>Defense Command Queue"]
    X["9. SSH Execution<br/>iptables or easyrule"]
    V["10. Verification<br/>Command Result + Traffic Retest"]
    U["Live Dashboard<br/>SSE + REST History"]
    T["Telegram Alert"]

    A --> S --> F --> I --> C --> D --> L
    D -->|"Persisted history"| U
    L -->|"Live event"| U
    L -->|"High / critical"| T
    L -->|"Matching active rule"| Q --> X --> V
    V -->|"Executed / failed result"| D
```

## 4. Public attack classification

Use this on the **Public Attack Categories** slide. The left column contains
the dashboard/defense top-level types; the right-side nodes contain the public
attack signatures or subtypes grouped under each type.

```mermaid
%%{init: {"theme":"base","themeVariables":{"primaryColor":"#ffffff","primaryTextColor":"#000000","primaryBorderColor":"#000000","lineColor":"#000000","secondaryColor":"#ffffff","tertiaryColor":"#ffffff","clusterBkg":"#ffffff","clusterBorder":"#000000","fontFamily":"Arial"},"flowchart":{"curve":"linear","htmlLabels":true}}}%%
flowchart LR
    PS["port_scan"] --> SYN["Nmap / Repeated SYN Probes"]

    SSH["ssh_brute"] --> SSHB["SSH Connection Burst"]
    SSH --> SSHF["Repeated Authentication Failures"]
    AUTH["auth_event"] --> LOGON["Unauthorized Login Success"]

    WEB["web_attack"] --> SQLI["SQL Injection"]
    WEB --> XSS["Cross-Site Scripting"]
    WEB --> TRAV["Directory Traversal"]
    WEB --> CMD["Command Injection"]
    WEB --> SCAN["HTTP Scanner / Login Brute Force"]

    DNS["dns_attack"] --> AXFR["AXFR Zone Transfer"]
    DNS --> ANY["DNS ANY Query Burst"]
    DNS --> ENUM["DNS Enumeration"]

    DDOS["ddos"] --> SYNF["SYN / ACK Flood"]
    DDOS --> UDPF["UDP / DNS Flood"]
    DDOS --> ICMPF["ICMP Flood"]
    DDOS --> HTTPF["HTTP Request Flood"]
```

## 5. Auto-defense decision and execution flow

Use this on the **Automated Defense Pipeline** slide. The decision diamonds
make it clear that detection does not automatically mean an unrestricted shell
command will run.

```mermaid
%%{init: {"theme":"base","themeVariables":{"primaryColor":"#ffffff","primaryTextColor":"#000000","primaryBorderColor":"#000000","lineColor":"#000000","secondaryColor":"#ffffff","tertiaryColor":"#ffffff","clusterBkg":"#ffffff","clusterBorder":"#000000","fontFamily":"Arial"},"flowchart":{"curve":"linear","htmlLabels":true}}}%%
flowchart TB
    E["Persisted Security Event"] --> ON{"Auto-defense enabled?"}
    ON -->|"No"| STOP["Keep event and alert only"]
    ON -->|"Yes"| TYPE{"Attack type matches?"}
    TYPE -->|"No"| STOP
    TYPE -->|"Yes"| SEV{"Severity matches?"}
    SEV -->|"No"| STOP
    SEV -->|"Yes"| TH{"Threshold reached<br/>inside time window?"}
    TH -->|"No"| COUNT["Update attack counter"]
    TH -->|"Yes"| DUP{"Already actively blocked<br/>on this target?"}
    DUP -->|"Yes"| SKIP["Skip duplicate command"]
    DUP -->|"No"| BUILD["Sanitize IP and build<br/>allowlisted target command"]
    BUILD --> TARGET{"Defense target"}
    TARGET -->|"Web / DNS server"| IPT["Queue Linux iptables command"]
    TARGET -->|"pfSense"| EASY["Queue SSH easyrule command"]
    TARGET -->|"Alert only"| LOG["Queue audit log action"]
    IPT --> CLAIM["Forwarder claims command"]
    EASY --> CLAIM
    LOG --> CLAIM
    CLAIM --> EXEC["Execute with timeout"]
    EXEC --> RESULT{"Exit status"}
    RESULT -->|"Success"| OK["Store executed result<br/>and undo command"]
    RESULT -->|"Failure"| FAIL["Store failed result<br/>and error message"]
```

## Export recommendations

- Export as **SVG** for the clearest PowerPoint text and lines.
- Use a white page/background and black text at presentation time.
- Use 16:9 landscape pages for diagrams 1–3 and 5.
- Diagram 4 can use landscape or a two-column portrait layout.
- Do not shrink a diagram until labels are smaller than the PowerPoint body
  text. Split a dense diagram across two slides instead.
- Add a short caption below each image, for example:
  `Figure 9.1 — AEGIS Layered System Architecture`.
