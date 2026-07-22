<?php
// ─────────────────────────────────────────────────────────────────────────────
// Golden Myanmar Trading — Staff Dashboard
// ─────────────────────────────────────────────────────────────────────────────
require 'db.php';
if (!isset($_SESSION['staff_id'])) { header('Location: index.php'); exit; }

// Summary counts
$total_customers = $conn->query("SELECT COUNT(*) c FROM customers")->fetch_assoc()['c'];
$total_accounts  = $conn->query("SELECT COUNT(*) c FROM accounts")->fetch_assoc()['c'];
$total_balance   = $conn->query("SELECT SUM(balance) s FROM accounts WHERE status='active'")->fetch_assoc()['s'];
$total_products  = $conn->query("SELECT COUNT(*) c FROM products WHERE status='available'")->fetch_assoc()['c'];
$total_orders    = $conn->query("SELECT COUNT(*) c FROM orders WHERE DATE(created_at)=CURDATE()")->fetch_assoc()['c'];

// Recent transactions
$recent_txn = $conn->query(
    "SELECT t.*, a1.cust_no as s_cust, a2.cust_no as r_cust
     FROM transactions t
     LEFT JOIN accounts a1 ON a1.acc_no = t.from_acc
     LEFT JOIN accounts a2 ON a2.acc_no = t.to_acc
     ORDER BY t.created_at DESC LIMIT 8"
);

// Recent orders
$recent_orders = $conn->query(
    "SELECT o.*, c.full_name, p.name as product_name
     FROM orders o
     JOIN customers c ON c.cust_no = o.cust_no
     JOIN products p ON p.product_code = o.product_code
     ORDER BY o.created_at DESC LIMIT 6"
);
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard — Golden Myanmar Trading</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<?php include 'nav.php'; ?>
<div class="container">

  <!-- KPI Cards -->
  <div class="stat-grid">
    <div class="stat-card">
      <div class="label">Total Customers</div>
      <div class="value"><?= number_format($total_customers) ?></div>
    </div>
    <div class="stat-card">
      <div class="label">Active Accounts</div>
      <div class="value blue"><?= number_format($total_accounts) ?></div>
    </div>
    <div class="stat-card">
      <div class="label">Total Funds (MMK)</div>
      <div class="value green"><?= number_format($total_balance, 0) ?></div>
    </div>
    <div class="stat-card">
      <div class="label">Products Listed</div>
      <div class="value"><?= number_format($total_products) ?></div>
    </div>
    <div class="stat-card">
      <div class="label">Orders Today</div>
      <div class="value"><?= number_format($total_orders) ?></div>
    </div>
    <div class="stat-card">
      <div class="label">Logged In As</div>
      <div class="value" style="font-size:1rem"><?= htmlspecialchars($_SESSION['staff_name']) ?></div>
    </div>
  </div>

  <!-- Recent Transactions -->
  <div class="card">
    <h2>📊 Recent Transactions</h2>
    <?php if ($recent_txn->num_rows === 0): ?>
      <p style="color:#6a8470">No transactions yet.</p>
    <?php else: ?>
    <table>
      <tr><th>Date</th><th>From</th><th>To</th><th>Amount (MMK)</th><th>Description</th><th>Status</th></tr>
      <?php while ($t = $recent_txn->fetch_assoc()):
        $isPos = true; ?>
      <tr>
        <td style="color:#6a8470;font-size:0.82rem"><?= date('d M Y H:i', strtotime($t['created_at'])) ?></td>
        <td><?= htmlspecialchars($t['from_acc'] ?? '—') ?></td>
        <td><?= htmlspecialchars($t['to_acc']   ?? '—') ?></td>
        <td style="font-weight:600;color:#d4a017"><?= number_format($t['amount'], 2) ?></td>
        <td style="color:#8aa890"><?= htmlspecialchars($t['description']) ?></td>
        <td><span class="badge badge-<?= $t['status'] === 'completed' ? 'credit' : 'pending' ?>"><?= $t['status'] ?></span></td>
      </tr>
      <?php endwhile; ?>
    </table>
    <a href="transactions.php" style="color:#d4a017;font-size:0.83rem;display:block;margin-top:12px">View all →</a>
    <?php endif; ?>
  </div>

  <!-- Recent Orders -->
  <div class="card">
    <h2>📦 Recent Orders</h2>
    <?php if ($recent_orders->num_rows === 0): ?>
      <p style="color:#6a8470">No orders yet.</p>
    <?php else: ?>
    <table>
      <tr><th>Date</th><th>Customer</th><th>Product</th><th>Qty</th><th>Total (MMK)</th><th>Status</th></tr>
      <?php while ($o = $recent_orders->fetch_assoc()): ?>
      <tr>
        <td style="color:#6a8470;font-size:0.82rem"><?= date('d M Y', strtotime($o['created_at'])) ?></td>
        <td><?= htmlspecialchars($o['full_name']) ?></td>
        <td><?= htmlspecialchars($o['product_name']) ?></td>
        <td><?= $o['quantity'] ?></td>
        <td style="color:#7dc45a"><?= number_format($o['total_amount'], 2) ?></td>
        <td><span class="badge badge-<?= $o['status'] === 'completed' ? 'credit' : ($o['status'] === 'pending' ? 'pending' : 'inactive') ?>"><?= $o['status'] ?></span></td>
      </tr>
      <?php endwhile; ?>
    </table>
    <a href="orders.php" style="color:#d4a017;font-size:0.83rem;display:block;margin-top:12px">View all →</a>
    <?php endif; ?>
  </div>

</div>
</body>
</html>
