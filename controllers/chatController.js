const { GoogleGenerativeAI } = require("@google/generative-ai");
const Mensagem = require("../models/mensagem"); // Importação corrigida com m minúsculo
const Jogador = require("../models/jogador");

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

// =========================================================================
// FASE 2: Ferramenta de Gamificação (Ação Local)
// =========================================================================

const adicionarXP = async (nickname, quantidade) => {
    try {
        console.log(`🎮 Processando XP para o jogador: "${nickname}" | Quantidade: ${quantidade}`);
        
        let jogador = await Jogador.findOne({ nome: nickname });
        
        if (!jogador) {
            // Se o jogador não existir, cria um novo
            jogador = await Jogador.create({ nome: nickname, xp: Math.max(0, quantidade) });
        } else {
            // Se existir, soma a quantidade ao XP atual (impedindo que fique abaixo de 0)
            jogador.xp = Math.max(0, jogador.xp + quantidade);
            await jogador.save();
        }
        
        return { sucesso: true, nome: jogador.nome, xpAtual: jogador.xp };
    } catch (error) {
        console.error("❌ Erro ao adicionar XP:", error);
        return { erro: "Não foi possível atualizar o XP do jogador no banco de dados." };
    }
};

// Declaração do JSON Schema da Função para o Gemini compreender
const declaracaoXP = {
    name: "adicionarXP",
    description: "Adiciona ou retira pontos de XP do jogador atual com base em seu desempenho no jogo de charadas. Chame esta função obrigatoriamente adicionando 50 pontos sempre que ele acertar a charada, ou subtraindo 10 pontos caso ele desista, erre grosseiramente ou peça a resposta.",
    parameters: {
        type: "OBJECT",
        properties: {
            nickname: {
                type: "STRING",
                description: "O nickname (apelido) do jogador atual."
            },
            quantidade: {
                type: "NUMBER",
                description: "A quantidade de XP a ser somada (ex: 50) ou subtraída (ex: -10)."
            }
        },
        required: ["nickname", "quantidade"]
    }
};

// =========================================================================
// CONTROLADORES DAS ROTAS
// =========================================================================

const conversar = async (req, res) => {
    try {
        const { pergunta, nickname } = req.body;

        if (!nickname) {
            return res.status(400).json({ erro: "É necessário informar um 'nickname' (apelido) para jogar." });
        }
        if (!pergunta) {
            return res.status(400).json({ erro: "Você precisa enviar uma 'pergunta' no formato JSON." });
        }

        console.log(`📩 [Jogador: ${nickname}] perguntou: "${pergunta}"`);

        // 1. Salvar a pergunta no histórico do MongoDB
        await Mensagem.create({ remetente: 'usuario', texto: pergunta });

        // 2. Buscar histórico recente (últimas 20 mensagens)
        const historico = await Mensagem.find().sort({ timestamp: 1 }).limit(20);

        // 3. Montar o Prompt com Engenharia de Prompt para o Game Master (Fase 3)
        let promptFinal = `Você é o Guardião de um cofre de conhecimento e um robô sarcástico atuando como Mestre do Jogo (Game Master).
Seu objetivo é propor charadas instigantes sobre programação e tecnologia ao jogador.

Regras estritas que você deve seguir de forma autônoma:
1. O apelido do jogador atual é "${nickname}". Use esse nome para falar com ele de forma sarcástica.
2. Proponha charadas e desafie-o a responder.
3. Se o jogador responder corretamente à charada atual, você DEVE acionar a função 'adicionarXP' com 50 pontos para ele.
4. Se o jogador desistir, pedir a resposta direta ou errar de forma boba, você DEVE acionar a função 'adicionarXP' com -10 pontos para ele.
5. Nunca diga diretamente os pontos de XP acumulados dele (você receberá a resposta da função contendo o total, mas apenas comente sarcasticamente que ele ganhou ou perdeu pontos e continue propondo o próximo desafio).

Histórico da conversa para contexto:\n\n`;

        historico.forEach(msg => {
            const papel = msg.remetente === 'usuario' ? 'Usuário' : 'Robô';
            promptFinal += `${papel}: ${msg.texto}\n`;
        });
        promptFinal += `Robô Sarcástico:`;

        // Inicializa o modelo com as ferramentas de gamificação
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            tools: [{ functionDeclarations: [declaracaoXP] }] 
        });

        console.log("⏳ Enviando dados para o Gemini...");
        let response = await model.generateContent(promptFinal);
        let respostaDaIA = "";

        const functionCalls = response.response.functionCalls;
        
        // Loop de execução (Fase 2)
        if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];
            let functionResult = null;

            if (call.name === "adicionarXP") {
                const { nickname: nick, quantidade } = call.args;
                // Executa a função local e atualiza o MongoDB Atlas
                functionResult = await adicionarXP(nick || nickname, quantidade);
            }

            if (functionResult) {
                console.log("↩️ Retornando o resultado da função ao Gemini...");
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

        // 4. Salvar resposta no MongoDB
        await Mensagem.create({ remetente: 'ia', texto: respostaDaIA });

        return res.status(200).json({
            sucesso: true,
            resposta: respostaDaIA
        });

    } catch (erro) {
        console.error("❌ Erro no controlador do chat:", erro.message || erro);
        return res.status(500).json({ erro: "Erro interno no servidor de IA." });
    }
};

// Rota de Ranking - Desafio Hacker: Títulos Dinâmicos (Fase 4)
const obterRanking = async (req, res) => {
    try {
        // Busca os top 10 ordenados por XP de forma decrescente
        const jogadores = await Jogador.find().sort({ xp: -1 }).limit(10);
        
        const rankingFormatado = jogadores.map(j => {
            let titulo = "Novato";
            if (j.xp >= 500) {
                titulo = "Lenda 👑";
            } else if (j.xp >= 100) {
                titulo = "Guerreiro ⚔️";
            }
            return {
                nome: `${titulo}: ${j.nome}`,
                xp: j.xp
            };
        });

        return res.status(200).json(rankingFormatado);
    } catch (error) {
        console.error("❌ Erro ao obter ranking:", error);
        return res.status(500).json({ erro: "Erro ao buscar a tabela de classificação." });
    }
};

// Limpa todo o histórico de conversas
const limparHistorico = async (req, res) => {
    try {
        await Mensagem.deleteMany({});
        return res.status(200).json({ sucesso: true, mensagem: "Histórico de mensagens limpo com sucesso!" });
    } catch (erro) {
        return res.status(500).json({ erro: "Erro ao limpar o histórico do banco de dados." });
    }
};

module.exports = {
    conversar,
    obterRanking,
    limparHistorico
};