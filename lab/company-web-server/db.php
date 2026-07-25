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
    error_log('AEGIS_DB_CONNECT_FAIL code=' . $conn->connect_errno);
    http_response_code(503);
    exit('Database service is temporarily unavailable. Check Apache error.log and the Web-to-DB/DNS path.');
}
$conn->set_charset('utf8mb4');

session_start();
