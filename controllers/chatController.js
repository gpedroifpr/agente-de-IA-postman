const { GoogleGenerativeAI } = require("@google/generative-ai");
const Mensagem = require("../models/mensagem");
const Jogador = require("../models/jogador");
const cloudinary = require('cloudinary').v2;

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

// Configuração do Object Storage Cloudinary (Fase 1)
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Função auxiliar para fazer o upload do buffer da imagem para o Cloudinary (Fase 2)
const uploadToCloudinary = (fileBuffer) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder: "agente-ia-multimodal" },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );
        stream.end(fileBuffer);
    });
};

// =========================================================================
// ROTA MULTIMODAL (POST /api/chat/vision) - (Fase 3)
// =========================================================================
const conversarMultimodal = async (req, res) => {
    try {
        const { pergunta } = req.body;
        const nickname = req.usuario.nome; // Resgata o nome seguro do Token JWT

        // Critério: Tratamento de Arquivo ausente
        if (!req.file) {
            return res.status(400).json({ erro: "Você precisa enviar um arquivo de imagem." });
        }

        // Critério: Tratamento de Formato de arquivos não suportados
        const formatosSuportados = ["image/jpeg", "image/png", "image/webp", "image/gif"];
        if (!formatosSuportados.includes(req.file.mimetype)) {
            return res.status(400).json({ erro: "Formato de arquivo inválido. Envie apenas imagens (JPEG, PNG, WEBP, GIF)." });
        }

        console.log(`👁️ [Jogador: ${nickname}] enviou uma imagem para análise.`);

        // 1. Upload do buffer de imagem para o Cloudinary permanentemente (Object Storage)
        const uploadResult = await uploadToCloudinary(req.file.buffer);
        const imagemSecureUrl = uploadResult.secure_url;

        // 2. Converter o buffer da imagem para Base64 para enviar ao Gemini
        const imagemBase64 = req.file.buffer.toString("base64");
        const inlineData = {
            data: imagemBase64,
            mimeType: req.file.mimetype
        };

        // 3. Inicializa o modelo de visão multimodal do Gemini
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = pergunta || "Analise esta imagem detalhadamente.";

        console.log("⏳ Enviando imagem e texto para análise do Gemini...");
        const result = await model.generateContent([prompt, { inlineData }]);
        const respostaDaIA = result.response.text();

        console.log("✅ Resposta recebida do Gemini!");

        // 4. Salvar pergunta e URL da imagem no banco de dados MongoDB
        await Mensagem.create({ 
            remetente: 'usuario', 
            texto: prompt, 
            imagemUrl: imagemSecureUrl 
        });

        // 5. Salvar resposta do robô no MongoDB
        await Mensagem.create({ remetente: 'ia', texto: respostaDaIA });

        return res.status(200).json({
            sucesso: true,
            resposta: respostaDaIA,
            imagemUrl: imagemSecureUrl
        });

    } catch (erro) {
        console.error("❌ Erro no controlador multimodal:", erro.message || erro);
        return res.status(500).json({ erro: "Erro interno no servidor ao processar análise multimodal." });
    }
};

// =========================================================================
// BANCO DE DADOS PERSISTENTE (Fase 5: Histórico Rico)
// =========================================================================
const obterHistorico = async (req, res) => {
    try {
        // Carrega as últimas 30 mensagens ordenadas por data de forma crescente
        const historico = await Mensagem.find().sort({ timestamp: 1 }).limit(30);
        return res.status(200).json(historico);
    } catch (error) {
        console.error("❌ Erro ao buscar histórico rico:", error);
        return res.status(500).json({ erro: "Erro ao buscar histórico do banco de dados." });
    }
};

// =========================================================================
// FERRAMENTA DE GAMIFICAÇÃO
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
        return { erro: "Não foi possível atualizar o XP do jogador." };
    }
};

const declaracaoXP = {
    name: "adicionarXP",
    description: "Adiciona ou retira pontos de XP do jogador atual com base em seu desempenho no jogo de charadas.",
    parameters: {
        type: "OBJECT",
        properties: {
            nickname: { type: "STRING" },
            quantidade: { type: "NUMBER" }
        },
        required: ["nickname", "quantidade"]
    }
};

const conversar = async (req, res) => {
    try {
        const { pergunta } = req.body;
        const nickname = req.usuario.nome;

        if (!pergunta) {
            return res.status(400).json({ erro: "Você precisa enviar uma 'pergunta' no formato JSON." });
        }

        await Mensagem.create({ remetente: 'usuario', texto: pergunta });
        const historico = await Mensagem.find().sort({ timestamp: 1 }).limit(20);

        let promptFinal = `Você é o Guardião de um cofre de conhecimento e um robô sarcástico atuando como Mestre do Jogo (Game Master).
O apelido do jogador atual é "${nickname}". Proponha charadas e desafie-o a responder.
Se ele responder corretamente, chame a função 'adicionarXP' com 50 pontos. Se ele errar ou desistir, chame com -10 pontos.

Histórico da conversa para contexto:\n\n`;

        historico.forEach(msg => {
            const papel = msg.remetente === 'usuario' ? 'Usuário' : 'Robô';
            promptFinal += `${papel}: ${msg.texto}\n`;
        });
        promptFinal += `Robô Sarcástico:`;

        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            tools: [{ functionDeclarations: [declaracaoXP] }] 
        });

        let response = await model.generateContent(promptFinal);
        let respostaDaIA = "";
        const functionCalls = response.response.functionCalls;
        
        if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];
            let functionResult = null;

            if (call.name === "adicionarXP") {
                const { nickname: nick, quantidade } = call.args;
                functionResult = await adicionarXP(nick || nickname, quantidade);
            }

            if (functionResult) {
                const contents = [
                    { role: "user", parts: [{ text: promptFinal }] },
                    { role: "model", parts: [{ functionCall: { name: call.name, args: call.args } }] },
                    { role: "user", parts: [{ functionResponse: { name: call.name, response: functionResult } }] }
                ];
                const finalResult = await model.generateContent({ contents });
                respostaDaIA = finalResult.response.text();
            } else {
                respostaDaIA = response.response.text();
            }
        } else {
            respostaDaIA = response.response.text();
        }

        await Mensagem.create({ remetente: 'ia', texto: respostaDaIA });

        return res.status(200).json({ sucesso: true, resposta: respostaDaIA });
    } catch (erro) {
        return res.status(500).json({ erro: "Erro interno no servidor de IA." });
    }
};

const obterRanking = async (req, res) => {
    try {
        const jogadores = await Jogador.find().sort({ xp: -1 }).limit(10);
        const rankingFormatado = jogadores.map(j => {
            let titulo = "Novato";
            if (j.xp >= 500) titulo = "Lenda 👑";
            else if (j.xp >= 100) titulo = "Guerreiro ⚔️";
            return { nome: `${titulo}: ${j.nome}`, xp: j.xp };
        });
        return res.status(200).json(rankingFormatado);
    } catch (error) {
        return res.status(500).json({ erro: "Erro ao buscar a tabela de classificação." });
    }
};

const limparHistorico = async (req, res) => {
    try {
        await Mensagem.deleteMany({});
        return res.status(200).json({ sucesso: true, mensagem: "Histórico limpo com sucesso!" });
    } catch (erro) {
        return res.status(500).json({ erro: "Erro ao limpar o histórico do banco de dados." });
    }
};

module.exports = {
    conversar,
    conversarMultimodal,
    obterHistorico,
    obterRanking,
    limparHistorico
};