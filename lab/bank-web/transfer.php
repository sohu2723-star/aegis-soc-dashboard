<?php
require 'db.php';
if (!isset($_SESSION['user_id'])) { header('Location: index.php'); exit; }

$id   = $_SESSION['user_id'];
$user = $conn->query("SELECT * FROM accounts WHERE id=$id")->fetch_assoc();
$error = $success = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $to_acc = $conn->real_escape_string($_POST['to_acc']);
    $amount = floatval($_POST['amount']);
    $desc   = $conn->real_escape_string($_POST['description']);
    $pin    = $_POST['pin'];

    if ($pin !== $user['pin']) {
        $error = 'Incorrect PIN.';
    } elseif ($amount <= 0) {
        $error = 'Amount must be greater than 0.';
    } elseif ($amount > $user['balance']) {
        $error = 'Insufficient balance.';
    } elseif ($to_acc === $user['acc_no']) {
        $error = 'Cannot transfer to your own account.';
    } else {
        $dest = $conn->query("SELECT * FROM accounts WHERE acc_no='$to_acc' AND status='active'")->fetch_assoc();
        if (!$dest) {
            $error = 'Destination account not found.';
        } else {
            // Deduct sender
            $conn->query("UPDATE accounts SET balance=balance-$amount WHERE id={$user['id']}");
            // Credit receiver
            $conn->query("UPDATE accounts SET balance=balance+$amount WHERE acc_no='$to_acc'");
            // Log transaction
            $conn->query("INSERT INTO transactions (from_acc, to_acc, amount, description, status)
                VALUES ('{$user['acc_no']}','$to_acc','$amount','$desc','completed')");
            $success = "Transfer of " . number_format($amount, 2) . " MMK to $to_acc successful!";
            // Refresh user balance
            $user = $conn->query("SELECT * FROM accounts WHERE id=$id")->fetch_assoc();
        }
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>SecureBank — Transfer</title>
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
    <h2>💸 Transfer Money</h2>
    <p style="color:#7a94b0;font-size:0.85rem;margin-bottom:20px">
      Available Balance: <strong style="color:#4ecca3"><?= number_format($user['balance'], 2) ?> MMK</strong>
    </p>
    <?php if ($error):   ?><div class="alert alert-error"><?= $error ?></div><?php endif; ?>
    <?php if ($success): ?><div class="alert alert-success"><?= $success ?></div><?php endif; ?>
    <form method="POST">
      <div class="form-group">
        <label>Destination Account Number</label>
        <input name="to_acc" placeholder="e.g. 1002" required>
      </div>
      <div class="form-group">
        <label>Amount (MMK)</label>
        <input name="amount" type="number" min="1" step="0.01" placeholder="e.g. 10000" required>
      </div>
      <div class="form-group">
        <label>Description / Note</label>
        <input name="description" placeholder="e.g. Rent payment">
      </div>
      <div class="form-group">
        <label>Confirm PIN</label>
        <input name="pin" type="password" maxlength="4" required>
      </div>
      <button class="btn">Send Transfer</button>
    </form>
  </div>
</div>
</body></html>
