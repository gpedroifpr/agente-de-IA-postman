const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UsuarioSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    senha: { type: String, required: true }
});

// Criptografar a senha do usuário com bcryptjs antes de salvar no MongoDB Atlas
UsuarioSchema.pre('save', async function(next) {
    if (!this.isModified('senha')) return next();
    try {
        const salt = await bcrypt.genSalt(10);
        this.senha = await bcrypt.hash(this.senha, salt);
        next();
    } catch (error) {
        next(error);
    }
});

module.exports = mongoose.model('Usuario', UsuarioSchema);