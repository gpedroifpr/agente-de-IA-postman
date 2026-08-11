const mongoose = require('mongoose');

const MensagemSchema = new mongoose.Schema({
    remetente: { type: String, required: true }, // 'usuario' ou 'ia'
    texto: { type: String, required: true },
    imagemUrl: { type: String }, // Campo opcional para salvar a URL da imagem (Sprint Multimodal)
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Mensagem', MensagemSchema);