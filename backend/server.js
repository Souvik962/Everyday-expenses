require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const cookieParser = require('cookie-parser');
const connectDB = require('./config/db');

const app = express();
const mongoSanitizeMiddleware = mongoSanitize();

connectDB();

// ===== SECURITY LAYER =====
app.set('trust proxy', 1);
app.use(helmet());                        // Secure HTTP headers
app.use(hpp());                           // Prevent HTTP param pollution
app.use(express.json({ limit: '10kb' })); // Block oversized payloads
app.use(cookieParser());
app.use((req, res, next) => {
    // Express 5 exposes req.query as a getter; make it writable for the sanitizer.
    Object.defineProperty(req, 'query', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: req.query
    });
    mongoSanitizeMiddleware(req, res, next);
});
app.use(xss());                           // Strips XSS scripts from input

app.use(cors({
    origin: (process.env.CLIENT_URL || '').split(',').map(origin => origin.trim()).filter(Boolean),
    credentials: true
}));
console.log('✅ frontend connected');

// Global rate limit: 100 req / 15 min per IP
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: { error: 'Too many requests. Try again later.' }
}));

// ===== ROUTES =====
app.use('/api/auth', require('./routes/auth'));
app.use('/api/expenses', require('./routes/expenses'));

// 404 + error handler (never leak stack traces)
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));