<?php
// ─────────────────────────────────────────────────────────────────────────────
// Golden Myanmar Trading — Account Management
// ─────────────────────────────────────────────────────────────────────────────
require 'db.php';
if (!isset($_SESSION['staff_id'])) { header('Location: index.php'); exit; }

$error = $success = '';

// Balance adjustment (intentionally no CSRF protection — demo target)
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'])) {
    $acc_no = $conn->real_escape_string($_POST['acc_no']);
    $amount = floatval($_POST['amount']);
    $note   = $conn->real_escape_string($_POST['note'] ?? '');

    if ($_POST['action'] === 'deposit' && $amount > 0) {
        $conn->query("UPDATE accounts SET balance=balance+$amount WHERE acc_no='$acc_no'");
        $conn->query("INSERT INTO transactions (to_acc, amount, description, status)
            VALUES ('$acc_no', '$amount', 'Staff deposit: $note', 'completed')");
        $success = "Deposited " . number_format($amount, 2) . " MMK to account $acc_no.";
    } elseif ($_POST['action'] === 'withdraw' && $amount > 0) {
        $bal = $conn->query("SELECT balance FROM accounts WHERE acc_no='$acc_no'")->fetch_assoc();
        if ($bal && $bal['balance'] >= $amount) {
            $conn->query("UPDATE accounts SET balance=balance-$amount WHERE acc_no='$acc_no'");
            $conn->query("INSERT INTO transactions (from_acc, amount, description, status)
                VALUES ('$acc_no', '$amount', 'Staff withdrawal: $note', 'completed')");
            $success = "Withdrew " . number_format($amount, 2) . " MMK from account $acc_no.";
        } else {
            $error = "Insufficient balance or account not found.";
        }
    }
}

// ── INTENTIONALLY VULNERABLE search ──────────────────────────────────────────
$search = isset($_GET['search']) ? $_GET['search'] : '';
$where  = $search !== '' ? "WHERE a.acc_no LIKE '%$search%' OR c.full_name LIKE '%$search%'" : '';

$accounts = $conn->query(
    "SELECT a.*, c.full_name, c.email
     FROM accounts a
     LEFT JOIN customers c ON c.cust_no = a.cust_no
     $where
     ORDER BY a.id ASC"
);
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Accounts — Golden Myanmar Trading</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<?php include 'nav.php'; ?>
<div class="container">

  <!-- Balance Adjustment -->
  <div class="card" style="max-width:520px">
    <h2>💰 Balance Adjustment</h2>
    <?php if ($error):   ?><div class="alert alert-error"><?= htmlspecialchars($error) ?></div><?php endif; ?>
    <?php if ($success): ?><div class="alert alert-success"><?= htmlspecialchars($success) ?></div><?php endif; ?>
    <form method="POST">
      <div class="form-group">
        <label>Account Number</label>
        <input name="acc_no" placeholder="e.g. GM-2001" required>
      </div>
      <div class="form-group">
        <label>Amount (MMK)</label>
        <input name="amount" type="number" min="1" step="0.01" placeholder="e.g. 500000" required>
      </div>
      <div class="form-group">
        <label>Note</label>
        <input name="note" placeholder="Reason for adjustment">
      </div>
      <div style="display:flex;gap:10px">
        <button class="btn" name="action" value="deposit">＋ Deposit</button>
        <button class="btn btn-danger" name="action" value="withdraw">－ Withdraw</button>
      </div>
    </form>
  </div>

  <!-- Account List -->
  <div class="card">
    <h2>🗂️ All Accounts</h2>
    <form method="GET" style="display:flex;gap:10px;margin-bottom:18px">
      <div class="form-group" style="flex:1;margin:0">
        <input name="search" value="<?= htmlspecialchars($search) ?>" placeholder="Search account no or customer name…">
      </div>
      <button class="btn btn-sm" style="height:42px;padding:0 20px">Search</button>
    </form>
    <?php if ($accounts === false || $accounts->num_rows === 0): ?>
      <p style="color:#6a8470">No accounts found.</p>
    <?php else: ?>
    <table>
      <tr><th>Acc No</th><th>Customer</th><th>Type</th><th>Balance (MMK)</th><th>Status</th><th>Opened</th></tr>
      <?php while ($a = $accounts->fetch_assoc()): ?>
      <tr>
        <td style="color:#d4a017;font-weight:600"><?= htmlspecialchars($a['acc_no']) ?></td>
        <td><?= htmlspecialchars($a['full_name'] ?? '—') ?><br>
          <span style="color:#6a8470;font-size:0.78rem"><?= htmlspecialchars($a['email'] ?? '') ?></span></td>
        <td><span class="badge badge-pending" style="text-transform:capitalize"><?= $a['acc_type'] ?></span></td>
        <td style="font-weight:600;color:<?= $a['balance'] < 10000 ? '#e05050' : '#7dc45a' ?>">
          <?= number_format($a['balance'], 2) ?>
        </td>
        <td><span class="badge badge-<?= $a['status'] === 'active' ? 'active' : ($a['status'] === 'frozen' ? 'frozen' : 'inactive') ?>"><?= $a['status'] ?></span></td>
        <td style="color:#6a8470;font-size:0.82rem"><?= date('d M Y', strtotime($a['created_at'])) ?></td>
      </tr>
      <?php endwhile; ?>
    </table>
    <?php endif; ?>
  </div>

</div>
</body>
</html>
