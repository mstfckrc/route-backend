// services/rotaService.js
require('dotenv').config(); 
const axios = require('axios'); 
const fs = require('fs'); 
const path = require('path'); 

const ORS_API_KEY = process.env.ORS_API_KEY;

// fetchORSRoute fonksiyonu (Değişiklik YOK, aynı kalıyor)
const fetchORSRoute = async (koordinatlar) => {
  const orsUrl = 'https://api.openrouteservice.org/v2/directions/driving-car';
  const istekBody = { "coordinates": koordinatlar };
  const istekHeaders = {
    'Authorization': ORS_API_KEY,
    'Content-Type': 'application/json'
  };
  try {
    const response = await axios.post(orsUrl, istekBody, { headers: istekHeaders });
    if (!response.data || !response.data.routes || response.data.routes.length === 0) {
      throw new Error('OpenRouteService\'ten geçerli bir rota bulunamadı.');
    }
    const rota = response.data.routes[0];
    return {
      rotaCizgisi: rota.geometry,
      ozet: {
        mesafe_km: (rota.summary.distance / 1000).toFixed(1),
        sure_dk: (rota.summary.duration / 60).toFixed(0)
      }
    };
  } catch (error) {
    console.error('[Service-Hata] fetchORSRoute:', error.message);
    return null; 
  }
};

// loadIstasyonlar fonksiyonu (Değişiklik YOK, aynı kalıyor)
const loadIstasyonlar = () => {
  const dosyaYolu = path.join(__dirname, '..', 'istasyonlar.json');
  const data = fs.readFileSync(dosyaYolu);
  return JSON.parse(data);
};

// --- YENİ FİLTRE: "Bounding Box" (Kutu) Filtresi ---
// (Bir önceki kod bloğumuzdaki 'kabaMesafeHesapla' yerine bunu kullanıyoruz)
const mantikliIstasyonlariFiltrele = (baslangic, bitis, tumIstasyonlar) => {
    // A ve B'nin enlem ve boylamlarının min/max değerlerini bul
    const minLat = Math.min(baslangic.lat, bitis.lat);
    const maxLat = Math.max(baslangic.lat, bitis.lat);
    const minLng = Math.min(baslangic.lng, bitis.lng);
    const maxLng = Math.max(baslangic.lng, bitis.lng);

    // Bu kutuya biraz "tampon" (padding/buffer) ekleyelim ki
    // rotanın biraz dışında kalanları da alalım.
    // 0.5 derece yaklaşık 55km'lik bir tampon demektir, bu gayet yeterli.
    const buffer = 0.5; 

    const mantikliIstasyonlar = tumIstasyonlar.filter(istasyon => {
      const lat = istasyon.koordinat.lat;
      const lng = istasyon.koordinat.lng;
      
      // İstasyon, bu tamponlu kutunun içinde mi?
      return (
        lat > minLat - buffer &&
        lat < maxLat + buffer &&
        lng > minLng - buffer &&
        lng < maxLng + buffer
      );
    });
    return mantikliIstasyonlar;
};


// --- ANA "BEYİN" ALGORİTMAMIZ (GÜNCELLENDİ) ---
const calculateAkilliRota = async (rotaIstegi) => {
  console.log('[Service]: "Akıllı Algoritma" (Meta-Algoritma) çalıştı.');
  
  const { baslangic, bitis } = rotaIstegi;
  const baslangicLngLat = [baslangic.lng, baslangic.lat];
  const bitisLngLat = [bitis.lng, bitis.lat];

  const senaryolar = [];
  
  // Senaryo 0: Direkt Rota (A -> B)
  // <-- DEĞİŞİKLİK: 'ad' alanını 'Direkt Rota' olarak işaretliyoruz
  senaryolar.push({
    ad: "Direkt Rota", 
    istasyon: null,
    promise: fetchORSRoute([baslangicLngLat, bitisLngLat])
  });

  // İstasyonları Yükle
  const tumIstasyonlar = loadIstasyonlar(); 

  // "Ön Filtreleme"
  const mantikliIstasyonlar = mantikliIstasyonlariFiltrele(baslangic, bitis, tumIstasyonlar);
  console.log(`[Algoritma] ${tumIstasyonlar.length} istasyon bulundu. ${mantikliIstasyonlar.length} tanesi "mantıklı" ve teste sokuluyor.`);

  // "Mantıklı" İstasyonlar için Diğer Senaryoları Oluştur
  mantikliIstasyonlar.forEach(istasyon => {
    const istasyonLngLat = [istasyon.koordinat.lng, istasyon.koordinat.lat];
    senaryolar.push({
      ad: `Rota (${istasyon.ad})`,
      istasyon: istasyon,
      promise: fetchORSRoute([baslangicLngLat, istasyonLngLat, bitisLngLat])
    });
  });

  // Tüm "Mantıklı" Senaryoları Paralel Olarak Çalıştır
  const sonuclar = await Promise.allSettled(senaryolar.map(s => s.promise));

  // --- DEĞİŞİKLİK: Karar Verme Aşaması Güncellendi ---
  
  // 1. Direkt Rota verisini her zaman sakla (karşılaştırma için)
  let direktRotaVerisi = null;
  if (sonuclar[0].status === 'fulfilled' && sonuclar[0].value) {
    direktRotaVerisi = {
      ...sonuclar[0].value, // rotaCizgisi ve ozet'i kopyala
      mesaj: "En Kısa Rota (Direkt)",
      durak: null,
      skor: parseFloat(sonuclar[0].value.ozet.sure_dk) // Direkt rotanın skoru sadece süredir
    };
  }

  // 2. En İyi Skoru (Akıllı Rota) bul
  let enIyiRota = direktRotaVerisi; // Başlangıçta en iyi rota, direkt rotadır
  let enIyiSkor = direktRotaVerisi ? direktRotaVerisi.skor : Infinity; 

  sonuclar.forEach((sonuc, index) => {
    // Direkt rotayı (index 0) atla, onu zaten aldık (skor karşılaştırması için dahil ediyoruz)
    if (sonuc.status === 'fulfilled' && sonuc.value) {
      const rotaDetaylari = sonuc.value;
      const istasyon = senaryolar[index].istasyon;
      
      // ALGORİTMA BURADA:
      let skor;
      if (istasyon) {
         // Akıllı Skor: (Süre * 0.5) + (Fiyat * 1.5)
         skor = (parseFloat(rotaDetaylari.ozet.sure_dk) * 0.5) + (istasyon.fiyat_kw * 1.5);
      } else {
         // Direkt Rota Skoru (Sadece süre)
         skor = parseFloat(rotaDetaylari.ozet.sure_dk);
      }

      console.log(`[Algoritma] Senaryo "${senaryolar[index].ad}" SKOR: ${skor.toFixed(2)}`);

      if (skor < enIyiSkor) {
        enIyiSkor = skor;
        enIyiRota = {
          mesaj: `Akıllı rota bulundu: ${senaryolar[index].ad}`,
          rotaCizgisi: rotaDetaylari.rotaCizgisi,
          ozet: rotaDetaylari.ozet,
          durak: istasyon,
          skor: skor
        };
      }
    }
  });

  // 3. Frontend'e tek bir obje değil, ikili bir paket gönder
  if (!direktRotaVerisi || !enIyiRota) {
    throw new Error('Tüm rota senaryoları (OpenRouteService) başarısız oldu.');
  }
  
  // <-- DEĞİŞİKLİK: Artık frontend'e 2 rota da gönderiliyor.
  return {
    akilliRota: enIyiRota, 
    direktRota: direktRotaVerisi
  };
};

// Frontend'in /istasyonlar endpoint'i için bu fonksiyonu da dışa aktar
const getTumIstasyonlar = () => {
  return loadIstasyonlar();
};

// Bu fonksiyonları dışa aktar ki 'routes' katmanı kullanabilsin
module.exports = {
  calculateAkilliRota,
  getTumIstasyonlar
};