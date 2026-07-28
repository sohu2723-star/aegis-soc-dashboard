# AEGIS SOC Poster Generation Prompt

## Recommended workflow

For a text-heavy infographic matching the supplied poster, generate the visual foundation with **Ideogram** or **GPT Image**, then correct the final small text and QR code in **Figma or Canva**. Image models can approximate dense typography, but no image model can reliably guarantee every IP address, technology name, and QR module in one pass.

Use a portrait `2:3` canvas at the highest available quality. Upload the original poster as a composition reference and use the prompt below. Do not ask the model to redesign the layout.

## Copy/paste prompt

```text
Use case: infographic-diagram
Asset type: final-year cybersecurity project presentation poster
Input image: use the uploaded AEGIS poster as the strict composition and visual-style reference.

Create a polished, high-resolution portrait cybersecurity architecture poster that closely preserves the uploaded reference: same section order, dense technical infographic layout, dark navy SOC interface, thin electric-cyan borders, cyan/teal headings, white body text, green internal-zone accents, purple public-zone accents, amber firewall accents, and red attacker/critical accents.

Title (verbatim):
AEGIS
AI-POWERED CYBER ATTACK DETECTION
AND AUTOMATED DEFENSE SYSTEM
DETECT • ANALYZE • RESPOND • DEFEND

Required sections, in this exact order:
1. THE PROBLEM and OUR SOLUTION
2. NETWORK TOPOLOGY
3. DATA COLLECTION & DETECTION PIPELINE
4. COMMAND CENTER DASHBOARD and THREAT MAP (LIVE VIEW)
5. AUTOMATED DEFENSE & RESPONSE WORKFLOW
6. LOGIN PORTAL, DEMO ACCESS (READ-ONLY), TECHNOLOGY STACK, KEY BENEFITS / USE CASES

Network topology labels (verbatim):
Attacker — 192.168.10.99
R1 Router — MikroTik CHR — 10.0.23.1
pfSense — Firewall + Suricata — 10.0.23.2
company-web-server — Apache + Fail2ban — 10.10.10.10
dns-server — BIND9 — 10.10.10.20
company-customer-db — MySQL + Fail2ban — 10.20.20.10
ldap-server — OpenLDAP — 10.20.20.20
AEGIS SOC Dashboard — 10.30.30.10
Telegram — Alert Channel

Technology stack (verbatim):
pfSense • Suricata • MikroTik CHR • Fail2ban • iptables • Apache • BIND9 • OpenLDAP • MySQL • Node.js • Express 5 • PostgreSQL • Drizzle ORM • React 19 • Vite • TypeScript • Tailwind CSS • Server-Sent Events (SSE) • Telegram Bot API

Design requirements:
- crisp, readable typography; no blurred text
- precise thin-line network diagram and consistent server icons
- generous safe margins and aligned panel grid
- realistic scannable-QR placeholder area, but leave the QR itself blank for replacement in Figma/Canva
- professional university presentation quality
- preserve both university logo positions from the reference without altering their shapes
- no extra panels, no invented IP addresses, no fake technologies, no watermark

Avoid: illegible microtext, misspellings, distorted logos, fake QR codes, random glyphs, duplicated nodes, cropped panels, excessive glow, photorealistic people, 3D mockup perspective.
```

## Final-production checklist

1. Replace all model-generated microtext with editable text in Figma or Canva.
2. Generate the demo QR from the real deployed `/demo` URL and place it over the blank QR area.
3. Verify every IP address and technology against the project documentation.
4. Export as PNG at `2048 × 3072` or higher and as PDF for printing.
