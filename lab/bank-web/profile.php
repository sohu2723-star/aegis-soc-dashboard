<?php
require 'db.php';
if (!isset($_SESSION['user_id'])) { header('Location: index.php'); exit; }

$id   = $_SESSION['user_id'];
$user = $conn->query("SELECT * FROM accounts WHERE id=$id")->fetch_assoc();
$error = $success = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Intentionally reflects input without full sanitization — XSS lab target
    $name  = $_POST['full_name'];
    $email = $_POST['email'];
    $phone = $_POST['phone'];
    $name_s  = $conn->real_escape_string($name);
    $email_s = $conn->real_escape_string($email);
    $phone_s = $conn->real_escape_string($phone);
    $conn->query("UPDATE accounts SET full_name='$name_s', email='$email_s', phone='$phone_s' WHERE id=$id");
    $success = "Profile updated for: $name"; // XSS reflection point
    $user = $conn->query("SELECT * FROM accounts WHERE id=$id")->fetch_assoc();
}
?>
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>SecureBank — Profile</title>
<link rel="stylesheet" href="style.css"></head>
<body>
<div class="navbar">
  <span class="brand">🏦 SecureBank</span>
  <nav>
    <a href="dashboard.php">Dashboard</a>
    <a href="transfer.php">Transfer</a>
    <a href="history.php">History</a>
    <a href="profile.php">Profile</a>
    <a href="logout.php">Logout</a>
  </nav>
</div>
<div class="container">
  <div class="card" style="max-width:520px">
    <h2>👤 My Profile</h2>
    <?php if ($error):   ?><div class="alert alert-error"><?= $error ?></div><?php endif; ?>
    <?php if ($success): ?><div class="alert alert-success"><?= $success ?></div><?php endif; ?>
    <form method="POST">
      <div class="form-group"><label>Full Name</label>
        <input name="full_name" value="<?= htmlspecialchars($user['full_name']) ?>" required></div>
      <div class="form-group"><label>Email</label>
        <input name="email" value="<?= htmlspecialchars($user['email']) ?>"></div>
      <div class="form-group"><label>Phone</label>
        <input name="phone" value="<?= htmlspecialchars($user['phone']) ?>"></div>
      <div class="form-group"><label>Account Number</label>
        <input value="<?= $user['acc_no'] ?>" disabled></div>
      <div class="form-group"><label>Account Type</label>
        <input value="<?= ucfirst($user['acc_type']) ?>" disabled></div>
      <div class="form-group"><label>Member Since</label>
        <input value="<?= date('d M Y', strtotime($user['created_at'])) ?>" disabled></div>
      <button class="btn">Update Profile</button>
    </form>
  </div>
</div>
</body></html>
