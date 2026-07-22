; ─────────────────────────────────────────────────────────────────────────────
; BIND9 Zone File — goldenmyanmar.trading.com
; Place at: /etc/bind/db.goldenmyanmar.trading.com
; DNS Server VM: 10.10.10.20 (company-dns-server)
; ─────────────────────────────────────────────────────────────────────────────
$TTL 604800
@   IN  SOA  company-dns-server.goldenmyanmar.trading.com. admin.goldenmyanmar.trading.com. (
              3         ; Serial (increment after every change)
              604800    ; Refresh  (7 days)
              86400     ; Retry    (1 day)
              2419200   ; Expire   (28 days)
              604800 )  ; Negative Cache TTL (7 days)

; ── Name servers ─────────────────────────────────────────────────────────────
@                       IN  NS   company-dns-server.goldenmyanmar.trading.com.

; ── SOA / DNS server itself ───────────────────────────────────────────────────
@                       IN  A    10.10.10.20
company-dns-server      IN  A    10.10.10.20

; ── DMZ (Public Services — VLAN 10) ──────────────────────────────────────────
web                     IN  A    10.10.10.10   ; web.goldenmyanmar.trading.com
www                     IN  CNAME web           ; www → web alias
company-web-server      IN  A    10.10.10.10   ; hostname alias

; ── Internal Services (VLAN 20) ──────────────────────────────────────────────
db                      IN  A    10.20.20.10   ; db.goldenmyanmar.trading.com (MySQL)
company-customer-db     IN  A    10.20.20.10   ; hostname alias
ldap                    IN  A    10.20.20.20   ; ldap.goldenmyanmar.trading.com (OpenLDAP)
company-ldap-server     IN  A    10.20.20.20   ; hostname alias

; ── Management (VLAN 30) ─────────────────────────────────────────────────────
aegis                   IN  A    10.30.30.10   ; aegis.goldenmyanmar.trading.com
aegis-company-admin     IN  A    10.30.30.10   ; hostname alias
pfsense                 IN  A    10.30.30.1    ; pfsense.goldenmyanmar.trading.com

; ── Mail (future — for phishing/SMTP relay demo) ─────────────────────────────
; mail                  IN  A    10.10.10.30   ; uncomment when mail server is added
; @                     IN  MX 10 mail.goldenmyanmar.trading.com.
