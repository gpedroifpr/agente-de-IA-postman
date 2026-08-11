const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const autenticarToken = require('../middlewares/authMiddleware');
const multer = require('multer');

// Configuração do Multer para guardar o arquivo temporariamente na memória RAM (Fase 2)
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // Limite amigável de 5MB por imagem
});

// Rotas do Chat protegidas com autenticação JWT
router.post('/', autenticarToken, chatController.conversar);
router.post('/vision', autenticarToken, upload.single('imagem'), chatController.conversarMultimodal); // Nova Rota (Fase 3)
router.get('/historico', autenticarToken, chatController.obterHistorico); // Rota de Histórico Rico (Fase 5)
router.delete('/limpar', autenticarToken, chatController.limparHistorico);

module.exports = router;