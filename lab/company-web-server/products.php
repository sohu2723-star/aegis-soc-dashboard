<?php
// ─────────────────────────────────────────────────────────────────────────────
// Golden Myanmar Trading — Product Catalog
// ─────────────────────────────────────────────────────────────────────────────
require 'db.php';
if (!isset($_SESSION['staff_id'])) { header('Location: index.php'); exit; }

$error = $success = '';

// Add product
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['add_product'])) {
    $code  = $conn->real_escape_string($_POST['product_code']);
    $name  = $conn->real_escape_string($_POST['name']);
    $cat   = $conn->real_escape_string($_POST['category']);
    $price = floatval($_POST['price']);
    $stock = intval($_POST['stock']);
    $desc  = $conn->real_escape_string($_POST['description']);

    $conn->query("INSERT INTO products (product_code, name, category, price, stock, description, status)
        VALUES ('$code','$name','$cat','$price','$stock','$desc','available')
        ON DUPLICATE KEY UPDATE name='$name', price='$price', stock='$stock'");
    $success = "Product '$name' saved.";
}

// ── Vulnerable search ─────────────────────────────────────────────────────────
$search = isset($_GET['search']) ? $_GET['search'] : '';
$cat_filter = isset($_GET['category']) ? $_GET['category'] : '';
$where_parts = [];
if ($search !== '')     $where_parts[] = "(name LIKE '%$search%' OR product_code LIKE '%$search%')";
if ($cat_filter !== '') $where_parts[] = "category='$cat_filter'";
$where = $where_parts ? 'WHERE ' . implode(' AND ', $where_parts) : '';

$products   = $conn->query("SELECT * FROM products $where ORDER BY category, name ASC");
$categories = $conn->query("SELECT DISTINCT category FROM products ORDER BY category");
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Products — Golden Myanmar Trading</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<?php include 'nav.php'; ?>
<div class="container">

  <!-- Add Product -->
  <div class="card">
    <h2>➕ Add / Update Product</h2>
    <?php if ($error):   ?><div class="alert alert-error"><?= htmlspecialchars($error) ?></div><?php endif; ?>
    <?php if ($success): ?><div class="alert alert-success"><?= htmlspecialchars($success) ?></div><?php endif; ?>
    <form method="POST">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="form-group"><label>Product Code</label><input name="product_code" placeholder="e.g. GMT-0010" required></div>
        <div class="form-group"><label>Product Name</label><input name="name" placeholder="e.g. Teak Timber (Grade A)" required></div>
        <div class="form-group"><label>Category</label>
          <select name="category">
            <option>timber</option><option>gems</option><option>rice</option>
            <option>seafood</option><option>jade</option><option>minerals</option><option>other</option>
          </select>
        </div>
        <div class="form-group"><label>Price per unit (MMK)</label><input name="price" type="number" min="0" step="0.01" required></div>
        <div class="form-group"><label>Stock (units)</label><input name="stock" type="number" min="0" required></div>
        <div class="form-group"><label>Description</label><input name="description" placeholder="Short description"></div>
      </div>
      <button class="btn btn-gold" name="add_product" value="1">Save Product</button>
    </form>
  </div>

  <!-- Product List -->
  <div class="card">
    <h2>📦 Product Catalog</h2>
    <form method="GET" style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap">
      <div class="form-group" style="flex:1;margin:0;min-width:160px">
        <input name="search" value="<?= htmlspecialchars($search) ?>" placeholder="Search products…">
      </div>
      <div class="form-group" style="margin:0;min-width:140px">
        <select name="category">
          <option value="">All categories</option>
          <?php while ($cat = $categories->fetch_assoc()): ?>
            <option value="<?= $cat['category'] ?>" <?= $cat_filter === $cat['category'] ? 'selected' : '' ?>>
              <?= ucfirst($cat['category']) ?>
            </option>
          <?php endwhile; ?>
        </select>
      </div>
      <button class="btn btn-sm" style="height:42px;padding:0 20px">Filter</button>
    </form>

    <?php if ($products === false || $products->num_rows === 0): ?>
      <p style="color:#6a8470">No products found.</p>
    <?php else: ?>
    <table>
      <tr><th>Code</th><th>Name</th><th>Category</th><th>Price (MMK/unit)</th><th>Stock</th><th>Description</th><th>Status</th></tr>
      <?php while ($p = $products->fetch_assoc()): ?>
      <tr>
        <td style="color:#d4a017;font-weight:600"><?= htmlspecialchars($p['product_code']) ?></td>
        <td style="font-weight:500"><?= htmlspecialchars($p['name']) ?></td>
        <td><span class="badge badge-pending" style="text-transform:capitalize"><?= $p['category'] ?></span></td>
        <td style="color:#7dc45a"><?= number_format($p['price'], 2) ?></td>
        <td style="<?= $p['stock'] < 10 ? 'color:#e05050;font-weight:600' : '' ?>"><?= $p['stock'] ?></td>
        <td style="color:#6a8470;font-size:0.82rem"><?= htmlspecialchars($p['description'] ?? '') ?></td>
        <td><span class="badge badge-<?= $p['status'] === 'available' ? 'active' : 'inactive' ?>"><?= $p['status'] ?></span></td>
      </tr>
      <?php endwhile; ?>
    </table>
    <?php endif; ?>
  </div>

</div>
</body>
</html>
