<?php
// ─────────────────────────────────────────────────────────────────────────────
// Golden Myanmar Trading — Database Connection
// Host resolves via internal DNS: db.goldenmyanmar.trading.com → 10.20.20.10
// ─────────────────────────────────────────────────────────────────────────────
define('DB_HOST', getenv('DB_HOST') ?: 'db.goldenmyanmar.trading.com');
define('DB_USER', getenv('DB_USER') ?: 'gmuser');
define('DB_PASS', getenv('DB_PASS') ?: 'gm1234');
define('DB_NAME', getenv('DB_NAME') ?: 'goldenmyanmardb');

$conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
if ($conn->connect_error) {
    die(json_encode(['error' => 'DB connection failed: ' . $conn->connect_error]));
}
$conn->set_charset('utf8mb4');

session_start();
