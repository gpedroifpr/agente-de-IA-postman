const jwt = require('jsonwebtoken');

const autenticarToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Formato: Bearer <TOKEN>

    if (!token) {
        return res.status(401).json({ erro: "Acesso negado. Token de segurança não fornecido." });
    }

    try {
        const verificado = jwt.verify(token, process.env.JWT_SECRET);
        req.usuario = verificado; // Anexa as informações criptografadas do token (id e nome) à requisição
        next();
    } catch (error) {
        return res.status(401).json({ erro: "Acesso não autorizado. Token inválido ou expirado." });
    }
};

module.exports = autenticarToken;