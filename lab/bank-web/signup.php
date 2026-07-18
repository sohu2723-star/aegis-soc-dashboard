<?php
require 'db.php';
if (isset($_SESSION['user_id'])) { header('Location: dashboard.php'); exit; }

$error = $success = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $name  = $conn->real_escape_string($_POST['full_name']);
    $email = $conn->real_escape_string($_POST['email']);
    $phone = $conn->real_escape_string($_POST['phone']);
    $pin   = $_POST['pin'];
    $pin2  = $_POST['pin2'];
    $type  = $conn->real_escape_string($_POST['acc_type']);

    if ($pin !== $pin2) {
        $error = 'PINs do not match.';
    } elseif (!preg_match('/^\d{4}$/', $pin)) {
        $error = 'PIN must be exactly 4 digits.';
    } else {
        // Generate account number
        $acc_no = rand(100000, 999999);
        $initial = ($type === 'savings') ? 5000 : 0;
        $sql = "INSERT INTO accounts (acc_no, full_name, email, phone, pin, acc_type, balance, status)
                VALUES ('$acc_no','$name','$email','$phone','$pin','$type','$initial','active')";
        if ($conn->query($sql)) {
            $success = "Account created! Your account number: <strong>$acc_no</strong>. Initial balance: <strong>$initial MMK</strong>.";
        } else {
            $error = 'Registration failed: ' . $conn->error;
        }
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>SecureBank — Sign Up</title>
<link rel="stylesheet" href="style.css"></head>
<body>
<div class="auth-wrap">
  <div class="auth-card">
    <h1>🏦 SecureBank</h1>
    <p class="sub">Create a new bank account</p>
    <?php if ($error):   ?><div class="alert alert-error"><?= $error ?></div><?php endif; ?>
    <?php if ($success): ?><div class="alert alert-success"><?= $success ?> <a href="index.php">Login →</a></div><?php endif; ?>
    <?php if (!$success): ?>
    <form method="POST">
      <div class="form-group"><label>Full Name</label><input name="full_name" required></div>
      <div class="form-group"><label>Email</label><input name="email" type="email" required></div>
      <div class="form-group"><label>Phone</label><input name="phone" required></div>
      <div class="form-group">
        <label>Account Type</label>
        <select name="acc_type">
          <option value="savings">Savings (Initial: 5,000 MMK)</option>
          <option value="current">Current (Initial: 0 MMK)</option>
        </select>
      </div>
      <div class="form-group"><label>4-digit PIN</label><input name="pin" type="password" maxlength="4" required></div>
      <div class="form-group"><label>Confirm PIN</label><input name="pin2" type="password" maxlength="4" required></div>
      <button class="btn" style="width:100%">Create Account</button>
    </form>
    <?php endif; ?>
    <div class="switch">Already have an account? <a href="index.php">Login</a></div>
  </div>
</div>
</body></html>
