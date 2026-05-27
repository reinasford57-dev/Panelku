const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

app.use(session({
  secret: 'welper-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 24*60*60*1000 }
}));

const DB_PATH = path.join(__dirname, 'Data.json');

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

// --- AUTH ENDPOINTS ---
app.use(session({
    secret: 'welper-secret-key',
    resave: true,            // Ubah dari false ke true
    saveUninitialized: true, // Ubah dari false ke true
    cookie: { secure: false, maxAge: 24*60*60*1000 }
}));

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ error: 'Username atau password salah' });

    // Simpan user ke session
    req.session.user = { id: user.id, username: user.username, role: user.role };
    
    // Paksa session disimpan sebelum response dikirim
    req.session.save((err) => {
        if (err) {
            console.error('Session save error:', err);
            return res.status(500).json({ error: 'Gagal menyimpan session' });
        }
        res.json({ message: 'Login berhasil', user: req.session.user });
    });
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

// --- PROTECTED ROUTES ---
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- PRODUCTS (public) ---
app.get('/api/products', (req, res) => {
  const db = readDB();
  res.json(db.products);
});

// --- CRUD PRODUCTS (admin/owner only) ---
function checkRole(roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Harap login' });
    if (!roles.includes(req.session.user.role)) return res.status(403).json({ error: 'Akses ditolak' });
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

// --- ORDERS ---
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

app.get('/api/orders', checkRole(['admin', 'owner', 'reseller']), (req, res) => {
  const db = readDB();
  res.json(db.orders);
});

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});

// --- PAYMENT QRIS ---
const QRCode = require('qrcode');

app.post('/api/payment-qris', async (req, res) => {
    const { orderId, amount } = req.body;
    if (!orderId) {
        return res.status(400).json({ error: 'Order ID diperlukan' });
    }

    // Data QR yang akan discan (bisa diubah sesuai payment gateway)
    const qrData = `WELPER-${orderId}-${amount}`;
    
    try {
        // Generate QR code sebagai data URL (base64 image)
        const qrImage = await QRCode.toDataURL(qrData);
        res.json({
            success: true,
            qrImage: qrImage,
            orderId: orderId,
            amount: amount
        });
    } catch (err) {
        console.error('QR generation error:', err);
        res.status(500).json({ error: 'Gagal membuat QR' });
    }
});
// Endpoint untuk mengambil informasi pembayaran
app.get('/api/payment-info', (req, res) => {
    const db = readDB();
    res.json(db.payment || {});
});
const multer = require('multer'); // npm install multer
const upload = multer({ dest: 'uploads/' });

app.post('/api/upload-proof', upload.single('proof'), async (req, res) => {
    const { orderId } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'File tidak ditemukan' });

    // Simpan file ke folder uploads, dan kirim notifikasi ke Telegram (opsional)
    // Contoh notifikasi ke bot Telegram:
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
        const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
        await bot.sendPhoto(process.env.TELEGRAM_CHAT_ID, file.path, {
            caption: `Bukti transfer untuk order #${orderId}`
        });
    }

    // Update status order menjadi 'waiting_confirmation'
    const db = readDB();
    const order = db.orders.find(o => o.id === orderId);
    if (order) {
        order.status = 'waiting_confirmation';
        writeDB(db);
    }

    res.json({ message: 'Bukti diterima', orderId });
});
