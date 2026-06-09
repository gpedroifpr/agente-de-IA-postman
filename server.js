require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const chatRoutes = require('./routes/chatRoutes');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Conectar ao MongoDB Atlas
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error("⚠️ ERRO: Variável MONGO_URI não está definida no arquivo .env!");
    process.exit(1);
}

mongoose.connect(MONGO_URI)
    .then(() => console.log("🍃 Conectado com sucesso ao MongoDB Atlas!"))
    .catch(erro => console.error("❌ Erro ao conectar ao MongoDB:", erro));

// Carregar as rotas modularizadas
app.use('/api/chat', chatRoutes);

// Rota de Status (Desafio Extra)
app.get('/api/status', (req, res) => {
    return res.status(200).json({ status: "Servidor da IA Operacional" });
});

// Ligar o Servidor
const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => {
    console.log(`🚀 Servidor da IA rodando na porta http://localhost:${PORTA}`);
    console.log(`📡 Rota disponível: POST http://localhost:${PORTA}/api/chat`);
    console.log(`🔌 Rota de Status: GET http://localhost:${PORTA}/api/status`);
});