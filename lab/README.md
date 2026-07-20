# AEGIS Lab — Web & DB Setup

## Quick Deploy

### company-web-server VM
```bash
# 1. Install Apache + PHP
sudo apt update && sudo apt install -y apache2 php libapache2-mod-php php-mysql

# 2. Download all files
cd /var/www/html
for f in db.php style.css index.php signup.php dashboard.php transfer.php history.php profile.php logout.php; do
  sudo wget -O $f https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/lab/company-web-server/$f
done

# 3. Start Apache
sudo systemctl enable apache2 && sudo systemctl start apache2
```

### company-customer-db VM
```bash
# 1. Install MySQL
sudo apt update && sudo apt install -y mysql-server

# 2. Download & run setup SQL
wget -O setup.sql https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/lab/company-customer-db/setup.sql
sudo mysql < setup.sql

# 3. Allow remote connections
sudo sed -i 's/bind-address.*/bind-address = 0.0.0.0/' /etc/mysql/mysql.conf.d/mysqld.cnf
sudo systemctl enable mysql && sudo systemctl restart mysql
```

## Attack Targets
- SQLi: Login page (`index.php`) — try `' OR '1'='1' --`
- XSS: Profile page (`profile.php`) — try `<script>alert(1)</script>`
- Brute force: PIN is 4 digits (0000–9999)
- IDOR: Change account ID in URL params
