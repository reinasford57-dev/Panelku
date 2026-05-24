const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static(__dirname)); // ← kunci agar index.html terbaca

app.use(session({
  secret: 'panelku-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 24*60*60*1000 }
}));

const DB_PATH = path.join(__dirname, 'Data.json'); // ← perhatikan huruf besar D

function readDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return { products: [], orders: [], users: [] };
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// --- Auth ---
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: 'Username atau password salah' });
  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.json({ message: 'Login berhasil', user: req.session.user });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Logout gagal' });
    res.json({ message: 'Logout berhasil' });
  });
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Belum login' });
  res.json(req.session.user);
});

// --- Produk ---
app.get('/api/products', (req, res) => {
  const db = readDB();
  res.json(db.products);
});

// --- CRUD produk (admin/owner) ---
function checkRole(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Harap login' });
    if (!role.includes(req.session.user.role)) return res.status(403).json({ error: 'Akses ditolak' });
    next();
  };
}

app.post('/api/products', checkRole(['admin', 'owner']), (req, res) => {
  const db = readDB();
  const newProduct = {
    id: Date.now(),
    name: req.body.name,
    category: req.body.category,
    basePrice: req.body.basePrice,
    description: req.body.description,
    levelPrices: req.body.levelPrices || { user: 0, admin: 0, owner: 0 }
  };
  db.products.push(newProduct);
  writeDB(db);
  res.status(201).json(newProduct);
});

app.delete('/api/products/:id', checkRole(['admin', 'owner']), (req, res) => {
  const db = readDB();
  const id = parseInt(req.params.id);
  db.products = db.products.filter(p => p.id !== id);
  writeDB(db);
  res.json({ message: 'Produk dihapus' });
});

// --- Order ---
app.post('/api/orders', (req, res) => {
  const { items, userId } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Pesanan tidak valid' });
  }
  const db = readDB();
  let total = 0;
  const orderItems = [];
  for (const item of items) {
    const product = db.products.find(p => p.id === item.productId);
    if (!product) return res.status(404).json({ error: `Produk ID ${item.productId} tidak ditemukan` });
    const level = item.level || 'user';
    const additional = product.levelPrices[level] || 0;
    const price = product.basePrice + additional;
    total += price * (item.qty || 1);
    orderItems.push({
      productId: product.id,
      name: product.name,
      level,
      price,
      qty: item.qty || 1
    });
  }
  const newOrder = {
    id: Date.now(),
    userId: userId || 'anonymous',
    items: orderItems,
    total,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  db.orders.push(newOrder);
  writeDB(db);
  res.status(201).json({ message: 'Pesanan berhasil dibuat', order: newOrder });
});

app.get('/api/orders', checkRole(['admin', 'owner']), (req, res) => {
  const db = readDB();
  res.json(db.orders);
});

// --- Tambahan: Endpoint dummy untuk pembayaran QR ---
app.post('/api/payment-qr', (req, res) => {
  // Simulasi pembayaran QR (dummy)
  const { orderId } = req.body;
  res.json({
    success: true,
    qrImage: 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=PanelKu-Order-' + orderId,
    message: 'Scan QR untuk menyelesaikan pembayaran'
  });
});

// --- Fallback: kirim index.html untuk semua route yang tidak dikenal ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
