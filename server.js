require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

// 1. Importação de rotas e middlewares
const chatRoutes = require('./routes/chatRoutes');
const authRoutes = require('./routes/authRoutes');
const documentRoutes = require('./routes/documentRoutes'); 
const chatController = require('./controllers/chatController');
const autenticarToken = require('./middlewares/authMiddleware');

// 2. Inicialização do Express (DEVE VIR ANTES DE QUALQUER app.use)
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// 3. Conectar ao MongoDB Atlas
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error("⚠️ ERRO: Variável MONGO_URI não está definida no arquivo .env!");
    process.exit(1);
}

mongoose.connect(MONGO_URI)
    .then(() => console.log("🍃 Conectado com sucesso ao MongoDB Atlas!"))
    .catch(erro => console.error("❌ Erro ao conectar ao MongoDB:", erro));

// 4. Carregar as rotas modularizadas (Agora o 'app' já existe!)
app.use('/api/chat', chatRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/chat/documento', documentRoutes);

// 5. Rota pública de Health Check (Sprint 5)
app.get('/api/health', async (req, res) => {
    try {
        const estadoDb = mongoose.connection.readyState;
        const bancoConectado = estadoDb === 1 ? "conectado" : "desconectado";

        if (estadoDb !== 1) {
            return res.status(503).json({
                status: "erro",
                bancoDeDados: bancoConectado,
                timestamp: new Date().toISOString()
            });
        }

        return res.status(200).json({
            status: "ok",
            bancoDeDados: bancoConectado,
            timestamp: new Date().toISOString()
        });
    } catch (erro) {
        return res.status(500).json({
            status: "falha",
            erro: erro.message,
            timestamp: new Date().toISOString()
        });
    }
});

// 6. Rota de Ranking Global Protegida
app.get('/api/ranking', autenticarToken, chatController.obterRanking);

// 7. Rota de Status 
app.get('/api/status', (req, res) => {
    return res.status(200).json({ status: "Servidor da IA Operacional" });
});

// 8. Ligar o Servidor
const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => {
    console.log(`🚀 Servidor da IA rodando na porta http://localhost:${PORTA}`);
    console.log(`📡 Rotas ativas na nuvem.`);
});