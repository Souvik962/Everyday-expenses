const router = require('express').Router();
const requireAuth = require('../middleware/auth');
const mongoose = require('mongoose');
const User = require('../models/User');
const Expense = require('../models/Expense');
router.use(requireAuth); // 🔒 every route below requires a valid session

const CATEGORIES = ['Food', 'Transport', 'Shopping', 'Bills', 'Health', 'Entertainment', 'Other'];

router.use((req, res, next) => {
    req.userIdObj = () => new mongoose.Types.ObjectId(req.userId);
    next();
});

// Validate + whitelist expense fields (used by POST and PUT, so a client can never set `user`)
function parseExpense(body) {
    const { amount, category, note, date } = body || {};
    if (typeof amount !== 'number' || !(amount > 0) || amount > 10000000)
        return { error: 'Invalid amount.' };
    if (!CATEGORIES.includes(category)) return { error: 'Invalid category.' };
    const data = { amount, category, note: typeof note === 'string' ? note.trim().slice(0, 200) : '' };
    if (date) {
        const d = new Date(date);
        if (isNaN(d)) return { error: 'Invalid date.' };
        data.date = d;
    }
    return { data };
}

// Month helper: ?month=YYYY-MM (defaults to the current month)
function monthRange(q, now = new Date()) {
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(q || '');
    const y = m ? +m[1] : now.getFullYear(), mo = m ? +m[2] - 1 : now.getMonth();
    return { y, mo, start: new Date(y, mo, 1), end: new Date(y, mo + 1, 1) };
}

// GET /api/expenses/stats — dashboard KPIs
router.get('/stats', async (req, res) => {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const { y, mo, start, end } = monthRange(req.query.month, now);
    const isCur = y === now.getFullYear() && mo === now.getMonth();
    // previous month; for the current month only the same elapsed days, so the comparison is fair
    const pStart = new Date(y, mo - 1, 1);
    const pEnd = isCur ? new Date(Math.min(new Date(y, mo - 1, 1 + now.getDate()), start)) : start;

    const [today, month, prev, user] = await Promise.all([
        Expense.aggregate([
            { $match: { user: req.userIdObj(), date: { $gte: startToday } } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]),
        Expense.aggregate([
            { $match: { user: req.userIdObj(), date: { $gte: start, $lt: end } } },
            { $group: { _id: '$category', total: { $sum: '$amount' } } }
        ]),
        Expense.aggregate([
            { $match: { user: req.userIdObj(), date: { $gte: pStart, $lt: pEnd } } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]),
        User.findById(req.userId)
    ]);
    if (!user) return res.status(401).json({ error: 'Account not found.' });

    const monthTotal = month.reduce((s, c) => s + c.total, 0);
    res.json({
        today: today[0]?.total || 0,
        monthTotal,
        budget: user.monthlyBudget,
        budgetLeft: user.monthlyBudget - monthTotal,
        byCategory: month,
        prevMonthTotal: prev[0]?.total || 0,
        categoryLimits: Object.fromEntries(user.categoryLimits || [])
    });
});

// GET /api/expenses?limit=20 — user's own expenses ONLY
router.get('/', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const filter = { user: req.userIdObj() };
    if (req.query.month) { const { start, end } = monthRange(req.query.month); filter.date = { $gte: start, $lt: end }; }
    const items = await Expense.find(filter).sort('-date').limit(limit);
    res.json({ items });
});

// POST /api/expenses
router.post('/', async (req, res) => {
    const { data, error } = parseExpense(req.body);
    if (error) return res.status(400).json({ error });
    const exp = await Expense.create({ user: req.userIdObj(), ...data });
    res.status(201).json({ expense: exp });
});

// POST /api/expenses/bulk — CSV import (max 100 rows)
router.post('/bulk', async (req, res) => {
    const rows = req.body.items;
    if (!Array.isArray(rows) || !rows.length || rows.length > 100)
        return res.status(400).json({ error: 'Send between 1 and 100 rows.' });
    const docs = [];
    for (const [i, r] of rows.entries()) {
        const { data, error } = parseExpense(r);
        if (error) return res.status(400).json({ error: `Row ${i + 1}: ${error}` });
        docs.push({ user: req.userIdObj(), ...data });
    }
    await Expense.insertMany(docs);
    res.status(201).json({ count: docs.length });
});

// PUT /api/expenses/budget
router.put('/budget', async (req, res) => {
    const b = req.body.monthlyBudget;
    if (typeof b !== 'number' || b < 0 || b > 10000000)
        return res.status(400).json({ error: 'Invalid budget.' });
    await User.findByIdAndUpdate(req.userId, { monthlyBudget: b });
    res.json({ message: 'Budget updated.' });
});

// PUT /api/expenses/limits — per-category monthly limits (must stay above /:id)
router.put('/limits', async (req, res) => {
    const input = req.body.limits;
    if (!input || typeof input !== 'object' || Array.isArray(input))
        return res.status(400).json({ error: 'Invalid limits.' });
    const clean = {};
    for (const [cat, v] of Object.entries(input)) {
        if (!CATEGORIES.includes(cat) || typeof v !== 'number' || v < 0 || v > 10000000)
            return res.status(400).json({ error: `Invalid limit for ${cat}.` });
        clean[cat] = v;
    }
    await User.findByIdAndUpdate(req.userId, { categoryLimits: clean });
    res.json({ categoryLimits: clean });
});

// PUT /api/expenses/:id — can only update OWN expenses, only whitelisted fields
router.put('/:id', async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Expense not found.' });
    const { data, error } = parseExpense(req.body);
    if (error) return res.status(400).json({ error });
    const exp = await Expense.findOneAndUpdate(
        { _id: req.params.id, user: req.userIdObj() }, data, { new: true, runValidators: true });
    if (!exp) return res.status(404).json({ error: 'Expense not found.' });
    res.json({ expense: exp });
});

// DELETE /api/expenses/:id
router.delete('/:id', async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Expense not found.' });
    const exp = await Expense.findOneAndDelete({ _id: req.params.id, user: req.userIdObj() });
    if (!exp) return res.status(404).json({ error: 'Expense not found.' });
    res.json({ message: 'Deleted.' });
});

module.exports = router;