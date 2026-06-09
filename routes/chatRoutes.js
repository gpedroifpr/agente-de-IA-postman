const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');

// Rotas do Chat
router.post('/', chatController.conversar);
router.delete('/limpar', chatController.limparHistorico);

module.exports = router;