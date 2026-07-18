-- ============================================================
-- SecureBank Database Setup — run on customer-db VM (MySQL)
-- ============================================================

CREATE DATABASE IF NOT EXISTS bankdb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'bankuser'@'%' IDENTIFIED BY 'bank1234';
GRANT ALL PRIVILEGES ON bankdb.* TO 'bankuser'@'%';
FLUSH PRIVILEGES;

USE bankdb;

-- Accounts table
CREATE TABLE IF NOT EXISTS accounts (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    acc_no     VARCHAR(20)  UNIQUE NOT NULL,
    full_name  VARCHAR(100) NOT NULL,
    email      VARCHAR(120),
    phone      VARCHAR(20),
    pin        VARCHAR(10)  NOT NULL,
    acc_type   ENUM('savings','current') DEFAULT 'savings',
    balance    DECIMAL(15,2) DEFAULT 0.00,
    status     ENUM('active','frozen','closed') DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    from_acc    VARCHAR(20),
    to_acc      VARCHAR(20),
    amount      DECIMAL(15,2),
    description VARCHAR(255) DEFAULT '',
    status      ENUM('completed','pending','failed') DEFAULT 'completed',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sample accounts
INSERT IGNORE INTO accounts (acc_no, full_name, email, phone, pin, acc_type, balance) VALUES
('1001', 'Ko Sithu Aung',     'sithu@securebank.lab',   '09-111-1001', '1234', 'savings', 2500000.00),
('1002', 'Ma Aye Thiri',      'aye@securebank.lab',     '09-111-1002', '5678', 'savings',  850000.00),
('1003', 'U Kyaw Zin',        'kyaw@securebank.lab',    '09-111-1003', '9999', 'current', 7500000.00),
('1004', 'Daw Khin Mar',      'khin@securebank.lab',    '09-111-1004', '4321', 'savings',  320000.00),
('1005', 'Ko Min Thu',        'min@securebank.lab',     '09-111-1005', '0000', 'savings',   15000.00),
('9999', 'admin',             'admin@securebank.lab',   '09-000-0000', 'admin','current',99999999.00);

-- Sample transactions
INSERT IGNORE INTO transactions (from_acc, to_acc, amount, description, status) VALUES
('1003', '1001', 500000,  'Salary payment',      'completed'),
('1001', '1002', 150000,  'Rent transfer',       'completed'),
('1002', '1001',  50000,  'Return borrowed',     'completed'),
('1001', '1004', 200000,  'Loan repayment',      'completed'),
('1003', '1005',  10000,  'Tea money',           'completed');
