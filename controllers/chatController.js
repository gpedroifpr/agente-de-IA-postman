const { GoogleGenerativeAI } = require("@google/generative-ai");
const Mensagem = require("../models/Mensagem");

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

// =========================================================================
// FASE 1: Ferramentas (Ações Locais)
// =========================================================================

// Busca o clima em tempo real via OpenWeatherMap
const buscarClimaTempoReal = async (cidade) => {
    try {
        const apiKeyClima = process.env.WEATHER_API_KEY;
        if (!apiKeyClima) {
            return { erro: "Chave da API OpenWeatherMap (WEATHER_API_KEY) não configurada no servidor." };
        }

        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(cidade)}&appid=${apiKeyClima}&units=metric&lang=pt_br`;
        const res = await fetch(url);
        
        if (!res.ok) {
            return { erro: `Não foi possível obter o clima para a cidade: "${cidade}". Verifique se o nome está correto.` };
        }

        const data = await res.json();
        return {
            cidade: data.name,
            temperatura: `${Math.round(data.main.temp)}°C`,
            descricao: data.weather[0].description,
            umidade: `${data.main.humidity}%`
        };
    } catch (err) {
        console.error("Erro na busca do clima:", err);
        return { erro: "Ocorreu um erro interno ao processar a consulta de clima." };
    }
};

// Conversor de Moedas (Desafio Hacker) usando uma API pública e gratuita
const converterMoeda = async (valor, de, para) => {
    try {
        const url = `https://open.er-api.com/v6/latest/${de.toUpperCase()}`;
        const res = await fetch(url);
        
        if (!res.ok) {
            return { erro: `Não foi possível consultar as taxas de câmbio para a moeda: ${de}.` };
        }

        const data = await res.json();
        const taxa = data.rates[para.toUpperCase()];
        
        if (!taxa) {
            return { erro: `A moeda de destino "${para}" não é suportada para conversão.` };
        }

        const convertido = (valor * taxa).toFixed(2);
        return {
            valorOriginal: `${valor} ${de.toUpperCase()}`,
            valorConvertido: `${convertido} ${para.toUpperCase()}`,
            taxaCambio: taxa.toFixed(4)
        };
    } catch (err) {
        console.error("Erro na conversão de moedas:", err);
        return { erro: "Ocorreu um erro interno ao processar a conversão monetária." };
    }
};

// =========================================================================
// FASE 2: Manual de Instruções das Funções (JSON Schema)
// =========================================================================

const declaracaoClima = {
    name: "buscarClimaTempoReal",
    description: "Obtém a temperatura exata e o clima atual de uma cidade. Use sempre que o usuário perguntar sobre o tempo, clima ou temperatura.",
    parameters: {
        type: "OBJECT",
        properties: {
            cidade: {
                type: "STRING",
                description: "O nome da cidade de interesse. Ex: Assis Chateaubriand, Curitiba, Tokyo."
            }
        },
        required: ["cidade"]
    }
};

const declaracaoMoeda = {
    name: "converterMoeda",
    description: "Converte valores monetários de uma moeda de origem para outra. Use sempre que o usuário quiser converter moedas, moedas estrangeiras ou preços (ex: converter Real para Dólar, converter Euro para Real, etc).",
    parameters: {
        type: "OBJECT",
        properties: {
            valor: {
                type: "NUMBER",
                description: "O valor numérico que o usuário deseja converter. Ex: 150, 1000."
            },
            de: {
                type: "STRING",
                description: "O código internacional de 3 letras da moeda de origem. Ex: USD, BRL, EUR."
            },
            para: {
                type: "STRING",
                description: "O código internacional de 3 letras da moeda de destino. Ex: USD, BRL, EUR."
            }
        },
        required: ["valor", "de", "para"]
    }
};

// =========================================================================
// CONTROLADORES DA ROTA
// =========================================================================

const conversar = async (req, res) => {
    try {
        const { pergunta } = req.body;

        if (!pergunta) {
            return res.status(400).json({ erro: "Você precisa enviar uma 'pergunta' no formato JSON." });
        }

        console.log(`📩 Nova pergunta recebida: "${pergunta}"`);

        // 1. Salvar a pergunta do usuário no MongoDB para manutenção de estado (memória)
        await Mensagem.create({ remetente: 'usuario', texto: pergunta });

        // 2. Buscar o histórico de mensagens recentes (últimas 20 mensagens)
        const historico = await Mensagem.find().sort({ timestamp: 1 }).limit(20);

        // 3. Construir o prompt contextualizado com histórico
        let promptFinal = `Você é um robô sarcástico. Responda à última pergunta considerando o histórico anterior da conversa para ter contexto:\n\n`;
        historico.forEach(msg => {
            const papel = msg.remetente === 'usuario' ? 'Usuário' : 'Robô';
            promptFinal += `${papel}: ${msg.texto}\n`;
        });
        promptFinal += `Robô Sarcástico:`;

        // FASE 3: Inicializando o modelo com a caixa de ferramentas (tools) conectada
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            tools: [{ functionDeclarations: [declaracaoClima, declaracaoMoeda] }] 
        });

        console.log("⏳ Enviando dados para o Gemini...");
        let response = await model.generateContent(promptFinal);
        let respostaDaIA = "";

        // FASE 4: O Loop de Conversação / Chamada de Função
        const functionCalls = response.response.functionCalls;
        
        if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];
            let functionResult = null;

            console.log(`🤖 Gemini decidiu chamar a função autônoma: "${call.name}" com os argumentos:`, call.args);

            // Executa a ação correspondente
            if (call.name === "buscarClimaTempoReal") {
                const { cidade } = call.args;
                functionResult = await buscarClimaTempoReal(cidade);
            } else if (call.name === "converterMoeda") {
                const { valor, de, para } = call.args;
                functionResult = await converterMoeda(valor, de, para);
            }

            if (functionResult) {
                console.log("↩️ Retornando o resultado da função de volta para o Gemini...");
                
                // Envia a resposta da chamada de função para o Gemini gerar o texto final
                const contents = [
                    { role: "user", parts: [{ text: promptFinal }] },
                    { 
                        role: "model", 
                        parts: [{ functionCall: { name: call.name, args: call.args } }] 
                    },
                    { 
                        role: "user", 
                        parts: [{ functionResponse: { name: call.name, response: functionResult } }] 
                    }
                ];
                
                const finalResult = await model.generateContent({ contents });
                respostaDaIA = finalResult.response.text();
            } else {
                respostaDaIA = response.response.text();
            }
        } else {
            respostaDaIA = response.response.text();
        }

        // 4. Salvar a resposta final do robô no MongoDB (mantém o histórico íntegro)
        await Mensagem.create({ remetente: 'ia', texto: respostaDaIA });

        console.log("🤖 Resposta sarcástica enviada:\n", respostaDaIA);

        return res.status(200).json({
            sucesso: true,
            resposta: respostaDaIA
        });

    } catch (erro) {
        console.error("❌ Erro no controlador do chat:", erro.message || erro);
        return res.status(500).json({ erro: "Erro interno no servidor de IA." });
    }
};

// Apaga todo o histórico de conversas
const limparHistorico = async (req, res) => {
    try {
        await Mensagem.deleteMany({});
        console.log("🗑️ Histórico de mensagens limpo do MongoDB.");
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