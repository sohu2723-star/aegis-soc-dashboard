<?php
// ─────────────────────────────────────────────────────────────────────────────
// Golden Myanmar Trading — Customer List
// SENSITIVE DATA: Full name, NRC/ID, contact — target for SQL injection data
// exfiltration demo (sqlmap --dump).
// ─────────────────────────────────────────────────────────────────────────────
require 'db.php';
if (!isset($_SESSION['staff_id'])) { header('Location: index.php'); exit; }

// ── INTENTIONALLY VULNERABLE search — no prepared statement ──────────────────
// Lab attack: ?search=' OR '1'='1  OR  sqlmap -u "...?search=1" --dump
$search = isset($_GET['search']) ? $_GET['search'] : '';
$where  = '';
if ($search !== '') {
    // Vulnerable: direct interpolation — for SQLi attack demo
    $where = "WHERE c.full_name LIKE '%$search%'
               OR c.cust_no LIKE '%$search%'
               OR c.nrc_no LIKE '%$search%'";
}

$customers = $conn->query(
    "SELECT c.*, COUNT(a.id) acc_count, SUM(a.balance) total_balance
     FROM customers c
     LEFT JOIN accounts a ON a.cust_no = c.cust_no
     $where
     GROUP BY c.id
     ORDER BY c.id ASC"
);
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Customers — Golden Myanmar Trading</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<?php include 'nav.php'; ?>
<div class="container">

  <div class="card">
    <h2>👥 Customer Directory</h2>

    <!-- Search (vulnerable) -->
    <form method="GET" style="display:flex;gap:10px;margin-bottom:18px">
      <div class="form-group" style="flex:1;margin:0">
        <input name="search" value="<?= htmlspecialchars($search) ?>"
               placeholder="Search by name, customer no, NRC…">
      </div>
      <button class="btn btn-sm" style="height:42px;padding:0 20px">Search</button>
      <?php if ($search): ?>
        <a href="customers.php"><button type="button" class="btn btn-sm" style="height:42px;background:#2a2a10">Clear</button></a>
      <?php endif; ?>
    </form>

    <?php if ($customers === false || $customers->num_rows === 0): ?>
      <p style="color:#6a8470">No customers found.</p>
    <?php else: ?>
    <table>
      <tr>
        <th>Cust No</th><th>Full Name</th><th>NRC / ID</th>
        <th>Email</th><th>Phone</th><th>Accounts</th><th>Total Balance</th><th>Status</th>
      </tr>
      <?php while ($c = $customers->fetch_assoc()): ?>
      <tr>
        <td style="color:#d4a017;font-weight:600"><?= htmlspecialchars($c['cust_no']) ?></td>
        <td><?= htmlspecialchars($c['full_name']) ?></td>
        <td style="color:#8aa890;font-size:0.83rem"><?= htmlspecialchars($c['nrc_no'] ?? '—') ?></td>
        <td style="font-size:0.83rem"><?= htmlspecialchars($c['email'] ?? '—') ?></td>
        <td style="font-size:0.83rem"><?= htmlspecialchars($c['phone'] ?? '—') ?></td>
        <td style="text-align:center"><?= $c['acc_count'] ?></td>
        <td style="color:#7dc45a"><?= number_format($c['total_balance'] ?? 0, 2) ?> MMK</td>
        <td><span class="badge badge-<?= $c['status'] === 'active' ? 'active' : 'inactive' ?>"><?= $c['status'] ?></span></td>
      </tr>
      <?php endwhile; ?>
    </table>
    <?php endif; ?>
  </div>

</div>
</body>
</html>
