<?php
require 'db.php';
if (!isset($_SESSION['user_id'])) { header('Location: index.php'); exit; }

$id   = $_SESSION['user_id'];
$user = $conn->query("SELECT * FROM accounts WHERE id=$id")->fetch_assoc();

$filter = isset($_GET['type']) ? $conn->real_escape_string($_GET['type']) : 'all';
$where  = "WHERE t.from_acc='{$user['acc_no']}' OR t.to_acc='{$user['acc_no']}'";
if ($filter === 'credit') $where = "WHERE t.to_acc='{$user['acc_no']}'";
if ($filter === 'debit')  $where = "WHERE t.from_acc='{$user['acc_no']}'";

$txns = $conn->query("SELECT t.* FROM transactions t $where ORDER BY t.created_at DESC");
?>
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>SecureBank — History</title>
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
  <div class="card">
    <h2>📋 Transaction History</h2>
    <div style="margin-bottom:16px;display:flex;gap:8px">
      <a href="?type=all"><button class="btn btn-sm" style="<?= $filter==='all'?'':'background:#0d2244' ?>">All</button></a>
      <a href="?type=credit"><button class="btn btn-sm" style="<?= $filter==='credit'?'background:#0d3320;color:#4ecca3':'background:#0d2244' ?>">Credits</button></a>
      <a href="?type=debit"><button class="btn btn-sm" style="<?= $filter==='debit'?'background:#33100d;color:#ff6b6b':'background:#0d2244' ?>">Debits</button></a>
    </div>
    <?php if ($txns->num_rows === 0): ?>
      <p style="color:#7a94b0">No transactions found.</p>
    <?php else: ?>
    <table>
      <tr><th>#</th><th>Date & Time</th><th>Description</th><th>From</th><th>To</th><th>Amount</th><th>Status</th></tr>
      <?php while ($t = $txns->fetch_assoc()):
        $isCredit = $t['to_acc'] === $user['acc_no'];
        $sign = $isCredit ? '+' : '-';
      ?>
      <tr>
        <td style="color:#7a94b0"><?= $t['id'] ?></td>
        <td><?= date('d M Y H:i', strtotime($t['created_at'])) ?></td>
        <td><?= htmlspecialchars($t['description']) ?></td>
        <td><?= $t['from_acc'] ?></td>
        <td><?= $t['to_acc'] ?></td>
        <td style="font-weight:600;color:<?= $isCredit ? '#4ecca3' : '#ff6b6b' ?>">
          <?= $sign ?><?= number_format($t['amount'], 2) ?> MMK
        </td>
        <td><span class="badge <?= $isCredit ? 'badge-credit' : 'badge-debit' ?>"><?= $t['status'] ?></span></td>
      </tr>
      <?php endwhile; ?>
    </table>
    <?php endif; ?>
  </div>
</div>
</body></html>
