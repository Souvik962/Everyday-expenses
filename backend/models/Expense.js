const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 0, max: 10000000 },
    category: { type: String, required: true, enum: ['Food', 'Transport', 'Shopping', 'Bills', 'Health', 'Entertainment', 'Other'] },
    note: { type: String, trim: true, maxlength: 200 },
    date: { type: Date, required: true, default: Date.now }
}, { timestamps: true });


module.exports = mongoose.model('Expense', expenseSchema);
