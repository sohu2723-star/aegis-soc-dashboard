<?php
require 'db.php';
if (!isset($_SESSION['user_id'])) { header('Location: index.php'); exit; }

$id = $_SESSION['user_id'];
$user = $conn->query("SELECT * FROM accounts WHERE id=$id")->fetch_assoc();

// Recent transactions
$txns = $conn->query(
    "SELECT * FROM transactions WHERE from_acc='{$user['acc_no']}' OR to_acc='{$user['acc_no']}'
     ORDER BY created_at DESC LIMIT 5"
);
?>
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>SecureBank — Dashboard</title>
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
  <div class="stat-grid">
    <div class="stat-card">
      <div class="label">Account Number</div>
      <div class="value" style="font-size:1.2rem"><?= $user['acc_no'] ?></div>
    </div>
    <div class="stat-card">
      <div class="label">Balance</div>
      <div class="value green"><?= number_format($user['balance'], 2) ?> MMK</div>
    </div>
    <div class="stat-card">
      <div class="label">Account Type</div>
      <div class="value" style="font-size:1rem;text-transform:capitalize"><?= $user['acc_type'] ?></div>
    </div>
    <div class="stat-card">
      <div class="label">Status</div>
      <div class="value" style="font-size:1rem;color:#4ecca3">● Active</div>
    </div>
  </div>

  <div class="card">
    <h2>Recent Transactions</h2>
    <?php if ($txns->num_rows === 0): ?>
      <p style="color:#7a94b0">No transactions yet.</p>
    <?php else: ?>
    <table>
      <tr><th>Date</th><th>Description</th><th>To / From</th><th>Amount</th><th>Status</th></tr>
      <?php while ($t = $txns->fetch_assoc()):
        $isCredit = $t['to_acc'] === $user['acc_no'];
        $sign = $isCredit ? '+' : '-';
        $cls  = $isCredit ? 'badge-credit' : 'badge-debit';
      ?>
      <tr>
        <td><?= date('d M Y H:i', strtotime($t['created_at'])) ?></td>
        <td><?= htmlspecialchars($t['description']) ?></td>
        <td><?= $isCredit ? $t['from_acc'] : $t['to_acc'] ?></td>
        <td style="color:<?= $isCredit ? '#4ecca3' : '#ff6b6b' ?>">
          <?= $sign ?><?= number_format($t['amount'], 2) ?> MMK
        </td>
        <td><span class="badge <?= $cls ?>"><?= $t['status'] ?></span></td>
      </tr>
      <?php endwhile; ?>
    </table>
    <a href="history.php" style="color:#4da6ff;font-size:0.85rem;display:block;margin-top:12px">View all →</a>
    <?php endif; ?>
  </div>

  <div style="display:flex;gap:12px">
    <a href="transfer.php"><button class="btn">💸 Transfer Money</button></a>
    <a href="history.php"><button class="btn" style="background:#0d2244">📋 Full History</button></a>
  </div>
</div>
</body></html>
