<?php
// Shared navigation bar — include in every page after db.php
$current = basename($_SERVER['PHP_SELF']);
?>
<div class="navbar">
  <div>
    <span class="brand">⚖️ Golden Myanmar Trading
      <span>Staff Portal — <?= htmlspecialchars($_SESSION['staff_role'] ?? 'Staff') ?></span>
    </span>
  </div>
  <nav>
    <a href="dashboard.php"  class="<?= $current==='dashboard.php'  ? 'active' : '' ?>">Dashboard</a>
    <a href="customers.php"  class="<?= $current==='customers.php'  ? 'active' : '' ?>">Customers</a>
    <a href="accounts.php"   class="<?= $current==='accounts.php'   ? 'active' : '' ?>">Accounts</a>
    <a href="products.php"   class="<?= $current==='products.php'   ? 'active' : '' ?>">Products</a>
    <a href="orders.php"     class="<?= $current==='orders.php'     ? 'active' : '' ?>">Orders</a>
    <a href="transactions.php" class="<?= $current==='transactions.php' ? 'active' : '' ?>">Transactions</a>
    <a href="logout.php" style="color:#e05050">Logout</a>
  </nav>
</div>
