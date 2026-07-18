<?php
// Database connection — reads from env or defaults
define('DB_HOST', getenv('DB_HOST') ?: '10.20.20.20');
define('DB_USER', getenv('DB_USER') ?: 'bankuser');
define('DB_PASS', getenv('DB_PASS') ?: 'bank1234');
define('DB_NAME', getenv('DB_NAME') ?: 'bankdb');

$conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
if ($conn->connect_error) {
    die(json_encode(['error' => 'DB connection failed: ' . $conn->connect_error]));
}
$conn->set_charset('utf8mb4');

session_start();
