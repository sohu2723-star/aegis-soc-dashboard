-- ============================================================
-- Golden Myanmar Trading Co., Ltd. — Database Setup
-- Run on: company-customer-db VM (10.20.20.10)
-- Engine: MySQL / MariaDB
-- ============================================================

-- Create DB + user
CREATE DATABASE IF NOT EXISTS goldenmyanmardb
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'gmuser'@'%' IDENTIFIED BY 'gm1234';
GRANT ALL PRIVILEGES ON goldenmyanmardb.* TO 'gmuser'@'%';
FLUSH PRIVILEGES;

USE goldenmyanmardb;

-- ── Staff (login credentials — SQLi attack target) ─────────────
CREATE TABLE IF NOT EXISTS staff (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    username   VARCHAR(50)  UNIQUE NOT NULL,
    password   VARCHAR(100) NOT NULL,          -- plaintext for lab demo (SQLi target)
    full_name  VARCHAR(100) NOT NULL,
    role       ENUM('admin','manager','teller','viewer') DEFAULT 'teller',
    email      VARCHAR(120),
    status     ENUM('active','inactive') DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── Customers (PII — data exfiltration demo) ───────────────────
CREATE TABLE IF NOT EXISTS customers (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    cust_no    VARCHAR(20) UNIQUE NOT NULL,
    full_name  VARCHAR(100) NOT NULL,
    nrc_no     VARCHAR(30),                    -- National ID (sensitive)
    email      VARCHAR(120),
    phone      VARCHAR(20),
    address    TEXT,
    status     ENUM('active','inactive','blacklisted') DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── Accounts (financial data) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    cust_no    VARCHAR(20) NOT NULL,
    acc_no     VARCHAR(20) UNIQUE NOT NULL,
    acc_type   ENUM('trading','savings','corporate') DEFAULT 'trading',
    balance    DECIMAL(18,2) DEFAULT 0.00,
    currency   VARCHAR(10) DEFAULT 'MMK',
    status     ENUM('active','frozen','closed') DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cust (cust_no)
);

-- ── Transactions ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    from_acc    VARCHAR(20),
    to_acc      VARCHAR(20),
    amount      DECIMAL(18,2) NOT NULL,
    description VARCHAR(255) DEFAULT '',
    status      ENUM('completed','pending','failed','reversed') DEFAULT 'completed',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_from (from_acc),
    INDEX idx_to   (to_acc)
);

-- ── Products (trading catalog) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    product_code VARCHAR(20) UNIQUE NOT NULL,
    name         VARCHAR(150) NOT NULL,
    category     ENUM('timber','gems','rice','seafood','jade','minerals','other') DEFAULT 'other',
    price        DECIMAL(15,2) DEFAULT 0.00,   -- price per unit in MMK
    stock        INT DEFAULT 0,
    description  TEXT,
    status       ENUM('available','out_of_stock','discontinued') DEFAULT 'available',
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── Orders ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    cust_no      VARCHAR(20) NOT NULL,
    product_code VARCHAR(20) NOT NULL,
    quantity     INT NOT NULL,
    total_amount DECIMAL(18,2) NOT NULL,
    note         TEXT,
    status       ENUM('completed','pending','cancelled') DEFAULT 'completed',
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cust  (cust_no),
    INDEX idx_prod  (product_code)
);


-- ============================================================
-- Seed Data
-- ============================================================

-- ── Staff accounts (login credentials for portal) ──────────────
-- Lab purpose: SQLi bypass demo, credential brute force via Hydra
INSERT IGNORE INTO staff (username, password, full_name, role, email) VALUES
('admin',     'Admin@2024!',  'Ko Zaw Lin (IT Admin)',  'admin',   'admin@goldenmyanmar.trading.com'),
('manager01', 'Manager#2024', 'U Aung Kyaw Zin',        'manager', 'manager@goldenmyanmar.trading.com'),
('teller01',  'teller@123',   'Ma Hnin Wai',            'teller',  'teller01@goldenmyanmar.trading.com'),
('teller02',  'pass1234',     'Ko Pyae Phyo',           'teller',  'teller02@goldenmyanmar.trading.com'),
('viewer01',  'view2024',     'Daw Khin Moe',           'viewer',  'viewer@goldenmyanmar.trading.com');

-- ── Customers ──────────────────────────────────────────────────
INSERT IGNORE INTO customers (cust_no, full_name, nrc_no, email, phone, address) VALUES
('GM-C001', 'U Kyaw Thu',        '12/OuKaMa(N)123456',  'kyawthu@gmail.com',       '09-511-1001', 'No.5, Bogyoke St, Yangon'),
('GM-C002', 'Ma Ei Phyu',        '9/ThaKa(N)654321',    'eiphyu.biz@gmail.com',    '09-511-1002', 'No.12, Merchant St, Mandalay'),
('GM-C003', 'Golden Sun Co',     '7/MaHaNa(P)778899',   'goldensun@corp.mm',       '09-511-1003', 'Bldg B, Industrial Zone, Thilawa'),
('GM-C004', 'Ko Min Khant',      '1/MaNa(N)334455',     'minkhant.trade@mm.com',   '09-511-1004', 'No.34, 38th St, Mandalay'),
('GM-C005', 'Myanmar Gems Ltd',  '12/BaHaNa(P)556677',  'info@myanmargems.com.mm', '09-511-1005', 'Gems Market, Nay Pyi Taw'),
('GM-C006', 'Daw Thandar Oo',    '14/DaGaNa(N)112233',  'thandar.oo@yahoo.com',    '09-511-1006', 'No.7, Inya Rd, Yangon'),
('GM-C007', 'Pacific Timber Co', '5/PaSaNa(P)998877',   'ops@pacifictimber.mm',    '09-511-1007', 'Timber Yard, Bago Region');

-- ── Accounts ───────────────────────────────────────────────────
INSERT IGNORE INTO accounts (cust_no, acc_no, acc_type, balance) VALUES
('GM-C001', 'GM-2001', 'trading',   45000000.00),
('GM-C001', 'GM-2002', 'savings',    8500000.00),
('GM-C002', 'GM-2003', 'trading',   22000000.00),
('GM-C003', 'GM-2004', 'corporate', 150000000.00),
('GM-C004', 'GM-2005', 'trading',    9800000.00),
('GM-C005', 'GM-2006', 'corporate', 320000000.00),
('GM-C006', 'GM-2007', 'savings',    3200000.00),
('GM-C007', 'GM-2008', 'corporate',  88000000.00);

-- ── Products ───────────────────────────────────────────────────
INSERT IGNORE INTO products (product_code, name, category, price, stock, description) VALUES
('GMT-0001', 'Teak Timber Grade A',          'timber',   450000,  200, 'Premium teak, 2m planks, kiln-dried'),
('GMT-0002', 'Teak Timber Grade B',          'timber',   280000,  350, 'Standard grade teak timber'),
('GMT-0003', 'Padauk Timber',                'timber',   320000,  150, 'Padauk hardwood, export quality'),
('GMT-0004', 'Ruby (5ct, Mogok)',            'gems',    1500000,   45, 'Unheated ruby, Mogok origin, GIA cert'),
('GMT-0005', 'Sapphire (3ct, Shan)',         'gems',     780000,   80, 'Blue sapphire, Shan State origin'),
('GMT-0006', 'Imperial Jade (A-grade)',      'jade',    2200000,   20, 'Fei Cui (A-grade), Myanmar origin'),
('GMT-0007', 'Jade Cabochon (B-grade)',      'jade',     350000,   65, 'Treated jade, decorative use'),
('GMT-0008', 'Jasmine Rice (50kg bag)',      'rice',       8500, 5000, 'Premium fragrant rice, Ayeyarwady delta'),
('GMT-0009', 'Long-grain White Rice (50kg)', 'rice',       7200, 8000, 'Export grade long-grain'),
('GMT-0010', 'Dried Shrimp (10kg)',          'seafood',   45000,  800, 'Sun-dried shrimp, Tanintharyi'),
('GMT-0011', 'Dried Fish (20kg)',            'seafood',   28000, 1200, 'Dried hilsa, quality packed'),
('GMT-0012', 'Lead Ore (per ton)',           'minerals', 850000,  100, 'Lead ore concentrate, Kayah State'),
('GMT-0013', 'Zinc Ore (per ton)',           'minerals', 650000,  120, 'Zinc ore concentrate, Shan State');

-- ── Transactions ───────────────────────────────────────────────
INSERT IGNORE INTO transactions (from_acc, to_acc, amount, description, status) VALUES
('GM-2001', 'GM-2004', 9000000,  'Timber supply payment Q2',      'completed'),
('GM-2006', 'GM-2001', 7500000,  'Gems purchase — Ruby batch',     'completed'),
('GM-2008', 'GM-2003', 5600000,  'Teak export advance',            'completed'),
('GM-2004', 'GM-2006', 18000000, 'Corporate settlement Jun-2024',  'completed'),
('GM-2003', 'GM-2007', 800000,   'Commission payment',             'completed'),
('GM-2005', NULL,      350000,   'Staff withdrawal',               'completed'),
(NULL,      'GM-2001', 5000000,  'Initial capital deposit',        'completed'),
('GM-2001', NULL,      1200000,  'Vendor payment — transport',     'completed');

-- ── Orders ─────────────────────────────────────────────────────
INSERT IGNORE INTO orders (cust_no, product_code, quantity, total_amount, note, status) VALUES
('GM-C001', 'GMT-0001', 10, 4500000,  'Urgent teak export to Thailand',   'completed'),
('GM-C003', 'GMT-0008', 100, 850000,  'Rice export batch #1',              'completed'),
('GM-C005', 'GMT-0004', 5,  7500000,  'Ruby lot — Singapore buyer',        'completed'),
('GM-C002', 'GMT-0006', 3,  6600000,  'Jade A-grade for Hong Kong',        'completed'),
('GM-C007', 'GMT-0002', 20, 5600000,  'Grade B teak for construction',     'completed'),
('GM-C004', 'GMT-0012', 2,  1700000,  'Lead ore sample lot',               'pending'),
('GM-C006', 'GMT-0010', 15,  675000,  'Shrimp order for restaurant chain', 'completed');
