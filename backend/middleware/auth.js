const jwt = require('jsonwebtoken');

module.exports = function requireAuth(req, res, next) {
    const token = req.cookies.token;   // httpOnly cookie — JS can't read it (XSS-proof)
    if (!token) return res.status(401).json({ error: 'Not logged in' });

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = payload.id;
        next();
    } catch {
        res.clearCookie('token');
        return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
};
