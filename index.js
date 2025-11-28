require('dotenv').config();

const express = require('express');
const cors = require('cors');

const mainApiRouter = require('./routes/index');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.use('/api', mainApiRouter);

app.get('/', (req, res) => {
  res.status(200).json({ 
    mesaj: '🚀 Aydem Rota Projesi Backend API\'sine hoş geldiniz!',
    durum: 'Ayakta ve çalışıyor (Katmanlı Mimari).'
  });
});

app.listen(PORT, () => {
  console.log(`[SERVER]: Sunucu http://localhost:${PORT} adresinde (Katmanlı Mimari) başlatıldı.`);
});