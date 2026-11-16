const mongoose = require('mongoose');
mongoose.set('strictQuery', true);
module.exports = async function connectDB() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected');
};
