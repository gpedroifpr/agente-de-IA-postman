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
const Jogador = require('./models/jogador');

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

// =========================================================================
// FERRAMENTA DE XP (Apenas para o WebSocket)
// =========================================================================
const adicionarXP = async (nickname, quantidade) => {
    try {
        let jogador = await Jogador.findOne({ nome: nickname });
        if (!jogador) {
            jogador = await Jogador.create({ nome: nickname, xp: Math.max(0, quantidade) });
        } else {
            jogador.xp = Math.max(0, jogador.xp + quantidade);
            await jogador.save();
        }
        return { sucesso: true, nome: jogador.nome, xpAtual: jogador.xp };
    } catch (error) {
        return { erro: "Erro ao atualizar XP." };
    }
};

const declaracaoXP = {
    name: "adicionarXP",
    description: "Adiciona ou retira pontos de XP do jogador com base no desempenho dele nas charadas.",
    parameters: {
        type: "OBJECT",
        properties: {
            nickname: { type: "STRING" },
            quantidade: { type: "NUMBER" }
        },
        required: ["nickname", "quantidade"]
    }
};

// =========================================================================
// WEBSOCKET (Chat em Tempo Real)
// =========================================================================
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

            // 2. Broadcast
            io.emit('mensagemRecebida', {
                remetente: socket.usuario.nome,
                texto: textoMensagem,
                tipo: 'usuario'
            });

            // 3. Gatilho do Bot (@gemini) com Function Calling Seguro
            if (textoMensagem.toLowerCase().includes('@gemini')) {
                console.log(`🤖 IA acionada no chat por ${socket.usuario.nome}`);
                io.emit('statusDigitando', { status: true });

                const promptLimpo = textoMensagem.replace('@gemini', '').trim() || "Olá!";

                const model = genAI.getGenerativeModel({ 
                    model: "gemini-2.5-flash",
                    tools: [{ functionDeclarations: [declaracaoXP] }],
                    systemInstruction: `Você é o Guardião de um cofre de conhecimento e um robô sarcástico atuando como Mestre do Jogo. O jogador atual é "${socket.usuario.nome}". Proponha charadas e desafie-o a responder. Se ele responder corretamente à charada, chame obrigatoriamente a função 'adicionarXP' com 50 pontos. Se ele errar ou desistir, chame com -10 pontos. Nunca revele diretamente o total de XP dele, apenas comente se ganhou ou perdeu pontos.`
                });

                // Cria um chat limpo para não quebrar a sincronia do SDK
                const chat = model.startChat();
                let result = await chat.sendMessage(promptLimpo);
                let respostaIA = "";

                // Verifica se a IA decidiu chamar a função de XP
                const fCalls = typeof result.response.functionCalls === 'function' 
                    ? result.response.functionCalls() 
                    : result.response.functionCalls;
                const call = fCalls && fCalls[0];

                if (call) {
                    let functionResult = null;
                    if (call.name === "adicionarXP") {
                        functionResult = await adicionarXP(socket.usuario.nome, call.args.quantidade);
                    }

                    if (functionResult) {
                        const resultFinal = await chat.sendMessage([{
                            functionResponse: { name: call.name, response: functionResult }
                        }]);
                        respostaIA = resultFinal.response.text();
                    } else {
                        respostaIA = result.response.text();
                    }
                } else {
                    respostaIA = result.response.text();
                }

                // 4. Salva a resposta da IA e emite
                await Mensagem.create({
                    usuarioId: socket.usuario.id,
                    remetente: 'ia',
                    texto: respostaIA
                });

                io.emit('statusDigitando', { status: false });
                io.emit('mensagemRecebida', {
                    remetente: '🤖 Moderador Gemini',
                    texto: respostaIA,
                    tipo: 'ia'
                });
            }
        } catch (err) {
            console.error("❌ Erro no socket:", err);
            io.emit('statusDigitando', { status: false });
        }
    });

    socket.on('disconnect', () => { console.log(`❌ Desconectado: ${socket.usuario.nome}`); });
});

// =========================================================================
// ROTAS REST (Express)
// =========================================================================
app.use('/api/chat', chatRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/chat/documento', documentRoutes);

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

const PORTA = process.env.PORT || 3000;
server.listen(PORTA, () => {
    console.log(`🚀 Servidor rodando na porta ${PORTA}`);
});