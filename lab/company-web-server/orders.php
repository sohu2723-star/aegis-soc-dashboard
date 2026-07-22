<?php
// ─────────────────────────────────────────────────────────────────────────────
// Golden Myanmar Trading — Order Management
// ─────────────────────────────────────────────────────────────────────────────
require 'db.php';
if (!isset($_SESSION['staff_id'])) { header('Location: index.php'); exit; }

$error = $success = '';

// Place new order
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['place_order'])) {
    $cust_no  = $conn->real_escape_string($_POST['cust_no']);
    $prod_code = $conn->real_escape_string($_POST['product_code']);
    $qty      = intval($_POST['quantity']);
    $note     = $conn->real_escape_string($_POST['note'] ?? '');

    $prod = $conn->query("SELECT * FROM products WHERE product_code='$prod_code' AND status='available'")->fetch_assoc();
    $cust = $conn->query("SELECT * FROM customers WHERE cust_no='$cust_no' AND status='active'")->fetch_assoc();

    if (!$prod) $error = 'Product not found or unavailable.';
    elseif (!$cust) $error = 'Customer not found or inactive.';
    elseif ($qty <= 0 || $qty > $prod['stock']) $error = "Invalid quantity. Available stock: {$prod['stock']}.";
    else {
        $total = $prod['price'] * $qty;
        // Check account balance
        $acc = $conn->query("SELECT * FROM accounts WHERE cust_no='$cust_no' AND status='active' ORDER BY balance DESC LIMIT 1")->fetch_assoc();
        if (!$acc || $acc['balance'] < $total) {
            $error = "Insufficient account balance for this order. Required: " . number_format($total, 2) . " MMK.";
        } else {
            $conn->query("INSERT INTO orders (cust_no, product_code, quantity, total_amount, note, status)
                VALUES ('$cust_no','$prod_code','$qty','$total','$note','completed')");
            $conn->query("UPDATE products SET stock=stock-$qty WHERE product_code='$prod_code'");
            $conn->query("UPDATE accounts SET balance=balance-$total WHERE id={$acc['id']}");
            $conn->query("INSERT INTO transactions (from_acc, amount, description, status)
                VALUES ('{$acc['acc_no']}', '$total', 'Order: $prod_code x $qty', 'completed')");
            $success = "Order placed — {$prod['name']} x $qty = " . number_format($total, 2) . " MMK.";
        }
    }
}

// Order list with vulnerable filter
$status_filter = isset($_GET['status']) ? $_GET['status'] : '';
$where = $status_filter ? "WHERE o.status='$status_filter'" : '';

$orders = $conn->query(
    "SELECT o.*, c.full_name, p.name as product_name, p.category
     FROM orders o
     JOIN customers c ON c.cust_no = o.cust_no
     JOIN products p ON p.product_code = o.product_code
     $where
     ORDER BY o.created_at DESC"
);
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Orders — Golden Myanmar Trading</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<?php include 'nav.php'; ?>
<div class="container">

  <!-- Place Order -->
  <div class="card" style="max-width:540px">
    <h2>🛒 Place New Order</h2>
    <?php if ($error):   ?><div class="alert alert-error"><?= htmlspecialchars($error) ?></div><?php endif; ?>
    <?php if ($success): ?><div class="alert alert-success"><?= htmlspecialchars($success) ?></div><?php endif; ?>
    <form method="POST">
      <div class="form-group"><label>Customer No</label><input name="cust_no" placeholder="e.g. GM-C001" required></div>
      <div class="form-group"><label>Product Code</label><input name="product_code" placeholder="e.g. GMT-0001" required></div>
      <div class="form-group"><label>Quantity (units)</label><input name="quantity" type="number" min="1" required></div>
      <div class="form-group"><label>Note</label><input name="note" placeholder="Optional order note"></div>
      <button class="btn btn-gold" name="place_order" value="1">Place Order</button>
    </form>
  </div>

  <!-- Order List -->
  <div class="card">
    <h2>📋 Order History</h2>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <a href="orders.php"><button class="btn btn-sm" style="<?= !$status_filter ? '' : 'background:#0d2217' ?>">All</button></a>
      <a href="?status=completed"><button class="btn btn-sm" style="<?= $status_filter==='completed' ? '' : 'background:#0d2217' ?>">Completed</button></a>
      <a href="?status=pending"><button class="btn btn-sm" style="<?= $status_filter==='pending' ? 'background:#2a1e08;color:#d4a017' : 'background:#0d2217' ?>">Pending</button></a>
      <a href="?status=cancelled"><button class="btn btn-sm" style="<?= $status_filter==='cancelled' ? 'background:#2a0d0d;color:#e05050' : 'background:#0d2217' ?>">Cancelled</button></a>
    </div>
    <?php if ($orders === false || $orders->num_rows === 0): ?>
      <p style="color:#6a8470">No orders found.</p>
    <?php else: ?>
    <table>
      <tr><th>#</th><th>Date</th><th>Customer</th><th>Product</th><th>Category</th><th>Qty</th><th>Total (MMK)</th><th>Status</th></tr>
      <?php while ($o = $orders->fetch_assoc()): ?>
      <tr>
        <td style="color:#6a8470"><?= $o['id'] ?></td>
        <td style="font-size:0.82rem;color:#6a8470"><?= date('d M Y H:i', strtotime($o['created_at'])) ?></td>
        <td><?= htmlspecialchars($o['full_name']) ?></td>
        <td style="font-weight:500"><?= htmlspecialchars($o['product_name']) ?></td>
        <td><span class="badge badge-pending" style="text-transform:capitalize"><?= $o['category'] ?></span></td>
        <td><?= $o['quantity'] ?></td>
        <td style="color:#7dc45a;font-weight:600"><?= number_format($o['total_amount'], 2) ?></td>
        <td><span class="badge badge-<?= $o['status'] === 'completed' ? 'credit' : ($o['status'] === 'pending' ? 'pending' : 'inactive') ?>"><?= $o['status'] ?></span></td>
      </tr>
      <?php endwhile; ?>
    </table>
    <?php endif; ?>
  </div>

</div>
</body>
</html>
