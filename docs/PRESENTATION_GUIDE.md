# AEGIS-SecureCompany — Presentation and Viva Guide

> 12–15 minutes + live demo + Q&A. Repository တွင် presentation screenshot မရှိပါ; secret exposure ရှောင်ရန် diagram နှင့် live screen သာသုံးပါ။

## Presentation rules

- Slide တစ်ခုတွင် main idea တစ်ခုသာထားပါ။
- Secret, DB URL, API/private key, token, real credential မပြပါနှင့်။
- Dashboard graph ပြရာတွင် source log နှင့် DB/command result ပါ evidence ပြပါ။
- “100% secure” သို့မဟုတ် “command success = packet blocked” ဟုမပြောပါနှင့်။
- Designated lab target သာစမ်းပြီး production/third-party target မသုံးပါနှင့်။

## Slide deck and speaker notes

### 1 — Title
**Slide:** AEGIS-SecureCompany SOC · Real-Time Detection and Automated Defense · Final Project  
**Say:** Four-server company lab ကို Suricata, Fail2ban, cloud API နဲ့ dashboard ပေါင်းထားပြီး fake event မဟုတ်သော real lab evidence ကို end-to-end ပို့သည့် system ဖြစ်ပါတယ်။

### 2 — Problem
**Slide:** Distributed logs · Slow manual correlation · Unverified blocking risk  
**Say:** Web, DNS, DB, LDAP နဲ့ firewall logs တစ်နေရာစီဖြစ်လို့ incident သိရန်ခက်ပါတယ်။ AEGIS က normalize, persist, visualize လုပ်ပြီး reversible response flow ပေးပါတယ်။

### 3 — Scope
**Slide:** Web `10.10.10.10` · DNS `10.10.10.20` · DB `10.20.20.10` · LDAP `10.20.20.20`  
**Say:** Active server လေးလုံးပဲရှိပါတယ်။ Mail, Cowrie, Incident page နဲ့ encrypted connection log မသုံးပါဘူး။ FTP ရှိရင် Web VM service option သာဖြစ်ပါတယ်။

### 4 — Network architecture
**Slide:** `Attacker → R1 → pfSense/Suricata → DMZ/Internal/MGMT`  
**Say:** R1 က route လုပ်၊ pfSense က segmentation/enforcement လုပ်ပြီး Hub ကို management zone တွင်ထားကာ centralized collection လုပ်ပါတယ်။

### 5 — Software architecture
**Slide:** Vercel React · Render Express · Supabase PostgreSQL · Python Hub  
**Say:** UI, API, persistence ကိုခွဲထားပါတယ်။ Replit က editor သာဖြစ်ပြီး deployment မဟုတ်ပါဘူး။

### 6 — Detection
**Slide:** Suricata network IDS · Fail2ban host action · Apache/BIND/MySQL/slapd/auth logs  
**Say:** Suricata က packet-visible attack သိပေမယ့် application result အားလုံးမသိနိုင်လို့ host evidence နှင့်ပေါင်းပါတယ်။

### 7 — Ingest/API flow
**Slide:** `Log → Parser → Auth POST → Validate → DB → Rule → SSE`  
**Say:** Hub က log အသစ် parse လုပ်၊ key ဖြင့် API ပို့၊ validation ပြီးမှ DB သိမ်းပြီး classification, alert, defense evaluation နဲ့ live broadcast လုပ်ပါတယ်။

### 8 — SSE flow
**Slide:** REST = persisted history · SSE = live notification · reconnect = refetch + continue  
**Say:** Threat Map က DB history အရင်ယူပြီး live SSE ပေါင်းလို့ browser ပြောင်းလည်း persisted events ပြန်ပေါ်ပါတယ်။

### 9 — Classification
**Slide:** Scan/DDoS · Web · DB/DNS/LDAP · SSH/MITM  
**Say:** Sensor wording မတူတာကို normalized category ပြောင်းပြီး rule တွေနဲ့ချိတ်ပါတယ်။ Attacker IP ကို hard-code မထားပါဘူး။

### 10 — Auto-defense
**Slide:** `Event → Rule → Threshold → Per-target queue → Claim → Execute → Verify → Result`  
**Say:** Arbitrary shell တိုက်ရိုက်မပို့ဘဲ sanitized target-specific command ကို atomic claim လုပ်ပြီး execution/verification result ပြန်တင်ပါတယ်။

### 11 — Block/unblock
**Slide:** VM Fail2ban · pfSense WAN table/rule · queued inverse action · traffic retest  
**Say:** DB status တစ်ခုတည်းမလုံလောက်ပါ။ Target jail/table နဲ့ connection retest ပြီးမှ effective ဟုသတ်မှတ်ပါတယ်။

### 12 — Security
**Slide:** Separate credentials · authenticated mutation · sanitization · target allowlist · no secret output  
**Say:** Sensor, agent, browser privileges ကိုခွဲပြီး unknown target local execution ကိုပိတ်ထားပါတယ်။ Audit မှာ presence ပဲပြပါတယ်။

### 13 — Reliability
**Slide:** HTTP retry · SSH reconnect/`tail -F` · DB hydration · stale detection · health endpoint  
**Say:** API down, SSH ပြတ်, log rotate, browser reconnect ကို handle လုပ်ထားပြီး long outage durable spool က future work ဖြစ်ပါတယ်။

### 14 — Live demo
**Slide:** Health → approved Nmap → event/alert → rule/result → target block → unblock  
**Say:** Alert က detection proof ဖြစ်ပြီး target state နဲ့ traffic retest က defense effectiveness proof ဖြစ်ပါတယ်။

### 15 — Result
**Slide:** Centralized persistence · Real-time visibility · Reversible auditable response · Future improvements  
**Say:** Detect မှ verified response ထိ complete architecture ပြထားပြီး next steps က durable spool, RBAC, metrics နဲ့ integration tests ဖြစ်ပါတယ်။

## Safe live-demo checklist

### Before
- Config/credentials ကို operator-only presence check လုပ်ပြီး value မဖော်ပါနှင့်။
- Suricata interface/EVE, Hub SSH, four hosts, pfSense, Render ping, DB health, Vercel proxy စစ်ပါ။
- Sensor stale မရှိကြောင်းနှင့် reversible test rule ရှိကြောင်းစစ်ပါ။

### Sequence
1. Existing count မှတ်ပါ။
2. Approved lab attack တစ်ခုသာ run ပါ။
3. EVE/service log evidence ပြပါ။
4. Secret-free forwarder/API status ပြပါ။
5. Event/Attack Flow update ပြပါ။
6. Defense action/command result ပြပါ။
7. Target state + traffic retest ဖြင့် block verify လုပ်ပါ။
8. Unblock/result/restoration ပြပါ။

### If demo fails
- Fake event မထည့်ပါနှင့်။
- EVE → forwarder → API → DB → SSE hop အလိုက် failure ကိုရှင်းပြပါ။
- Previous persisted row ကို “current live event” ဟုမပြောပါနှင့်။

## Likely viva questions

**Why segmentation?** Trust/broadcast domains ခွဲပြီး Web compromise မှ DB/LDAP lateral access ကို least privilege ဖြင့်ကန့်သတ်ရန်။

**Why Suricata on pfSense?** WAN/inter-zone traffic ဖြတ်သည့် centralized visibility point ဖြစ်လို့ပါ။ Wrong interface ဖြစ်လျှင် traffic မမြင်နိုင်ပါ။

**IDS vs IPS?** IDS detect/alert; IPS prevent/drop. Suricata က IDS telemetry၊ pfSense/Fail2ban flow က enforcement ဖြစ်သည်။

**Suricata detects everything?** မရပါ။ Encryption, missing signatures, wrong interface နှင့် application context မရှိမှုကြောင့် host logs လိုသည်။

**Why separate ingest/admin keys?** Sensor submission နှင့် privileged execution ကို least privilege အရခွဲရန်။

**Duplicate claim prevention?** Per-target row + transaction + row lock + `SKIP LOCKED` + lease/status metadata။

**Why store before SSE?** DB ကို authoritative history ထားရန်; broadcast-first ဖြစ်လျှင် ghost event ဖြစ်နိုင်သည်။

**Browser disconnect?** EventSource reconnects; REST query က DB history ပြန် hydrate လုပ်သည်။

**Why PostgreSQL?** Relational audit relationships, transaction/locking semantics, reporting နှင့် managed SSL DB အတွက်။

**How prove WAN block?** Command result, pfSense table/rule/counter နှင့် traffic retest သုံးခုစစ်ရန်။

**False positives?** source guard, severity/type, threshold/window, priority, suggest mode နှင့် rollback။

**Biggest limitation?** Long outage durable disk spool မရှိသေးခြင်းနှင့် live pfSense effectiveness ကို CI တစ်ခုတည်းဖြင့်မအာမခံနိုင်ခြင်း။

**How scale?** Durable queue, stateless APIs, shared pub/sub, partitioned storage, metrics and RBAC။

## Closing statement

> AEGIS-SecureCompany ရဲ့တန်ဖိုးက dashboard လှပမှုတစ်ခုတည်းမဟုတ်ပါဘူး။ Network နဲ့ host evidence ကို authenticated API နဲ့စု၊ persistent audit trail ထား၊ live visualization ပေးပြီး defense ကို reversible, target-specific, verifiable flow နဲ့လုပ်ထားတာဖြစ်ပါတယ်။
