require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const chatRoutes = require('./routes/chatRoutes');
const authRoutes = require('./routes/authRoutes');
const documentRoutes = require('./routes/documentRoutes'); 
const chatController = require('./controllers/chatController');
const autenticarToken = require('./middlewares/authMiddleware');
const Mensagem = require('./models/mensagem');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error("⚠️ ERRO: Variável MONGO_URI não está definida no arquivo .env!");
    process.exit(1);
}

mongoose.connect(MONGO_URI)
    .then(() => console.log("🍃 Conectado com sucesso ao MongoDB Atlas!"))
    .catch(erro => console.error("❌ Erro ao conectar ao MongoDB:", erro));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Middleware de Autenticação para o WebSocket
io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error("Autenticação negada: Token ausente."));
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.usuario = decoded;
        next();
    } catch (err) {
        return next(new Error("Autenticação negada: Token inválido."));
    }
});

// Eventos do WebSocket em Tempo Real
io.on('connection', (socket) => {
    console.log(`🔌 Usuário conectado: ${socket.usuario.nome}`);

    socket.on('novaMensagem', async (dados) => {
        try {
            const textoMensagem = dados.texto;
            if (!textoMensagem) return;

            // 1. Salvar mensagem do usuário
            await Mensagem.create({
                usuarioId: socket.usuario.id,
                remetente: 'usuario',
                texto: textoMensagem
            });

            // 2. Broadcast da mensagem humana para a sala
            io.emit('mensagemRecebida', {
                remetente: socket.usuario.nome,
                texto: textoMensagem,
                tipo: 'usuario'
            });

            // 3. Gatilho do Bot (@gemini) - VERSÃO SIMPLIFICADA E BLINDADA
            if (textoMensagem.toLowerCase().includes('@gemini')) {
                console.log(`🤖 IA acionada no chat por ${socket.usuario.nome}`);

                // Avisa a sala que a IA está digitando...
                io.emit('statusDigitando', { status: true });

                const promptLimpo = textoMensagem.replace('@gemini', '').trim() || "Olá!";

                const model = genAI.getGenerativeModel({ 
                    model: "gemini-2.5-flash",
                    systemInstruction: `Você é um membro de um chat em grupo em tempo real e um robô sarcástico. Responda de forma direta, prestativa e bem-humorada para o usuário ${socket.usuario.nome}.`
                });

                // Usa o método simples (sem puxar histórico problemático no socket)
                const result = await model.generateContent(promptLimpo);
                const respostaIA = result.response.text();

                await Mensagem.create({
                    usuarioId: socket.usuario.id,
                    remetente: 'ia',
                    texto: respostaIA
                });

                // Remove o indicador de digitando e envia a resposta
                io.emit('statusDigitando', { status: false });
                io.emit('mensagemRecebida', {
                    remetente: '🤖 Moderador Gemini',
                    texto: respostaIA,
                    tipo: 'ia'
                });
            }
        } catch (err) {
            console.error("Erro no socket:", err);
            io.emit('statusDigitando', { status: false });
        }
    });

    socket.on('disconnect', () => { console.log(`❌ Desconectado: ${socket.usuario.nome}`); });
});

// Rotas tradicionais
app.use('/api/chat', chatRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/chat/documento', documentRoutes);

// Health Check
app.get('/api/health', async (req, res) => {
    return res.status(200).json({ status: "ok", bancoDeDados: "conectado" });
});

// Outras rotas
app.get('/api/ranking', autenticarToken, chatController.obterRanking);
app.get('/api/status', (req, res) => { return res.status(200).json({ status: "Servidor OK" }); });

const PORTA = process.env.PORT || 3000;
server.listen(PORTA, () => {
    console.log(`🚀 Servidor rodando na porta ${PORTA}`);
});