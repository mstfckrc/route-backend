// routes/rota.js
const express = require('express');
const router = express.Router();
const { calculateAkilliRota, getTumIstasyonlar, rezervasyonYap } = require('../service/rotaServices');

// Rota Hesapla
router.post('/hesapla', async (req, res) => {
  try {
    const { baslangic, bitis, aracId, baslangicSarj, yolaCikisSaati } = req.body;
    if (!baslangic || !bitis) return res.status(400).json({ hata: 'Eksik bilgi.' });

    const hesaplananRota = await calculateAkilliRota({ baslangic, bitis, aracId, baslangicSarj, yolaCikisSaati });
    res.status(200).json(hesaplananRota);
  } catch (error) {
    console.error('[Route-Error]:', error.message);
    res.status(500).json({ hata: error.message });
  }
});

// YENİ: Rezervasyon Yap
router.post('/rezervasyon', (req, res) => {
    try {
        const { istasyonId, baslangicSaat, bitisSaat } = req.body;
        const sonuc = rezervasyonYap(istasyonId, baslangicSaat, bitisSaat);
        res.status(200).json(sonuc);
    } catch (error) {
        res.status(500).json({ hata: error.message });
    }
});

router.get('/istasyonlar', (req, res) => {
    try {
      const istasyonlar = getTumIstasyonlar();
      res.status(200).json(istasyonlar);
    } catch (error) {
      res.status(500).json({ hata: 'İstasyonlar alınamadı.' });
    }
});

module.exports = router;