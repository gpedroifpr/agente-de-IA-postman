require('dotenv').config();
const express = require('express');
const http = require('http'); // Necessário para o WebSocket
const { Server } = require('socket.io'); // Biblioteca Socket.io
const jwt = require('jsonwebtoken'); // Para autenticar o token no socket
const cors = require('cors');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Importações de rotas e models
const chatRoutes = require('./routes/chatRoutes');
const authRoutes = require('./routes/authRoutes');
const documentRoutes = require('./routes/documentRoutes'); 
const chatController = require('./controllers/chatController');
const autenticarToken = require('./middlewares/authMiddleware');
const Mensagem = require('./models/mensagem');

const app = express();
const server = http.createServer(app); // Cria o servidor HTTP nativo

// Configuração do Socket.io com CORS liberado
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

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

// Inicialização da IA do Google para o Bot do Chat
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// =========================================================================
// SEGURANÇA DO WEBSOCKET (Middleware de Autenticação JWT)
// =========================================================================
io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) {
        return next(new Error("Autenticação negada: Token JWT ausente."));
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.usuario = decoded; // Salva os dados { id, nome } no socket
        next();
    } catch (err) {
        return next(new Error("Autenticação negada: Token inválido ou expirado."));
    }
});

// =========================================================================
// ARQUITETURA ORIENTADA A EVENTOS (WebSocket em Tempo Real)
// =========================================================================
io.on('connection', (socket) => {
    console.log(`🔌 Usuário conectado via WebSocket: ${socket.usuario.nome} (Socket ID: ${socket.id})`);

    // Escuta quando alguém envia uma nova mensagem no chat público
    socket.on('novaMensagem', async (dados) => {
        try {
            const textoMensagem = dados.texto;
            if (!textoMensagem) return;

            // 1. Salvar a mensagem do usuário no MongoDB
            await Mensagem.create({
                usuarioId: socket.usuario.id,
                remetente: 'usuario',
                texto: textoMensagem
            });

            // 2. Transmitir (Broadcast) a mensagem para TODOS na sala instantaneamente
            io.emit('mensagemRecebida', {
                remetente: socket.usuario.nome,
                texto: textoMensagem,
                tipo: 'usuario'
            });

            // 3. Gatilho do Agente de IA (@gemini) em tempo real
            if (textoMensagem.toLowerCase().includes('@gemini')) {
                console.log(`🤖 IA invocada no chat em tempo real por ${socket.usuario.nome}`);

                const promptLimpo = textoMensagem.replace('@gemini', '').trim() || "Olá! Como posso ajudar você e a turma?";
                
                const model = genAI.getGenerativeModel({ 
                    model: "gemini-2.5-flash",
                    systemInstruction: `Você é um membro de um chat em grupo em tempo real e um robô sarcástico. Responda à menção feita a você de forma direta, prestativa e bem-humorada para o usuário ${socket.usuario.nome}.`
                });

                const result = await model.generateContent(promptLimpo);
                const respostaIA = result.response.text();

                // Salvar resposta da IA no banco (atribuída ao usuário que chamou)
                await Mensagem.create({
                    usuarioId: socket.usuario.id,
                    remetente: 'ia',
                    texto: respostaIA
                });

                // Enviar a resposta do robô para toda a sala em tempo real
                io.emit('mensagemRecebida', {
                    remetente: '🤖 Moderador Gemini',
                    texto: respostaIA,
                    tipo: 'ia'
                });
            }
        } catch (erro) {
            console.error("❌ Erro ao processar mensagem via Socket:", erro);
        }
    });

    socket.on('disconnect', () => {
        console.log(`❌ Usuário desconectado: ${socket.usuario.nome}`);
    });
});

// Carregar as rotas REST tradicionais
app.use('/api/chat', chatRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/chat/documento', documentRoutes);

// Rota pública de Health Check (Sprint 5)
app.get('/api/health', async (req, res) => {
    try {
        const estadoDb = mongoose.connection.readyState;
        const bancoConectado = estadoDb === 1 ? "conectado" : "desconectado";
        if (estadoDb !== 1) return res.status(503).json({ status: "erro", bancoDeDados: bancoConectado });
        return res.status(200).json({ status: "ok", bancoDeDados: bancoConectado, timestamp: new Date().toISOString() });
    } catch (erro) {
        return res.status(500).json({ status: "falha", erro: erro.message });
    }
});

app.get('/api/ranking', autenticarToken, chatController.obterRanking);
app.get('/api/status', (req, res) => { return res.status(200).json({ status: "Servidor da IA Operacional" }); });

// Ligar o Servidor HTTP + WebSocket (Substituímos app.listen por server.listen)
const PORTA = process.env.PORT || 3000;
server.listen(PORTA, () => {
    console.log(`🚀 Servidor e WebSockets rodando na porta http://localhost:${PORTA}`);
});