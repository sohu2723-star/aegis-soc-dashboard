import PptxGenJS from "pptxgenjs";

const ppt = new PptxGenJS();

ppt.layout = "LAYOUT_16x9";
ppt.author = "Mg Si Thu Phyo & Mg Paing Thant Kyaw";
ppt.title = "AEGIS-SecureCompany SOC - Internship Final Presentation";

const CYBER = "1e40af";
const CYBER_LIGHT = "3b82f6";
const CYBER_DARK = "0f172a";
const WHITE = "ffffff";
const GRAY = "94a3b8";

function addTitleSlide(title, subtitle) {
  const slide = ppt.addSlide();
  slide.background = { color: CYBER_DARK };
  slide.addText(title, {
    x: 0.5, y: 2.5, w: 9, h: 1.5,
    fontSize: 36, bold: true, color: WHITE, align: "center"
  });
  slide.addText(subtitle, {
    x: 0.5, y: 4.2, w: 9, h: 1,
    fontSize: 20, color: CYBER_LIGHT, align: "center"
  });
  slide.addText("University of Computer Studies (HPA-AN)", {
    x: 0.5, y: 5.5, w: 9, h: 0.5,
    fontSize: 14, color: GRAY, align: "center"
  });
  return slide;
}

function addSectionSlide(title) {
  const slide = ppt.addSlide();
  slide.background = { color: CYBER };
  slide.addText(title, {
    x: 0.5, y: 3, w: 9, h: 1,
    fontSize: 40, bold: true, color: WHITE, align: "center"
  });
  return slide;
}

function addContentSlide(title, bullets, opts = {}) {
  const slide = ppt.addSlide();
  slide.background = { color: CYBER_DARK };
  slide.addText(title, {
    x: 0.5, y: 0.4, w: 9, h: 0.8,
    fontSize: 28, bold: true, color: WHITE
  });
  slide.addShape(ppt.ShapeType.rect, {
    x: 0.5, y: 1.1, w: 9, h: 0.05, fill: { color: CYBER_LIGHT }
  });
  const textItems = bullets.map(b => ({ text: b, options: { bullet: true, fontSize: 18, color: WHITE, lineSpacingMultiple: 1.3 } }));
  const bulletOpts = {
    x: 0.7, y: 1.3, w: 8.6, h: 5.2,
    ...opts
  };
  slide.addText(textItems, bulletOpts);
  return slide;
}

// Slide 1: Title
addTitleSlide(
  "AEGIS-SecureCompany SOC",
  "Real-Time Cyber Attack Detection & Automated Defense System\nInternship Final Oral Presentation"
);

// Slide 2: Contents
addContentSlide("Presentation Contents", [
  "1. Overview of Internship Site & Responsibilities",
  "2. Challenges & Successes",
  "3. Special Project — AEGIS-SecureCompany SOC Dashboard",
  "   • Problem Statement & Objectives",
  "   • Network Architecture (Public Services Focus)",
  "   • System Architecture & Data Flow",
  "   • Detection, Monitoring & Automated Defense",
  "   • Dashboard Features & Results",
  "   • Advantages, Limitations & Future Work",
  "4. Lessons Learned & Future Plans",
  "5. Conclusion & Q&A"
], { fontSize: 16 });

// Slide 3: Internship Site Overview
addContentSlide("Overview of Internship Site", [
  "Organization: University of Computer Studies (HPA-AN)",
  "Department: Cybersecurity — Group 1 (Sec02 & Sec03)",
  "Internship Type: Company Project-based Internship (2025-2026)",
  "Project Duration: May 2026 – July 2026",
  "Onsite Supervisor: Dr. Htay Htay Yi",
  "",
  "Lab Environment:",
  "• GNS3 network simulation with real security tools (pfSense, Suricata, Fail2ban)",
  "• Cloud-based SOC dashboard (Vercel + Render + Supabase)",
  "• Red Team / Blue Team cyber range for attack-defense simulation"
], { fontSize: 16 });

// Slide 4: Internship Responsibilities
addContentSlide("Internship Responsibilities", [
  "• Designed and deployed a full-stack SOC monitoring platform",
  "• Built network segmentation using pfSense firewall (DMZ / Public zone)",
  "• Configured Suricata IDS and Fail2ban on public-facing servers",
  "• Developed centralized log collection and real-time alerting pipeline",
  "• Implemented automated defense mechanisms with reversible actions",
  "• Created a React-based dashboard for live security event visualization",
  "• Integrated AI-powered threat analysis and Telegram notifications",
  "• Documented system architecture, API specifications, and setup guides",
  "• Conducted controlled attack simulations and defense validation"
], { fontSize: 16 });

// Slide 5: Challenges
addContentSlide("Challenges Experienced", [
  "• Distributed log formats across Suricata, Fail2ban, SSH, and HTTP sensors",
  "• Normalizing heterogeneous security events into a unified data model",
  "• Ensuring defense commands are target-specific and reversible",
  "• Handling API/SSH disconnects and log rotation without data loss",
  "• Preventing secret exposure in client-side dashboard code",
  "• Balancing real-time SSE streaming with persistent audit trails",
  "• Managing dynamic attacker IPs without hard-coding rules",
  "• Coordinating live demo reliability in a virtualized lab environment"
], { fontSize: 16 });

// Slide 6: Successes
addContentSlide("Successes Experienced", [
  "• Successfully deployed a production-ready SOC dashboard on Vercel & Render",
  "• Achieved end-to-end real-time event flow: attack → detect → alert → defend → verify",
  "• Automated IP blocking via iptables and pfSense REST API with audit logging",
  "• Integrated Groq AI for Burmese + English threat analysis and briefings",
  "• Delivered Telegram push notifications for critical security events",
  "• Maintained 100% separation between public DMZ and internal services",
  "• Passed full system readiness review and effectiveness audit",
  "• Created comprehensive documentation and setup guides for reproducibility"
], { fontSize: 16 });

// Slide 7: Special Project - Introduction
addSectionSlide("Special Project");
addContentSlide("AEGIS-SecureCompany SOC Dashboard", [
  "Project Name: AEGIS — AI-Powered Cyber External Attack Detection & Automated Defense System",
  "Type: Full-stack Real-Time SOC Dashboard for GNS3 Lab",
  "Mission: Centralized monitoring, real-time threat detection, and automated response",
  "",
  "Core Concept:",
  "• Traditional security relies on manual monitoring → slow detection & response",
  "• AEGIS combines network IDS (Suricata), host logs, and cloud analytics",
  "• Provides administrators with instant visibility and autonomous defense actions"
], { fontSize: 16 });

// Slide 8: Problem Statement
addContentSlide("Problem Statement", [
  "• Late attack detection — Brute force, web attacks, port scans often missed",
  "• No centralized monitoring — logs scattered across web, DNS, DB, and firewall",
  "• Slow incident response — manual correlation delays containment",
  "• Growing cybersecurity threats — requires scalable, automated solutions",
  "",
  "Impact:",
  "• Delayed response leads to data breaches and service downtime",
  "• Manual processes are error-prone and unsustainable at scale"
], { fontSize: 16 });

// Slide 9: Objectives
addContentSlide("Project Objectives", [
  "1. Secure the network using pfSense firewall with strict zone segmentation",
  "2. Separate public and internal services through DMZ / Internal / MGMT zones",
  "3. Collect and analyze security-related logs from all public sensors",
  "4. Provide a centralized monitoring dashboard with real-time visualization",
  "5. Deliver real-time Telegram alerts when suspicious activities are detected",
  "6. Improve incident response time through continuous monitoring & automation",
  "7. Enable reversible, auditable automated defense actions"
], { fontSize: 16 });

// Slide 10: Network Architecture (Public Focus)
addContentSlide("Network Architecture — Public Services Focus", [
  "Topology: Attacker → Router → pfSense → DMZ (Public Services)",
  "",
  "DMZ Zone (Public-Facing):",
  "• company-web-server (10.10.10.10) — Apache, ModSecurity, Suricata, Fail2ban",
  "• DNS-Server (10.10.10.20) — BIND9, Fail2ban",
  "",
  "pfSense Firewall:",
  "• Stateful packet inspection and network segmentation",
  "• Suricata IDS on WAN interface for packet-level threat detection",
  "• WAN block rules via REST API for automated attacker isolation",
  "",
  "Note: Internal database and management zones are excluded from this public overview per presentation guidelines."
], { fontSize: 16 });

// Slide 11: System Architecture
addContentSlide("System Architecture", [
  "Three-Tier Cloud Architecture:",
  "",
  "1. Frontend (Vercel): React + Vite + TailwindCSS + shadcn/ui",
  "   • Live dashboard with SSE streaming",
  "   • Command Center, Security Events, Incidents, Alerts panels",
  "",
  "2. Backend (Render): Express 5 + TypeScript",
  "   • REST API for ingest, query, defense, and AI analysis",
  "   • Drizzle ORM with PostgreSQL (Supabase)",
  "",
  "3. Collection Agent (AEGIS Hub):",
  "   • SSH-based log tailing from public servers",
  "   • Authenticated event posting to cloud API"
], { fontSize: 16 });

// Slide 12: Data Flow
addContentSlide("End-to-End Data Flow", [
  "Attack Phase: Red Team tools (nmap, sqlmap, hydra, hping3)",
  "  ↓",
  "Detection Phase: Suricata + Fail2ban + native logs on public servers",
  "  ↓",
  "Forwarding Phase: AEGIS Hub parses & authenticates events → POST /api/ingest/*",
  "  ↓",
  "API Server: Validates → Persists to PostgreSQL → Evaluates defense rules",
  "  ↓",
  "Live Dashboard: SSE push for real-time visualization + Telegram alerts"
], { fontSize: 16 });

// Slide 13: Detection & Monitoring
addContentSlide("Detection & Monitoring", [
  "Suricata Network IDS:",
  "• Packet-level inspection for port scans, DDoS, web attacks, exploits",
  "• EVE JSON output with signature matching and flow analysis",
  "",
  "Fail2ban Host-Level Protection:",
  "• SSH brute-force detection and automatic iptables banning",
  "• FTP brute-force and repeated web attack prevention",
  "",
  "Apache / ModSecurity:",
  "• SQL injection, XSS, and OWASP Top 10 attack detection",
  "",
  "Unified Event Normalization:",
  "• All sensor outputs mapped to standardized categories for rule processing"
], { fontSize: 16 });

// Slide 14: Automated Defense
addContentSlide("Automated Defense Pipeline", [
  "Flow: Detect → Validate → Persist → Evaluate → Queue → Claim → Execute → Verify",
  "",
  "Auto-Defense Actions:",
  "• SSH brute-force → iptables DROP on target public server",
  "• Port scan / web attack → iptables DROP + pfSense WAN block",
  "• Critical alerts → Telegram notification to security admin",
  "",
  "Manual Defense (Dashboard):",
  "• Admin can block/unblock any IP from Defense Center",
  "• pfSense REST API integration for persistent WAN blocking",
  "• Full audit log of all defense actions with timestamps"
], { fontSize: 16 });

// Slide 15: Dashboard Features
addContentSlide("Dashboard Features & Results", [
  "Command Center: Live attack volume charts, event counters, threat indicators",
  "Security Events: Real-time feed from all public sensors with severity levels",
  "Incidents: Severity tracking, status updates, and AI-generated analysis",
  "Active Alerts: Triage panel with acknowledge/resolve actions",
  "Network Monitor: Live topology map of DMZ servers with host status",
  "Defense Center: Block/unblock controls, rule management, action audit log",
  "AI Analysis: Groq llama-3.3-70b threat explanations (Burmese + English)",
  "Reports: Auto-scheduled SOC reports delivered via Telegram"
], { fontSize: 16 });

// Slide 16: AI & Reporting
addContentSlide("AI-Powered Intelligence & Reporting", [
  "Groq AI Integration (llama-3.3-70b):",
  "• Per-IP threat analysis and defense recommendations",
  "• Natural language event explanations for non-technical stakeholders",
  "• Bilingual output (Burmese + English) for local context",
  "",
  "Automated Reporting:",
  "• Scheduled SOC summary reports with attack trends",
  "• Telegram delivery for immediate access",
  "• Visual metrics and incident timelines"
], { fontSize: 16 });

// Slide 17: Advantages
addContentSlide("Advantages", [
  "• Early threat detection through multi-sensor correlation",
  "• Quick incident response via automated defense pipeline",
  "• Centralized monitoring eliminates log fragmentation",
  "• Reversible defense actions prevent accidental lockouts",
  "• Real-time visualization supports proactive security decisions",
  "• AI-powered analysis reduces analyst workload",
  "• Network segmentation limits blast radius of compromised public servers",
  "• Comprehensive audit trail for compliance and forensics"
], { fontSize: 16 });

// Slide 18: Limitations
addContentSlide("Limitations", [
  "• Prototype lab environment — not production-hardened",
  "• Limited attack scenario coverage (focused on common web & network attacks)",
  "• Depends on reliable network connectivity between hub and servers",
  "• No durable disk spool for extended API outages",
  "• Single point of failure in hub agent (future: redundant collectors)",
  "• AI analysis depends on external API availability (Groq rate limits)",
  "• pfSense effectiveness verified via single CI check per defense action"
], { fontSize: 16 });

// Slide 19: Lessons Learned
addContentSlide("Lessons Learned & Future Application", [
  "Technical Skills Gained:",
  "• Full-stack TypeScript development (React, Express, PostgreSQL, Drizzle)",
  "• Network security architecture and firewall segmentation design",
  "• SOC operations, incident response, and threat hunting methodologies",
  "",
  "Academic Connections:",
  "• Applied database design, API security, and real-time systems theory",
  "• Bridged classroom networking concepts with practical GNS3 implementation",
  "",
  "Professional Application:",
  "• Experience with cloud deployment, monitoring, and alerting at scale",
  "• Understanding of defense-in-depth and least-privilege principles"
], { fontSize: 16 });

// Slide 20: Future Plans
addContentSlide("Future Plans", [
  "Academic:",
  "• Pursue advanced studies in cybersecurity and AI-powered threat detection",
  "• Research durable message queues and stateless API scaling",
  "",
  "Professional:",
  "• Seek roles as SOC Analyst, Blue Team Engineer, or Security Automation Developer",
  "• Contribute to open-source security monitoring and SIEM projects",
  "",
  "Project Enhancements:",
  "• Implement RBAC (Role-Based Access Control) for multi-user dashboards",
  "• Add durable disk spool for offline resilience",
  "• Expand test coverage with CI/CD integration tests",
  "• Deploy redundant hub agents for high availability"
], { fontSize: 16 });

// Slide 21: Conclusion
addContentSlide("Conclusion", [
  "• AEGIS-SecureCompany successfully demonstrates a complete SOC pipeline",
  "• Real-time detection, centralized monitoring, and automated defense are achievable",
  "• Network segmentation protects internal assets while public sensors provide visibility",
  "• AI integration enhances analyst capabilities with automated threat intelligence",
  "• The project meets all internship objectives and exceeds baseline requirements",
  "",
  "This work bridges academic cybersecurity education with real-world SOC operations."
], { fontSize: 16 });

// Slide 22: Q&A
addTitleSlide("Thank You", "Questions & Answers\n\nMg Si Thu Phyo | Mg Paing Thant Kyaw\nGroup 1 — Cybersecurity\nSupervised by Dr. Htay Htay Yi");

ppt.writeFile({ fileName: "/workspace/2c33d440-f0a4-4552-a5bd-fd4fed60ba40/sessions/agent_bf013c96-7bb4-42bd-bd3b-2ea5bbeb6f50/AEGIS_Internship_Presentation.pptx" });
