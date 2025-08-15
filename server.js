const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize SQLite database
const db = new sqlite3.Database('billing.db');

// Create tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT NOT NULL,
        package TEXT NOT NULL,
        amount INTEGER NOT NULL,
        code TEXT UNIQUE,
        username TEXT,
        password TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME
    )`);
});

app.use(express.static('public'));
app.use(express.json());

// Package definitions
const PACKAGES = {
    '1h': { duration: '1h', price: 10, name: '1 Hour' },
    '6h': { duration: '6h', price: 20, name: '6 Hours' },
    '12h': { duration: '12h', price: 30, name: '12 Hours' },
    '1d': { duration: '1d', price: 50, name: '1 Day' }
};

// Generate unique codes
function generateCode() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function generateCredentials() {
    const username = 'user' + Date.now();
    const password = crypto.randomBytes(3).toString('hex');
    return { username, password };
}

// Simple SMS simulation (for testing)
function sendSMS(phone, message) {
    console.log(`SMS to ${phone}: ${message}`);
    return true;
}

// API Routes
app.post('/api/request-access', async (req, res) => {
    const { phone, package } = req.body;
    
    if (!phone || !package || !PACKAGES[package]) {
        return res.status(400).json({ error: 'Invalid request' });
    }
    
    const code = generateCode();
    const { username, password } = generateCredentials();
    const pkg = PACKAGES[package];
    
    // Calculate expiry
    const expiresAt = new Date();
    if (package === '1h') expiresAt.setHours(expiresAt.getHours() + 1);
    else if (package === '6h') expiresAt.setHours(expiresAt.getHours() + 6);
    else if (package === '12h') expiresAt.setHours(expiresAt.getHours() + 12);
    else if (package === '1d') expiresAt.setDate(expiresAt.getDate() + 1);
    
    // Store transaction
    db.run(
        `INSERT INTO transactions (phone, package, amount, code, username, password, expires_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [phone, package, pkg.price, code, username, password, expiresAt.toISOString()],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            // Send SMS with payment instructions
            const message = `WiFi Access Request
Package: ${pkg.name} - KSh ${pkg.price}
Code: ${code}

To pay:
1. Send KSh ${pkg.price} to 0700000000 (M-Pesa)
2. Use code: ${code} to confirm payment
3. You'll receive login details

Valid for 30 minutes.`;
            
            sendSMS(phone, message);
            
            res.json({ 
                success: true, 
                code: code,
                message: 'Payment instructions sent! Check console for SMS.'
            });
        }
    );
});

// Manual payment confirmation
app.post('/api/confirm-payment', (req, res) => {
    const { code, mpesa_ref } = req.body;
    
    db.get('SELECT * FROM transactions WHERE code = ? AND status = "pending"', [code], (err, row) => {
        if (err || !row) {
            return res.status(400).json({ error: 'Invalid code or already used' });
        }
        
        // Mark as paid
        db.run('UPDATE transactions SET status = "paid" WHERE code = ?', [code], (err) => {
            if (err) {
                return res.status(500).json({ error: 'Update failed' });
            }
            
            // Send login credentials
            const message = `Payment confirmed!
WiFi Login:
Username: ${row.username}
Password: ${row.password}
Valid until: ${new Date(row.expires_at).toLocaleString()}

Connect to "FreeWiFi-Packages" and use these details.`;
            
            sendSMS(row.phone, message);
            
            res.json({ 
                success: true,
                username: row.username,
                password: row.password,
                message: 'Check console for login details!'
            });
        });
    });
});

// Admin interface
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/transactions', (req, res) => {
    db.all('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 100', (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(rows);
    });
});

app.listen(PORT, () => {
    console.log(`🚀 WiFi Billing System running on port ${PORT}`);
    console.log(`📱 Open: http://localhost:${PORT}`);
    console.log(`👨‍💻 Admin: http://localhost:${PORT}/admin`);
});