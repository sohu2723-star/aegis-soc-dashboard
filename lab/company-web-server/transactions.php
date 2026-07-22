<?php
// ─────────────────────────────────────────────────────────────────────────────
// Golden Myanmar Trading — Transaction History
// ─────────────────────────────────────────────────────────────────────────────
require 'db.php';
if (!isset($_SESSION['staff_id'])) { header('Location: index.php'); exit; }

// ── Vulnerable filter (no prepared statement) ──────────────────────────────────
$filter = isset($_GET['type']) ? $_GET['type'] : 'all';
$where  = '';
if ($filter === 'credit')  $where = "WHERE t.to_acc IS NOT NULL AND t.from_acc IS NULL";
if ($filter === 'debit')   $where = "WHERE t.from_acc IS NOT NULL AND t.to_acc IS NULL";
if ($filter === 'transfer') $where = "WHERE t.from_acc IS NOT NULL AND t.to_acc IS NOT NULL";

// Account search
$acc_search = isset($_GET['acc']) ? $_GET['acc'] : '';
if ($acc_search !== '') {
    $clause = "t.from_acc='$acc_search' OR t.to_acc='$acc_search'";
    $where  = $where ? "$where AND ($clause)" : "WHERE $clause";
}

$txns = $conn->query(
    "SELECT t.* FROM transactions t $where ORDER BY t.created_at DESC LIMIT 200"
);
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Transactions — Golden Myanmar Trading</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<?php include 'nav.php'; ?>
<div class="container">
  <div class="card">
    <h2>💳 Transaction Ledger</h2>

    <!-- Filters -->
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
      <div style="display:flex;gap:6px">
        <a href="transactions.php"><button class="btn btn-sm" style="<?= $filter==='all' ? '' : 'background:#0d2217' ?>">All</button></a>
        <a href="?type=credit"><button class="btn btn-sm" style="<?= $filter==='credit' ? '' : 'background:#0d2217' ?>">Credits</button></a>
        <a href="?type=debit"><button class="btn btn-sm" style="<?= $filter==='debit' ? 'background:#2a0d0d;color:#e05050' : 'background:#0d2217' ?>">Debits</button></a>
        <a href="?type=transfer"><button class="btn btn-sm" style="<?= $filter==='transfer' ? 'background:#0d1a2a;color:#5aaae0' : 'background:#0d2217' ?>">Transfers</button></a>
      </div>
      <form method="GET" style="display:flex;gap:8px">
        <input type="hidden" name="type" value="<?= htmlspecialchars($filter) ?>">
        <div class="form-group" style="margin:0;min-width:180px">
          <input name="acc" value="<?= htmlspecialchars($acc_search) ?>" placeholder="Filter by account no…">
        </div>
        <button class="btn btn-sm" style="height:42px;padding:0 18px">Go</button>
      </form>
    </div>

    <?php if ($txns === false || $txns->num_rows === 0): ?>
      <p style="color:#6a8470">No transactions found.</p>
    <?php else: ?>
    <table>
      <tr><th>#</th><th>Date & Time</th><th>From Acc</th><th>To Acc</th><th>Amount (MMK)</th><th>Description</th><th>Status</th></tr>
      <?php while ($t = $txns->fetch_assoc()): ?>
      <tr>
        <td style="color:#6a8470"><?= $t['id'] ?></td>
        <td style="font-size:0.82rem;color:#6a8470"><?= date('d M Y H:i', strtotime($t['created_at'])) ?></td>
        <td><?= htmlspecialchars($t['from_acc'] ?? '—') ?></td>
        <td><?= htmlspecialchars($t['to_acc']   ?? '—') ?></td>
        <td style="font-weight:600;color:#d4a017"><?= number_format($t['amount'], 2) ?></td>
        <td style="color:#8aa890;font-size:0.83rem"><?= htmlspecialchars($t['description']) ?></td>
        <td><span class="badge badge-<?= $t['status'] === 'completed' ? 'credit' : 'pending' ?>"><?= $t['status'] ?></span></td>
      </tr>
      <?php endwhile; ?>
    </table>
    <?php endif; ?>
  </div>
</div>
</body>
</html>
