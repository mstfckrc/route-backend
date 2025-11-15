const express = require('express');
const router = express.Router();
const { calculateAkilliRota , getTumIstasyonlar } = require('../service/rotaServices');

router.post('/hesapla', async (req, res) => {
  try {
    const { baslangic, bitis } = req.body;

    if (!baslangic || !bitis || !baslangic.lng || !baslangic.lat || !bitis.lng || !bitis.lat) {
      return res.status(400).json({ 
        hata: 'Eksik veya hatalı koordinat bilgisi. "baslangic" ve "bitis" objeleri (lng, lat içermeli) gereklidir.' 
      });
    }

    const hesaplananRota = await calculateAkilliRota({ baslangic, bitis });

    res.status(200).json(hesaplananRota);

  } catch (error) {
    console.error('[Route-Error /rota/hesapla]:', error.message);
    res.status(500).json({ hata: error.message || 'Rota hesaplanırken sunucuda bir hata oluştu.' });
  }
});


// YENİ ENDPOINT: GET /api/rota/istasyonlar
router.get('/istasyonlar', (req, res) => {
  try {
    const istasyonlar = getTumIstasyonlar();
    res.status(200).json(istasyonlar);
  } catch (error) {
    console.error(error);
    res.status(500).json({ hata: 'İstasyonlar alınamadı.' });
  }
});

module.exports = router;