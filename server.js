/* =========================================================
   FIELD SHOP PRO — server.js
   Express + JSON "database" + завантаження квитанцій
========================================================= */

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

/* ---------------------------------------------------------
   DEFAULT DATA
--------------------------------------------------------- */

function defaultDB() {
  return {
    settings: {
      shopName: "FIELD SHOP PRO",
      paymentNumber: "0000 0000 0000 0000",
      paymentReceiver: "Отримувач",
      paymentNote: "Після оплати завантажте квитанцію нижче.",
      adminPin: "1234"
    },
    products: [
      {
        id: "p1",
        name: "Кава",
        description: "Приклад дозволеного товару",
        price: 80,
        stock: 20,
        image: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800"
      },
      {
        id: "p2",
        name: "Вода",
        description: "Пляшка питної води",
        price: 30,
        stock: 50,
        image: "https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=800"
      },
      {
        id: "p3",
        name: "Батончик",
        description: "Харчовий батончик",
        price: 45,
        stock: 15,
        image: "https://images.unsplash.com/photo-1621939514649-280e2aa7b9ae?w=800"
      }
    ],
    orders: [],
    history: []
  };
}

/* ---------------------------------------------------------
   SIMPLE FILE DATABASE
--------------------------------------------------------- */

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('Помилка читання бази, використовую значення за замовчуванням:', e);
  }
  const db = defaultDB();
  saveDB(db);
  return db;
}

function saveDB(target) {
  fs.writeFileSync(DB_PATH, JSON.stringify(target, null, 2), 'utf-8');
}

let db = loadDB();

function logHistory(type, description, orderId) {
  db.history.unshift({
    id: 'H-' + Date.now(),
    time: new Date().toISOString(),
    type,
    orderId: orderId || null,
    description
  });
  // не даємо історії рости нескінченно
  if (db.history.length > 500) db.history.length = 500;
}

/* ---------------------------------------------------------
   MIDDLEWARE
--------------------------------------------------------- */

app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(PUBLIC_DIR));

function requireAdmin(req, res, next) {
  const pin = req.header('x-admin-pin');
  if (pin && pin === db.settings.adminPin) return next();
  return res.status(401).json({ error: 'Невірний PIN адміністратора' });
}

/* ---------------------------------------------------------
   MULTER — завантаження електронних квитанцій
--------------------------------------------------------- */

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 10);
    const safeExt = /^[.a-zA-Z0-9]{0,10}$/.test(ext) ? ext : '';
    cb(null, crypto.randomBytes(10).toString('hex') + safeExt);
  }
});

const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'application/pdf'];

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Дозволені формати: JPG, PNG, WEBP, HEIC, PDF'));
  }
});

/* =========================================================
   PRODUCTS
========================================================= */

app.get('/api/products', (req, res) => {
  res.json(db.products);
});

app.post('/api/products', requireAdmin, (req, res) => {
  const { name, description, price, stock, image } = req.body || {};
  if (!name || typeof price !== 'number' || price < 0 || !Number.isInteger(stock) || stock < 0) {
    return res.status(400).json({ error: 'Некоректні дані товару' });
  }
  const product = {
    id: 'p-' + Date.now(),
    name: String(name).trim(),
    description: String(description || '').trim(),
    price,
    stock,
    image: String(image || '').trim()
  };
  db.products.push(product);
  logHistory('PRODUCT_UPDATE', `Додано товар: ${product.name}`);
  saveDB(db);
  res.status(201).json(product);
});

app.put('/api/products/:id', requireAdmin, (req, res) => {
  const p = db.products.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Товар не знайдено' });

  const { name, description, price, stock, image } = req.body || {};
  if (!name || typeof price !== 'number' || price < 0 || !Number.isInteger(stock) || stock < 0) {
    return res.status(400).json({ error: 'Некоректні дані товару' });
  }

  Object.assign(p, {
    name: String(name).trim(),
    description: String(description || '').trim(),
    price,
    stock,
    image: String(image || '').trim()
  });

  logHistory('PRODUCT_UPDATE', `Оновлено товар: ${p.name}`);
  saveDB(db);
  res.json(p);
});

app.delete('/api/products/:id', requireAdmin, (req, res) => {
  const p = db.products.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Товар не знайдено' });

  db.products = db.products.filter(x => x.id !== req.params.id);
  logHistory('PRODUCT_DELETE', `Видалено товар: ${p.name}`);
  saveDB(db);
  res.json({ ok: true });
});

app.post('/api/products/:id/stock', requireAdmin, (req, res) => {
  const p = db.products.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Товар не знайдено' });

  const change = Number(req.body && req.body.change);
  if (!Number.isInteger(change) || change === 0) {
    return res.status(400).json({ error: 'Введіть ціле число, відмінне від нуля' });
  }
  const next = p.stock + change;
  if (next < 0) return res.status(400).json({ error: 'Залишок не може бути менше нуля' });

  p.stock = next;
  logHistory('STOCK_CHANGE', `${p.name}: ${change > 0 ? '+' : ''}${change} шт.`);
  saveDB(db);
  res.json(p);
});

/* =========================================================
   SETTINGS
========================================================= */

app.get('/api/settings', (req, res) => {
  const { adminPin, ...publicSettings } = db.settings;
  res.json(publicSettings);
});

app.get('/api/settings/admin', requireAdmin, (req, res) => {
  res.json(db.settings);
});

app.put('/api/settings', requireAdmin, (req, res) => {
  const { shopName, paymentNumber, paymentReceiver, paymentNote, adminPin } = req.body || {};

  if (adminPin !== undefined && String(adminPin).trim().length < 4) {
    return res.status(400).json({ error: 'PIN має містити щонайменше 4 символи' });
  }

  db.settings.shopName = (shopName && String(shopName).trim()) || db.settings.shopName;
  if (paymentNumber !== undefined) db.settings.paymentNumber = String(paymentNumber).trim();
  if (paymentReceiver !== undefined) db.settings.paymentReceiver = String(paymentReceiver).trim();
  if (paymentNote !== undefined) db.settings.paymentNote = String(paymentNote).trim();
  if (adminPin !== undefined && String(adminPin).trim()) db.settings.adminPin = String(adminPin).trim();

  saveDB(db);
  res.json({ ok: true });
});

app.post('/api/admin/verify', (req, res) => {
  const pin = req.body && req.body.pin;
  res.json({ ok: pin === db.settings.adminPin });
});

/* =========================================================
   ORDERS
========================================================= */

app.get('/api/orders', requireAdmin, (req, res) => {
  res.json(db.orders);
});

app.post('/api/orders', (req, res) => {
  const { items, customer } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Кошик порожній' });
  }
  if (!customer || !customer.firstName || !customer.lastName || !customer.phone) {
    return res.status(400).json({ error: "Заповніть ім'я, прізвище та телефон" });
  }

  // перевірка та збірка позицій замовлення
  const orderItems = [];
  for (const raw of items) {
    const p = db.products.find(x => x.id === raw.productId);
    const qty = Number(raw.qty);
    if (!p) return res.status(400).json({ error: `Товар не знайдено: ${raw.productId}` });
    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ error: `Некоректна кількість для "${p.name}"` });
    }
    if (qty > p.stock) {
      return res.status(400).json({ error: `"${p.name}" недоступний у кількості ${qty} шт.` });
    }
    orderItems.push({ productId: p.id, name: p.name, price: p.price, qty });
  }

  // списання зі складу
  orderItems.forEach(item => {
    const p = db.products.find(x => x.id === item.productId);
    p.stock -= item.qty;
  });

  const order = {
    id: 'ORD-' + Date.now().toString().slice(-7),
    createdAt: new Date().toISOString(),
    customer: {
      firstName: String(customer.firstName).trim(),
      lastName: String(customer.lastName).trim(),
      phone: String(customer.phone).trim(),
      comment: String(customer.comment || '').trim()
    },
    items: orderItems,
    total: orderItems.reduce((sum, i) => sum + i.price * i.qty, 0),
    status: 'new',
    receipt: null
  };

  db.orders.unshift(order);
  logHistory('ORDER_CREATED', `Створено замовлення ${order.id}`, order.id);
  saveDB(db);

  res.status(201).json(order);
});

app.patch('/api/orders/:id/status', requireAdmin, (req, res) => {
  const o = db.orders.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'Замовлення не знайдено' });

  if (o.status === 'new') o.status = 'ready';
  else if (o.status === 'ready') o.status = 'done';

  logHistory('ORDER_STATUS', `Статус ${o.id}: ${o.status}`, o.id);
  saveDB(db);
  res.json(o);
});

app.post('/api/orders/:id/cancel', requireAdmin, (req, res) => {
  const o = db.orders.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'Замовлення не знайдено' });
  if (o.status === 'cancelled') return res.json(o);

  o.items.forEach(item => {
    const p = db.products.find(x => x.id === item.productId);
    if (p) p.stock += item.qty;
  });
  o.status = 'cancelled';

  logHistory('ORDER_CANCEL', `Скасовано ${o.id}, товар повернуто на склад`, o.id);
  saveDB(db);
  res.json(o);
});

/* --- завантаження електронної квитанції для замовлення --- */

app.post('/api/orders/:id/receipt', (req, res) => {
  upload.single('receipt')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Помилка завантаження файлу' });

    const o = db.orders.find(x => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'Замовлення не знайдено' });
    if (!req.file) return res.status(400).json({ error: 'Файл не завантажено' });

    // видаляємо попередню квитанцію, якщо була
    if (o.receipt && o.receipt.filename) {
      const oldPath = path.join(UPLOADS_DIR, o.receipt.filename);
      fs.unlink(oldPath, () => {});
    }

    o.receipt = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      url: `/uploads/${req.file.filename}`,
      uploadedAt: new Date().toISOString()
    };

    logHistory('RECEIPT_UPLOADED', `Квитанцію завантажено для ${o.id}`, o.id);
    saveDB(db);
    res.json(o);
  });
});

/* =========================================================
   EXPORT / IMPORT
========================================================= */

app.get('/api/export', requireAdmin, (req, res) => {
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=field-shop-backup-${new Date().toISOString().slice(0, 10)}.json`
  );
  res.json(db);
});

app.post('/api/import', requireAdmin, (req, res) => {
  const imported = req.body;
  if (!imported || !imported.products || !imported.orders || !imported.settings) {
    return res.status(400).json({ error: 'Невірний формат файлу бази' });
  }
  db = imported;
  if (!Array.isArray(db.history)) db.history = [];
  saveDB(db);
  res.json({ ok: true });
});

/* =========================================================
   START
========================================================= */

app.listen(PORT, () => {
  console.log(`FIELD SHOP PRO запущено:  http://localhost:${PORT}`);
  console.log(`Квитанції зберігаються у: ${UPLOADS_DIR}`);
  console.log(`База даних:               ${DB_PATH}`);
});
