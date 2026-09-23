const mongoose = require('mongoose');

const MensagemSchema = new mongoose.Schema({
    usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true }, // Associa a mensagem ao ID do usuário do JWT
    remetente: { type: String, required: true }, // 'usuario' ou 'ia'
    texto: { type: String, required: true },
    imagemUrl: { type: String },
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Mensagem', MensagemSchema);