// services/rotaService.js
require('dotenv').config(); 
const axios = require('axios'); 
const fs = require('fs'); 
const path = require('path'); 

const ORS_API_KEY = process.env.ORS_API_KEY;

// --- AYARLAR ---
const MAX_STATIONS_TO_TEST = 4; 
const PANIC_STATIONS_TO_TEST = 8; 

const ORTALAMA_PIYASA_FIYATI = 8.5; 
const FIYAT_AGIRLIGI = 5; 

const SARJ_BITIS_ESIGI = 20; 
const HEDEF_SARJ_SEVIYESI = 80; 
const KRITIK_SARJ_SEVIYESI = 20; 

const GUC_HIZLI_KW = 120; 
const GUC_YAVAS_KW = 22;  

const ARACLAR = {
  'togg': { ad: 'Togg T10X V2', menzil: 523, kapasite: 88.5 },
  'tesla': { ad: 'Tesla Model Y LR', menzil: 533, kapasite: 75.0 },
  'zoe': { ad: 'Renault Zoe', menzil: 395, kapasite: 52.0 },
  'corsa': { ad: 'Opel Corsa-e', menzil: 359, kapasite: 50.0 }
};

// ORS API İstek Fonksiyonu
const fetchORSRoute = async (koordinatlar) => {
  const orsUrl = 'https://api.openrouteservice.org/v2/directions/driving-car';
  
  // 404 Önleme: Her nokta için 5000 metre esneklik yarıçapı
  const radiuses = koordinatlar.map(() => 5000);

  const istekBody = { 
      "coordinates": koordinatlar,
      "radiuses": radiuses 
  };

  const istekHeaders = {
    'Authorization': ORS_API_KEY,
    'Content-Type': 'application/json'
  };
  try {
    const response = await axios.post(orsUrl, istekBody, { headers: istekHeaders });
    if (!response.data || !response.data.routes || !response.data.routes.length === 0) {
      throw new Error('Rota bulunamadı.');
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
    if (error.response && error.response.status === 404) {
        console.log(`[Bilgi] Rota noktası yola bağlanamadı (404).`);
    } else {
        console.error(`[Service-Hata] fetchORSRoute: ${error.message}`);
    }
    return null; 
  }
};

// --- VERİ YÖNETİMİ ---
const loadIstasyonlar = () => {
  const dosyaYolu = path.join(__dirname, '..', 'istasyonlar.json');
  const data = fs.readFileSync(dosyaYolu);
  return JSON.parse(data);
};

const saveIstasyonlar = (data) => {
    const dosyaYolu = path.join(__dirname, '..', 'istasyonlar.json');
    fs.writeFileSync(dosyaYolu, JSON.stringify(data, null, 2));
};

const getKabaMesafe = (p1, p2) => {
    const dx = p1.lng - p2.lng;
    const dy = p1.lat - p2.lat;
    return Math.sqrt(dx*dx + dy*dy);
};

// --- REZERVASYON YARDIMCILARI ---
const timeToMinutes = (timeStr) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
};

const formatTime = (minutes) => {
    const h = Math.floor(minutes / 60) % 24;
    const m = Math.floor(minutes % 60);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
};

// Rezervasyon Çakışma Kontrolü
const checkRezervasyonDurumu = (istasyon, yolaCikisSaati, surusSuresiDk, sarjSuresiDk) => {
    if (!istasyon.rezervasyonlar || istasyon.rezervasyonlar.length === 0) return 0;
    
    const startMinutes = timeToMinutes(yolaCikisSaati);
    const arrivalMinutes = startMinutes + surusSuresiDk;
    const departureMinutes = arrivalMinutes + (sarjSuresiDk ? parseFloat(sarjSuresiDk) : 0);
    
    let waitTime = 0;
    for (let rez of istasyon.rezervasyonlar) {
        const rezStart = timeToMinutes(rez.baslangic);
        const rezEnd = timeToMinutes(rez.bitis);
        
        if (arrivalMinutes < rezEnd && departureMinutes > rezStart) {
            waitTime = rezEnd - arrivalMinutes;
            console.log(`[Rezervasyon Çakışması] ${istasyon.ad}: ${formatTime(arrivalMinutes)}-${formatTime(departureMinutes)} isteniyor. ${rez.baslangic}-${rez.bitis} dolu. Bekleme: ${waitTime.toFixed(0)} dk`);
            break; 
        }
    }
    return waitTime;
};

const rezervasyonYap = (istasyonId, baslangicSaat, bitisSaat) => {
    const istasyonlar = loadIstasyonlar();
    const istasyonIndex = istasyonlar.findIndex(i => i.id === istasyonId);
    
    if (istasyonIndex === -1) throw new Error('İstasyon bulunamadı.');

    const yeniRezervasyon = {
        baslangic: baslangicSaat,
        bitis: bitisSaat
    };

    if (!istasyonlar[istasyonIndex].rezervasyonlar) {
        istasyonlar[istasyonIndex].rezervasyonlar = [];
    }

    istasyonlar[istasyonIndex].rezervasyonlar.push(yeniRezervasyon);
    saveIstasyonlar(istasyonlar);

    console.log(`[Rezervasyon] ${istasyonlar[istasyonIndex].ad} için ${baslangicSaat}-${bitisSaat} rezerve edildi.`);
    return { success: true, mesaj: "Rezervasyon başarıyla oluşturuldu." };
};

// --- ANA ALGORİTMA ---
const calculateAkilliRota = async (rotaIstegi) => {
  console.log('[Service]: "Akıllı Algoritma Final (Bug Fix - Skorlama)" çalıştı.');
  
  const { baslangic, bitis, aracId = 'togg', baslangicSarj = 100, yolaCikisSaati = "09:00" } = rotaIstegi;
  const baslangicSarjSayi = parseFloat(baslangicSarj);
  const secilenArac = ARACLAR[aracId] || ARACLAR['togg'];
  const maxMenzil = secilenArac.menzil;
  const bataryaKapasitesi = secilenArac.kapasite; 
  
  console.log(`[Bilgi] Araç: ${secilenArac.ad}, Başlangıç: %${baslangicSarjSayi}, Saat: ${yolaCikisSaati}`);

  const baslangicArr = [baslangic.lng, baslangic.lat];
  const bitisArr = [bitis.lng, bitis.lat];

  // 1. Direkt Rota
  const direktRotaPromise = fetchORSRoute([baslangicArr, bitisArr]);
  const tumIstasyonlar = loadIstasyonlar(); 

  // --- ÖN ELEME ---
  const direktKabaMesafe = getKabaMesafe(baslangic, bitis);
  
  const adayIstasyonlar = tumIstasyonlar.map(istasyon => {
      const distAtoSt = getKabaMesafe(baslangic, istasyon.koordinat); 
      const distSttoB = getKabaMesafe(istasyon.koordinat, bitis);
      const toplamYol = distAtoSt + distSttoB;
      const sapmaFaktoru = toplamYol / direktKabaMesafe;

      let tipCarpani = 1.0; 
      if (istasyon.tip !== 'hizli') {
          if (baslangicSarjSayi > 80) tipCarpani = 3.0;
          else if (baslangicSarjSayi > 50) tipCarpani = 2.0;
          else if (baslangicSarjSayi > 30) tipCarpani = 1.2; 
          else tipCarpani = 1.0; 
      }

      const adayPuani = (istasyon.fiyat_kw * tipCarpani) * (sapmaFaktoru * sapmaFaktoru);
      return { ...istasyon, adayPuani, sapmaFaktoru, distAtoSt };
  });

  let filtrelenmisAdaylar;
  let aktifLimit; 
  let guvenlikPayi; 

  if (baslangicSarjSayi <= KRITIK_SARJ_SEVIYESI) {
      aktifLimit = PANIC_STATIONS_TO_TEST;
      guvenlikPayi = 0; 
      console.log(`[UYARI] Kritik Şarj! Yakınlık öncelikli ${aktifLimit} aday seçiliyor.`);
      filtrelenmisAdaylar = adayIstasyonlar
        .sort((a, b) => a.distAtoSt - b.distAtoSt)
        .slice(0, aktifLimit);
  } else {
      aktifLimit = MAX_STATIONS_TO_TEST;
      guvenlikPayi = 5; 
      filtrelenmisAdaylar = adayIstasyonlar
        .filter(ist => ist.sapmaFaktoru < 2.5) 
        .sort((a, b) => a.adayPuani - b.adayPuani)
        .slice(0, aktifLimit); 
  }

  console.log(`[Algoritma] Test edilecek adaylar: ${filtrelenmisAdaylar.map(i => i.ad).join(', ')}`);

  // --- API SORGULARI ---
  const senaryolar = [];
  senaryolar.push({ ad: "Direkt Rota", istasyon: null, promise: direktRotaPromise });

  filtrelenmisAdaylar.forEach(istasyon => {
    const istasyonArr = [istasyon.koordinat.lng, istasyon.koordinat.lat];
    senaryolar.push({
      ad: `Rota (${istasyon.ad})`,
      istasyon: istasyon,
      promise: fetchORSRoute([baslangicArr, istasyonArr, bitisArr])
    });
  });

  const sonuclar = await Promise.allSettled(senaryolar.map(s => s.promise));

  // --- KARAR VE PUANLAMA ---
  let direktRotaVerisi = null;
  
  if (sonuclar[0].status === 'fulfilled' && sonuclar[0].value) {
    const rota = sonuclar[0].value;
    const mesafe = parseFloat(rota.ozet.mesafe_km);
    const harcananSarj = (mesafe / maxMenzil) * 100;
    const kalanSarj = baslangicSarjSayi - harcananSarj;
    const menzilYetersiz = (kalanSarj < 0); 

    let skor = parseFloat(rota.ozet.sure_dk) + (ORTALAMA_PIYASA_FIYATI * FIYAT_AGIRLIGI) + 45;
    let mesaj = "En Kısa Rota (Direkt)";

    if (menzilYetersiz) {
        skor = 99999; 
        mesaj = "⚠️ Menzil Yetmiyor (Direkt)";
    } else if (kalanSarj > SARJ_BITIS_ESIGI) {
        skor = -1000; 
        mesaj = "Şarj Yeterli: Direkt Rota Öneriliyor";
    }

    direktRotaVerisi = {
      ...rota,
      mesaj: mesaj,
      durak: null,
      kalanSarj: kalanSarj.toFixed(1), 
      menzilYetersiz: menzilYetersiz,
      sarjSuresi: 0,
      beklemeSuresi: 0,
      toplamSure: parseFloat(rota.ozet.sure_dk),
      sarjMaliyeti: 0,
      skor: skor
    };
  } else {
      throw new Error('Direkt rota hesaplanamadı.');
  }

  let enIyiRota = direktRotaVerisi;
  let enIyiSkor = direktRotaVerisi.skor;

  console.log(`[Direkt] Kalan: %${direktRotaVerisi.kalanSarj}, SKOR: ${enIyiSkor.toFixed(1)}`);

  sonuclar.forEach((sonuc, index) => {
    if (index === 0) return; 

    if (sonuc.status === 'fulfilled' && sonuc.value) {
      const rota = sonuc.value;
      const istasyon = senaryolar[index].istasyon;
      
      const distToStation = getKabaMesafe(baslangic, istasyon.koordinat) * 111; 
      const rangeToStationNeeded = (distToStation / maxMenzil) * 100;
      const stationArrivalCharge = baslangicSarjSayi - rangeToStationNeeded;

      // İstasyona varış kontrolü
      if (stationArrivalCharge < guvenlikPayi) {
          console.log(`[Elendi] ${istasyon.ad}: İstasyona varmaya şarj yetmiyor (%${stationArrivalCharge.toFixed(1)}).`);
          return;
      }

      // Şarj Süresi Hesabı
      let neededChargePercent = HEDEF_SARJ_SEVIYESI - stationArrivalCharge;
      if (neededChargePercent < 0) neededChargePercent = 0;

      const neededkWh = (neededChargePercent / 100) * bataryaKapasitesi;
      const stationPowerKW = (istasyon.tip === 'hizli') ? GUC_HIZLI_KW : GUC_YAVAS_KW;
      
      let sarjSuresiDakika = (neededkWh / stationPowerKW) * 60 + 5;
      if (neededChargePercent === 0) sarjSuresiDakika = 0;

      const sarjMaliyeti = neededkWh * istasyon.fiyat_kw;
      const chargedLevel = Math.max(stationArrivalCharge, HEDEF_SARJ_SEVIYESI);
      const toplamMesafe = parseFloat(rota.ozet.mesafe_km);
      const consumptionToEnd = ((toplamMesafe - distToStation) / maxMenzil) * 100;
      const finalCharge = chargedLevel - consumptionToEnd;

      const surusSuresi = parseFloat(rota.ozet.sure_dk);
      
      // Rezervasyon Kontrolü
      const distRatio = distToStation / toplamMesafe;
      const driveTimeToStation = surusSuresi * distRatio; 
      const beklemeSuresi = checkRezervasyonDurumu(istasyon, yolaCikisSaati, driveTimeToStation, sarjSuresiDakika);

      const toplamSure = surusSuresi + sarjSuresiDakika + beklemeSuresi;
      
      // SKORLAMA
      let skor = toplamSure + (istasyon.fiyat_kw * FIYAT_AGIRLIGI); 

      console.log(`[Aday] ${istasyon.ad}: Skor: ${skor.toFixed(1)} (Süre:${toplamSure.toFixed(0)}dk)`);

      // --- DÜZELTME BURADA ---
      // VEYA (||) operatörü kaldırıldı. Sadece SKOR daha iyiyse değiştir.
      if (skor < enIyiSkor && finalCharge > 0) {
        enIyiSkor = skor;
        enIyiRota = {
          mesaj: `Akıllı Rota: ${istasyon.ad}`,
          rotaCizgisi: rota.rotaCizgisi,
          ozet: rota.ozet,
          durak: istasyon,
          kalanSarj: finalCharge.toFixed(1),
          sarjSuresi: sarjSuresiDakika.toFixed(0),
          beklemeSuresi: beklemeSuresi.toFixed(0),
          toplamSure: toplamSure.toFixed(0),
          sarjMaliyeti: sarjMaliyeti.toFixed(2),
          istasyonaVarisDk: driveTimeToStation.toFixed(0), 
          skor: skor,
          menzilYetersiz: false
        };
      }
    }
  });

  if (enIyiRota === direktRotaVerisi && direktRotaVerisi.menzilYetersiz) {
      enIyiRota = {
          ...direktRotaVerisi,
          mesaj: "❌ Şarj Yetersiz: İstasyona Bile Varılamıyor!",
          menzilYetersiz: true,
          rotaImkansiz: true 
      };
  }

  if (!direktRotaVerisi.menzilYetersiz && parseFloat(direktRotaVerisi.kalanSarj) > SARJ_BITIS_ESIGI) {
      enIyiRota = { ...direktRotaVerisi, menzilYetersiz: false };
  }

  return {
    akilliRota: enIyiRota, 
    direktRota: direktRotaVerisi
  };
};

const getTumIstasyonlar = () => {
  return loadIstasyonlar();
};

module.exports = {
  calculateAkilliRota,
  getTumIstasyonlar,
  rezervasyonYap
};