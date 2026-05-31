const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const TelegramBot = require('node-telegram-bot-api');
const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

app.use(session({
    secret: 'welper-secret-key',
    resave: true,
    saveUninitialized: true,
    cookie: { secure: false, maxAge: 24*60*60*1000 }
}));

const DB_PATH = path.join(__dirname, 'Data.json');

function readDB() {
    try {
        const raw = fs.readFileSync(DB_PATH, 'utf-8');
        return JSON.parse(raw);
    } catch (err) {
        return { products: [], orders: [], users: [], chatIds: {} };
    }
}

function writeDB(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================================
// TELEGRAM BOT
// ============================================================
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN';
if (BOT_TOKEN !== 'YOUR_BOT_TOKEN') {
    const bot = new TelegramBot(BOT_TOKEN, { polling: true });

    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        const username = msg.from.username || msg.from.first_name || 'User';
        const db = readDB();
        if (!db.chatIds) db.chatIds = {};
        db.chatIds[username] = chatId;
        writeDB(db);
        bot.sendMessage(chatId, `Halo ${username}! Silakan upload bukti transfer setelah checkout.`);
    });

    bot.on('photo', async (msg) => {
        const chatId = msg.chat.id;
        const username = msg.from.username || msg.from.first_name || 'User';
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const fileLink = await bot.getFileLink(fileId);
        
        const db = readDB();
        const pendingOrder = db.orders.find(o => o.userId === username && o.status === 'pending');
        if (pendingOrder) {
            pendingOrder.proofImage = fileLink;
            pendingOrder.status = 'proof_uploaded';
            writeDB(db);
            bot.sendMessage(chatId, 'Bukti diterima. Admin akan segera konfirmasi.');
        } else {
            bot.sendMessage(chatId, 'Tidak ada order pending untuk user ini. Silakan checkout terlebih dahulu.');
        }
    });

    bot.onText(/\/confirm (.+)/, async (msg, match) => {
        const orderId = match[1];
        const db = readDB();
        const order = db.orders.find(o => o.id === orderId);
        if (!order) {
            return bot.sendMessage(msg.chat.id, 'Order tidak ditemukan.');
        }

        const chatId = db.chatIds?.[order.userId];
        if (!chatId) {
            return bot.sendMessage(msg.chat.id, 'User belum mengirim /start.');
        }

        const productDetails = order.items.map(item => 
            `${item.name} (${item.level})\n${item.productData || 'Hubungi admin'}`
        ).join('\n\n');

        await bot.sendMessage(chatId, `✅ Pembayaran diterima!\n\nProduk Anda:\n${productDetails}`);

        order.status = 'completed';
        writeDB(db);
        bot.sendMessage(msg.chat.id, 'Produk telah dikirim ke user.');
    });
}

// ============================================================
// AUTH ENDPOINTS
// ============================================================
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ error: 'Username atau password salah' });
    req.session.user = { id: user.id, username: user.username, role: user.role };
    res.json({ user: { username: user.username, role: user.role } });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ message: 'Logout berhasil' });
    });
});

app.get('/api/me', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Belum login' });
    res.json(req.session.user);
});

// ============================================================
// PRODUCT ENDPOINTS
// ============================================================
app.get('/api/products', (req, res) => {
    const db = readDB();
    res.json(db.products);
});

app.post('/api/products', (req, res) => {
    const db = readDB();
    const newProduct = {
        id: Date.now().toString(),
        name: req.body.name,
        category: req.body.category,
        basePrice: req.body.basePrice,
        description: req.body.description,
        productData: req.body.productData || 'Hubungi admin'
    };
    db.products.push(newProduct);
    writeDB(db);
    res.status(201).json(newProduct);
});

app.delete('/api/products/:id', (req, res) => {
    const db = readDB();
    const id = req.params.id;
    db.products = db.products.filter(p => p.id !== id);
    writeDB(db);
    res.json({ message: 'Produk dihapus' });
});

// ============================================================
// ORDER ENDPOINTS
// ============================================================
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
        const price = product.basePrice;
        total += price * (item.qty || 1);
        orderItems.push({
            productId: product.id,
            name: product.name,
            level: item.level || 'user',
            price: price,
            qty: item.qty || 1,
            productData: product.productData || 'Hubungi admin'
        });
    }
    const newOrder = {
        id: Date.now().toString(),
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

app.get('/api/orders', (req, res) => {
    const db = readDB();
    res.json(db.orders);
});

// ============================================================
// PAYMENT INFO
// ============================================================
app.get('/api/payment-info', (req, res) => {
    const db = readDB();
    res.json(db.payment || {});
});

// ============================================================
// SERVER START
// ============================================================
app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
});
