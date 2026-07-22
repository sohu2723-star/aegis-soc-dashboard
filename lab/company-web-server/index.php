<?php
// ─────────────────────────────────────────────────────────────────────────────
// Golden Myanmar Trading — Staff Portal Login
// INTENTIONALLY VULNERABLE to SQL Injection for cybersecurity lab demo.
// DO NOT deploy in production.
// ─────────────────────────────────────────────────────────────────────────────
require 'db.php';
if (isset($_SESSION['staff_id'])) { header('Location: dashboard.php'); exit; }

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = $_POST['username'];
    $password = $_POST['password'];

    // ── INTENTIONALLY VULNERABLE: No prepared statement — SQLi demo target ──
    // Lab attack: username = ' OR '1'='1  → bypasses authentication
    $sql = "SELECT * FROM staff WHERE username='$username' AND password='$password' AND status='active'";
    $res = $conn->query($sql);

    if ($res && $res->num_rows > 0) {
        $staff = $res->fetch_assoc();
        $_SESSION['staff_id']   = $staff['id'];
        $_SESSION['staff_name'] = $staff['full_name'];
        $_SESSION['staff_role'] = $staff['role'];
        $_SESSION['staff_user'] = $staff['username'];
        header('Location: dashboard.php'); exit;
    } else {
        $error = 'Invalid username or password.';
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Golden Myanmar Trading — Staff Portal</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<div class="auth-wrap">
  <div class="auth-card">
    <div class="logo">
      <h1>⚖️ Golden Myanmar Trading</h1>
      <p>Golden Myanmar Trading Co., Ltd. — Staff Portal</p>
    </div>
    <?php if ($error): ?>
      <div class="alert alert-error"><?= htmlspecialchars($error) ?></div>
    <?php endif; ?>
    <form method="POST" autocomplete="off">
      <div class="form-group">
        <label>Username</label>
        <input name="username" placeholder="staff username" required autocomplete="off">
      </div>
      <div class="form-group">
        <label>Password</label>
        <input name="password" type="password" placeholder="password" required>
      </div>
      <button class="btn" style="width:100%">Sign In</button>
    </form>
  </div>
  <div class="auth-footer">
    &copy; <?= date('Y') ?> Golden Myanmar Trading Co., Ltd. &bull; Internal Use Only
  </div>
</div>
</body>
</html>
