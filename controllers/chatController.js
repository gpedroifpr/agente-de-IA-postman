const { GoogleGenerativeAI } = require("@google/generative-ai");
const Mensagem = require("../models/Mensagem");

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

// Envia mensagem e obtém resposta considerando histórico
const conversar = async (req, res) => {
    try {
        const { pergunta } = req.body;

        if (!pergunta) {
            return res.status(400).json({ erro: "Você precisa enviar uma 'pergunta' no formato JSON." });
        }

        console.log(`📩 Nova pergunta recebida: "${pergunta}"`);

        // 1. Salvar a pergunta do usuário no MongoDB
        await Mensagem.create({ remetente: 'usuario', texto: pergunta });

        // 2. Buscar o histórico recente do MongoDB (últimas 20 mensagens) para dar memória à IA
        const historico = await Mensagem.find().sort({ timestamp: 1 }).limit(20);

        // 3. Construir o contexto com o histórico completo para o Gemini
        let promptFinal = `Você é um robô sarcástico. Responda à última pergunta considerando o histórico anterior da conversa para ter contexto:\n\n`;
        historico.forEach(msg => {
            const papel = msg.remetente === 'usuario' ? 'Usuário' : 'Robô';
            promptFinal += `${papel}: ${msg.texto}\n`;
        });
        promptFinal += `Robô Sarcástico:`;

        console.log("⏳ Enviando dados com histórico para o Google Gemini...");
        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
        const result = await model.generateContent(promptFinal);
        const respostaDaIA = result.response.text();
        
        console.log("✅ Resposta recebida do Google!");

        // 4. Salvar a resposta da IA no MongoDB
        await Mensagem.create({ remetente: 'ia', texto: respostaDaIA });

        console.log("🤖 Resposta gerada pela IA:\n", respostaDaIA);

        return res.status(200).json({
            sucesso: true,
            resposta: respostaDaIA
        });

    } catch (erro) {
        console.error("❌ Erro no controlador do chat:", erro.message || erro);
        return res.status(500).json({ erro: "Erro interno no servidor de IA." });
    }
};

// 5. Upgrade de Controle (Botão Reset): Apagar todo o histórico do banco de dados
const limparHistorico = async (req, res) => {
    try {
        await Mensagem.deleteMany({});
        console.log("🗑️ Histórico de mensagens limpo do MongoDB Atlas.");
        return res.status(200).json({ sucesso: true, mensagem: "Histórico limpo com sucesso!" });
    } catch (erro) {
        console.error("❌ Erro ao limpar histórico:", erro.message || erro);
        return res.status(500).json({ erro: "Erro ao limpar o histórico do banco de dados." });
    }
};

module.exports = {
    conversar,
    limparHistorico
};