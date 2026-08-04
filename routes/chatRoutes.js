const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const autenticarToken = require('../middlewares/authMiddleware'); // Importação do middleware

// Rotas protegidas com Token JWT
router.post('/', autenticarToken, chatController.conversar);
router.delete('/limpar', autenticarToken, chatController.limparHistorico);

module.exports = router;