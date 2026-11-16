const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const Expense = require('../models/Expense');
const requireAuth = require('../middleware/auth');

// Bruteforce shield: 5 attempts per 10 min on auth
const authLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, max: 5, skipSuccessfulRequests: true,
    message: { error: 'Too many attempts. Please wait 10 minutes.' }
});
router.use(authLimiter);

const cookieOptions = {
    httpOnly: true,   // ⛔ JavaScript cannot access the token (XSS protection)
    secure: process.env.NODE_ENV === 'production', // HTTPS only in prod
    sameSite: 'strict', // ⛔ CSRF protection
    maxAge: 7 * 24 * 60 * 60 * 1000
};

function issueToken(res, id) {
    const secret = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
    const token = jwt.sign({ id }, secret, { expiresIn: process.env.JWT_EXPIRES });
    res.cookie('token', token, cookieOptions);
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !/^\S+@\S+\.\S+$/.test(email || '') || !password || password.length < 8)
            return res.status(400).json({ error: 'Invalid name, email, or password (min 8 chars).' });

        if (await User.findOne({ email }))
            return res.status(409).json({ error: 'Email already registered.' });

        const user = await User.create({ name, email, password });
        issueToken(res, user._id);
        res.status(201).json({ user: { id: user._id, name: user.name, email: user.email } });
    } catch (e) {
        console.error('Signup failed:', e);
        res.status(500).json({ error: 'Signup failed.' });
    }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email }).select('+password');
        if (!user || !(await user.comparePassword(password)))
            return res.status(401).json({ error: 'Wrong email or password.' }); // same msg = no user enumeration

        issueToken(res, user._id);
        res.json({ user: { id: user._id, name: user.name, email: user.email } });
    } catch { res.status(500).json({ error: 'Login failed.' }); }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
    res.clearCookie('token', cookieOptions);
    res.json({ message: 'Logged out.' });
});

const publicUser = (u) => ({ id: u._id, name: u.name, email: u.email, memberSince: u._id.getTimestamp() });

// GET /api/auth/me — profile + lifetime stats
router.get('/me', requireAuth, async (req, res) => {
    const user = await User.findById(req.userId);
    if (!user) return res.status(401).json({ error: 'Account not found.' });
    const agg = await Expense.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(req.userId) } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$amount' } } }
    ]);
    res.json({ user: publicUser(user), stats: { expenseCount: agg[0]?.count || 0, totalSpent: agg[0]?.total || 0 } });
});

// PUT /api/auth/profile — change display name
router.put('/profile', requireAuth, async (req, res) => {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 50) return res.status(400).json({ error: 'Name must be 1 to 50 characters.' });
    const user = await User.findByIdAndUpdate(req.userId, { name }, { new: true });
    res.json({ user: publicUser(user) });
});

// PUT /api/auth/password — needs the current password
router.put('/password', requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 8)
        return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    const user = await User.findById(req.userId).select('+password');
    if (!user || !(await user.comparePassword(currentPassword)))
        return res.status(401).json({ error: 'Current password is wrong.' });
    if (newPassword === currentPassword)
        return res.status(400).json({ error: 'Choose a password different from the current one.' });
    user.password = newPassword; // hashed by the pre-save hook
    await user.save();
    res.json({ message: 'Password updated.' });
});

// DELETE /api/auth/account — removes the user and all their expenses
router.delete('/account', requireAuth, async (req, res) => {
    const user = await User.findById(req.userId).select('+password');
    if (!user || typeof req.body.password !== 'string' || !(await user.comparePassword(req.body.password)))
        return res.status(401).json({ error: 'Password is wrong.' });
    await Expense.deleteMany({ user: user._id });
    await user.deleteOne();
    res.clearCookie('token', cookieOptions);
    res.json({ message: 'Account deleted.' });
});

module.exports = router;