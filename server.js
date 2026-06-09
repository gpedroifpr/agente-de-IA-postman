// 1. Importações (Bibliotecas)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// 2. Configurações Iniciais do Servidor
const app = express();
app.use(express.json()); // Permite que o servidor entenda JSON
app.use(express.urlencoded({ extended: true }));
app.use(cors()); // Permite conexões externas (CORS) sem bloqueio

// 3. Configuração da IA
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

// --- DESAFIO EXTRA (Opcional) ---
// Rota GET para verificar se o servidor está online direto pelo navegador
app.get('/api/status', (req, res) => {
    return res.status(200).json({ status: "Servidor da IA Operacional" });
});

// 4. CRIANDO A ROTA (Endpoint) DA API (POST)
app.post('/api/chat', async (req, res) => {
    try {
        // Log para ver o que está chegando no terminal
        console.log("📦 Conteúdo recebido no corpo:", req.body);

        // Critério de Aceite: Tratamento de erro se o JSON vier vazio ou sem a 'pergunta'
        if (!req.body || !req.body.pergunta) {
            return res.status(400).json({ 
                erro: "Você precisa enviar uma 'pergunta' no formato JSON." 
            });
        }

        const { pergunta } = req.body;
        console.log(`📩 Nova pergunta recebida: "${pergunta}"`);

        // Inicializa o modelo da IA
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        const promptFinal = `Você é um robô sarcástico. Responda a seguinte pergunta: ${pergunta}`;
        
        console.log("⏳ Enviando dados para o Google Gemini...");
        
        const result = await model.generateContent(promptFinal);
        
        console.log("✅ Resposta recebida do Google!");

        // Processa o texto da resposta
        const respostaDaIA = result.response.text();
        
        // Exibe a resposta também no terminal do VS Code
        console.log("🤖 Resposta gerada pela IA:\n", respostaDaIA);
        
        // Retorna a resposta para o cliente (Postman)
        return res.status(200).json({ 
            sucesso: true,
            resposta: respostaDaIA 
        });

    } catch (erro) {
        console.error("❌ Erro detalhado no servidor:", erro.message || erro);
        return res.status(500).json({ 
            erro: "Erro interno no servidor de IA." 
        });
    }
});

// 5. Ligar o Servidor
// A nuvem define a porta via process.env.PORT. Se não houver, usa a 3000 (local)
const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => {
    console.log(`🚀 Servidor da IA rodando na porta http://localhost:${PORTA}`);
    console.log(`📡 Rota disponível: POST http://localhost:${PORTA}/api/chat`);
    console.log(`🔌 Rota de Status: GET http://localhost:${PORTA}/api/status`);
});