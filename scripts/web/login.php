<?php
// Company Web Portal — Login Page
// Deploy to: /var/www/html/login.php on company-web-server
session_start();

$error = "";

if ($_SERVER["REQUEST_METHOD"] === "POST") {
    $user = $_POST["username"] ?? "";
    $pass = $_POST["password"] ?? "";
    // Demo credentials — change in production
    if ($user === "admin" && $pass === "company2026") {
        $_SESSION["logged_in"] = true;
        header("Location: /dashboard.php");
        exit;
    } else {
        $error = "Invalid username or password.";
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Company Web Portal — Login</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Arial, sans-serif;
            background: #1a1a2e;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
        }
        .card {
            background: #16213e;
            border: 1px solid #0f3460;
            border-radius: 12px;
            padding: 40px 36px;
            width: 360px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        }
        .logo {
            text-align: center;
            margin-bottom: 28px;
        }
        .logo h1 {
            color: #e94560;
            font-size: 22px;
            letter-spacing: 1px;
        }
        .logo p {
            color: #7f8c8d;
            font-size: 13px;
            margin-top: 4px;
        }
        label {
            display: block;
            color: #bdc3c7;
            font-size: 13px;
            margin-bottom: 6px;
            margin-top: 16px;
        }
        input[type=text], input[type=password] {
            width: 100%;
            padding: 10px 14px;
            background: #0f3460;
            border: 1px solid #1a4a7a;
            border-radius: 6px;
            color: #ecf0f1;
            font-size: 14px;
            outline: none;
            transition: border-color 0.2s;
        }
        input:focus { border-color: #e94560; }
        .btn {
            margin-top: 24px;
            width: 100%;
            padding: 11px;
            background: #e94560;
            color: #fff;
            border: none;
            border-radius: 6px;
            font-size: 15px;
            cursor: pointer;
            letter-spacing: 0.5px;
            transition: background 0.2s;
        }
        .btn:hover { background: #c0392b; }
        .error {
            margin-top: 14px;
            padding: 9px 12px;
            background: rgba(233,69,96,0.15);
            border: 1px solid #e94560;
            border-radius: 6px;
            color: #e94560;
            font-size: 13px;
            text-align: center;
        }
        .footer {
            margin-top: 20px;
            text-align: center;
            color: #4a5568;
            font-size: 11px;
        }
    </style>
</head>
<body>
<div class="card">
    <div class="logo">
        <h1>🏢 Company Portal</h1>
        <p>Secure Internal Web Services</p>
    </div>
    <form method="POST" action="/login.php">
        <label for="username">Username</label>
        <input type="text" id="username" name="username"
               placeholder="Enter username" autocomplete="off" required>

        <label for="password">Password</label>
        <input type="password" id="password" name="password"
               placeholder="Enter password" required>

        <button class="btn" type="submit">Sign In</button>
        <?php if ($error): ?>
        <div class="error"><?= htmlspecialchars($error) ?></div>
        <?php endif; ?>
    </form>
    <div class="footer">
        © 2026 Company Internal Network · Unauthorized access prohibited
    </div>
</div>
</body>
</html>
