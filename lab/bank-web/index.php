<?php
require 'db.php';
if (isset($_SESSION['user_id'])) { header('Location: dashboard.php'); exit; }

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $acc = $_POST['acc_no'];
    $pin = $_POST['pin'];
    // Intentionally vulnerable to SQLi for lab practice
    $sql = "SELECT * FROM accounts WHERE acc_no='$acc' AND pin='$pin' AND status='active'";
    $res = $conn->query($sql);
    if ($res && $res->num_rows > 0) {
        $user = $res->fetch_assoc();
        $_SESSION['user_id']  = $user['id'];
        $_SESSION['user_name']= $user['full_name'];
        $_SESSION['acc_no']   = $user['acc_no'];
        header('Location: dashboard.php'); exit;
    } else {
        $error = 'Invalid account number or PIN.';
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>SecureBank — Login</title>
<link rel="stylesheet" href="style.css"></head>
<body>
<div class="auth-wrap">
  <div class="auth-card">
    <h1>🏦 SecureBank</h1>
    <p class="sub">Online Banking Portal — Login to continue</p>
    <?php if ($error): ?><div class="alert alert-error"><?= $error ?></div><?php endif; ?>
    <form method="POST">
      <div class="form-group">
        <label>Account Number</label>
        <input name="acc_no" placeholder="e.g. 1001" required>
      </div>
      <div class="form-group">
        <label>PIN</label>
        <input name="pin" type="password" placeholder="4-digit PIN" required>
      </div>
      <button class="btn" style="width:100%">Login</button>
    </form>
    <div class="switch">Don't have an account? <a href="signup.php">Sign Up</a></div>
  </div>
</div>
</body></html>
