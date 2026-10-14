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

            // 3. Gatilho do Bot (@gemini) com Ferramentas de XP ativas
            if (textoMensagem.toLowerCase().includes('@gemini')) {
                console.log(`🤖 IA acionada no chat por ${socket.usuario.nome}`);

                // Avisa a sala que a IA está digitando...
                io.emit('statusDigitando', { status: true });

                const historicoMsgs = await Mensagem.find({ usuarioId: socket.usuario.id }).sort({ timestamp: 1 }).limit(15);
                const chatHistory = historicoMsgs.map(msg => ({
                    role: msg.remetente === 'usuario' ? 'user' : 'model',
                    parts: [{ text: msg.texto }]
                }));

                const promptLimpo = textoMensagem.replace('@gemini', '').trim() || "Olá!";

                // Ferramenta de XP para o bot do chat conseguir premiar você
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

                const model = genAI.getGenerativeModel({ 
                    model: "gemini-2.5-flash",
                    tools: [{ functionDeclarations: [declaracaoXP] }],
                    systemInstruction: `Você é o Guardião de um cofre de conhecimento e um robô sarcástico atuando como Mestre do Jogo. O jogador atual é "${socket.usuario.nome}". Proponha charadas e desafie-o a responder. Se ele responder corretamente à charada, chame obrigatoriamente a função 'adicionarXP' com 50 pontos. Se ele errar ou desistir, chame com -10 pontos. Nunca revele diretamente o total de XP dele, apenas comente se ganhou ou perdeu pontos de forma sarcástica.`
                });

                const chat = model.startChat({ history: chatHistory });
                let result = await chat.sendMessage(promptLimpo);
                let respostaIA = "";

                const fCalls = typeof result.response.functionCalls === 'function' 
                    ? result.response.functionCalls() 
                    : result.response.functionCalls;
                const call = fCalls && fCalls[0];

                if (call) {
                    let functionResult = null;
                    if (call.name === "adicionarXP") {
                        let jogador = await Jogador.findOne({ nome: socket.usuario.nome });
                        const qtd = call.args.quantidade;
                        if (!jogador) {
                            jogador = await Jogador.create({ nome: socket.usuario.nome, xp: Math.max(0, qtd) });
                        } else {
                            jogador.xp = Math.max(0, jogador.xp + qtd);
                            await jogador.save();
                        }
                        functionResult = { sucesso: true, nome: jogador.nome, xpAtual: jogador.xp };
                    }

                    if (functionResult) {
                        const resultFinal = await chat.sendMessage([{
                            functionResponse: { name: call.name, response: functionResult }
                        }]);
                        respostaIA = resultFinal.response.text();
                    } else {
                        respostaIA = resultFinal.response.text();
                    }
                } else {
                    respostaIA = resultFinal.response.text();
                }

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

app.use('/api/chat', chatRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/chat/documento', documentRoutes);

app.get('/api/health', async (req, res) => {
    return res.status(200).json({ status: "ok", bancoDeDados: "conectado" });
});
app.get('/api/ranking', autenticarToken, chatController.obterRanking);
app.get('/api/status', (req, res) => { return res.status(200).json({ status: "Servidor OK" }); });

const PORTA = process.env.PORT || 3000;
server.listen(PORTA, () => {
    console.log(`🚀 Servidor rodando na porta ${PORTA}`);
});