// ============================================================
// KONFIGURASI MQTT (Sesuaikan topik dengan kode ESP32 Anda)
// ============================================================
const TOPIC_SENSOR = "raksepatu_pro_01/sensor";
const TOPIC_KONTROL = "raksepatu_pro_01/kontrol";

// Otomatis memilih WSS (HTTPS, mis. saat deploy di Vercel) atau WS (HTTP/Lokal)
const BROKER_URL = window.location.protocol === "https:"
  ? "wss://broker.hivemq.com:8884/mqtt"
  : "ws://broker.hivemq.com:8000/mqtt";

const client = typeof mqtt !== "undefined"
  ? mqtt.connect(BROKER_URL, {
    clientId: "raksepatu_web_" + Math.random().toString(16).slice(2, 10),
    clean: true,
    connectTimeout: 10000,
    reconnectPeriod: 3000
  })
  : null;

// State lokal dashboard
let state = {
  suhu: 0,
  kelembapan: 0,
  threshold: 75,
  pintu_tertutup: true,
  mode: "AUTO",
  uv: false,
  fan: false,
  timer_aktif: false,
  sisa_detik: 0
};

let modeSimulasi = false;
let intervalSimulasi = null;

// ============================================================
// KONEKSI MQTT REAL-TIME
// ============================================================
if (client) {
  client.on("connect", () => {
    if (modeSimulasi) return;
    const badge = document.getElementById("status-koneksi");
    badge.innerText = "Terhubung ke ESP32 (MQTT)";
    badge.className = "status-badge online";
    client.subscribe(TOPIC_SENSOR);
  });

  client.on("reconnect", () => {
    if (!modeSimulasi) {
      const badge = document.getElementById("status-koneksi");
      badge.innerText = "Menghubungkan ulang MQTT...";
      badge.className = "status-badge offline";
    }
  });

  client.on("offline", () => {
    if (!modeSimulasi) {
      const badge = document.getElementById("status-koneksi");
      badge.innerText = "MQTT Terputus";
      badge.className = "status-badge offline";
    }
  });

  client.on("error", (err) => {
    console.error("MQTT error:", err);
    if (!modeSimulasi) {
      const badge = document.getElementById("status-koneksi");
      badge.innerText = "Gagal Terhubung MQTT";
      badge.className = "status-badge offline";
    }
  });

  client.on("message", (topic, payload) => {
    if (modeSimulasi || topic !== TOPIC_SENSOR) return;
    try {
      const data = JSON.parse(payload.toString());
      state = { ...state, ...data };
      renderDashboard();
    } catch (e) {
      console.error("Format JSON tidak valid:", e);
    }
  });
} else {
  const badge = document.getElementById("status-koneksi");
  if (badge) {
    badge.innerText = "Library MQTT tidak termuat";
    badge.className = "status-badge offline";
  }
}

// ============================================================
// RENDER TAMPILAN DASHBOARD (5 FITUR UTAMA)
// ============================================================
function renderDashboard() {
  // 1. Suhu & Kelembapan DHT22
  document.getElementById("val-kelembapan").innerText = Number(state.kelembapan).toFixed(1);
  document.getElementById("val-suhu").innerText = Number(state.suhu).toFixed(1);
  document.getElementById("text-threshold").innerText = state.threshold;
  const pct = Math.min(100, Math.max(0, state.kelembapan));
  document.getElementById("bar-kelembapan").style.width = pct + "%";

  // 2. Status ON/OFF Lampu UV
  const pillUv = document.getElementById("pill-uv");
  const textUv = document.getElementById("text-uv-status");
  if (state.uv) {
    pillUv.innerText = "ON";
    pillUv.className = "pill on";
    textUv.innerText = "MENYALA";
    textUv.className = "status-big on";
  } else {
    pillUv.innerText = "OFF";
    pillUv.className = "pill off";
    textUv.innerText = "MATI";
    textUv.className = "status-big off";
  }
  document.getElementById("text-fan-status").innerText = state.fan ? "ON" : "OFF";

  // 3. Estimasi Waktu Selesai & Hitung Mundur
  const elEstimasi = document.getElementById("val-estimasi");
  const elCountdown = document.getElementById("val-countdown");
  const subEstimasi = document.getElementById("sub-estimasi");

  if (state.timer_aktif && state.sisa_detik > 0) {
    const m = Math.floor(state.sisa_detik / 60);
    const s = state.sisa_detik % 60;
    const formatSisa = String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");

    // Hitung jam selesai berdasarkan waktu lokal saat ini + sisa_detik
    const waktuSelesai = new Date(Date.now() + state.sisa_detik * 1000);
    const jam = String(waktuSelesai.getHours()).padStart(2, "0");
    const menit = String(waktuSelesai.getMinutes()).padStart(2, "0");

    elEstimasi.innerText = `${jam}:${menit} WIB`;
    subEstimasi.innerHTML = `Sisa waktu: <strong>${formatSisa}</strong>`;
  } else {
    elEstimasi.innerText = "--:--";
    subEstimasi.innerHTML = `Sisa waktu: <strong>00:00</strong> (Tidak ada timer)`;
  }

  // 5. Deteksi Pintu Tertutup atau Tidak
  const pillPintu = document.getElementById("pill-pintu");
  const valPintu = document.getElementById("val-pintu");
  const subPintu = document.getElementById("sub-pintu");
  const bannerPintu = document.getElementById("banner-pintu");

  if (state.pintu_tertutup) {
    pillPintu.innerText = "AMAN";
    pillPintu.className = "pill on";
    valPintu.innerText = "TERTUTUP";
    valPintu.className = "status-big text-safe";
    subPintu.innerText = "Sensor MC-38 terkunci rapat";
    bannerPintu.classList.add("hidden");
  } else {
    pillPintu.innerText = "TERBUKA";
    pillPintu.className = "pill danger";
    valPintu.innerText = "TERBUKA";
    valPintu.className = "status-big text-danger";
    subPintu.innerText = "UV-C dinonaktifkan otomatis!";
    bannerPintu.classList.remove("hidden");
  }

  // Update Badge Mode
  document.getElementById("badge-mode").innerText = state.mode;
}

// ============================================================
// FUNGSI KONTROL KE ESP32 / SIMULASI
// ============================================================
function kirimPerintah(payload) {
  if (modeSimulasi) {
    terapkanSimulasi(payload);
    return;
  }
  if (!client || !client.connected) {
    alert("Belum terhubung ke broker MQTT. Aktifkan Mode Simulasi atau tunggu koneksi ESP32.");
    return;
  }
  client.publish(TOPIC_KONTROL, JSON.stringify(payload));
}

// 4. Pengaturan Waktu / Timer
function mulaiTimer(menit) {
  if (!state.pintu_tertutup) {
    alert("Pintu rak sepatu TERBUKA! Tutup pintu terlebih dahulu sebelum menyalakan Timer UV-C.");
    return;
  }
  kirimPerintah({ timer_minutes: menit });
}

function mulaiTimerKustom() {
  const input = document.getElementById("input-menit");
  const menit = parseInt(input.value, 10);
  if (isNaN(menit) || menit <= 0) {
    alert("Masukkan jumlah menit yang valid (minimal 1 menit).");
    return;
  }
  mulaiTimer(menit);
  input.value = "";
}

function hentikanTimer() {
  kirimPerintah({ timer_minutes: 0 });
}

function ubahMode(mode) {
  kirimPerintah({ mode: mode });
}

function kontrolUV(nyala) {
  if (nyala && !state.pintu_tertutup) {
    alert("Keamanan Aktif: Tidak dapat menyalakan lampu UV-C saat pintu terbuka!");
    return;
  }
  kirimPerintah({ mode: "MANUAL", uv: nyala, fan: nyala });
}

function simpanThreshold() {
  const val = parseFloat(document.getElementById("input-threshold").value);
  if (isNaN(val) || val < 30 || val > 95) {
    alert("Masukkan batas kelembapan antara 30% - 95%.");
    return;
  }
  kirimPerintah({ threshold: val });
}

// ============================================================
// MODE SIMULASI (Untuk Uji Tampilan Web Tanpa Alat ESP32)
// ============================================================
function toggleSimulasi() {
  modeSimulasi = !modeSimulasi;
  const btn = document.getElementById("btn-simulasi");
  const badge = document.getElementById("status-koneksi");

  if (modeSimulasi) {
    btn.innerText = "Mode Simulasi: ON";
    btn.classList.add("active");
    badge.innerText = "Simulasi Lokal Aktif";
    badge.className = "status-badge online";

    state = {
      suhu: 31.4,
      kelembapan: 78.5,
      threshold: 75,
      pintu_tertutup: true,
      mode: "AUTO",
      uv: true,
      fan: true,
      timer_aktif: false,
      sisa_detik: 0
    };
    renderDashboard();

    intervalSimulasi = setInterval(() => {
      if (state.timer_aktif && state.sisa_detik > 0) {
        state.sisa_detik--;
        if (state.sisa_detik === 0) {
          state.timer_aktif = false;
          state.uv = false;
          state.fan = false;
        }
      }
      renderDashboard();
    }, 1000);
  } else {
    btn.innerText = "Mode Simulasi: OFF";
    btn.classList.remove("active");
    clearInterval(intervalSimulasi);
    const connected = Boolean(client && client.connected);
    badge.innerText = connected ? "Terhubung ke ESP32 (MQTT)" : "Menghubungkan MQTT...";
    badge.className = connected ? "status-badge online" : "status-badge offline";
  }
}

function terapkanSimulasi(payload) {
  if (payload.mode) {
    state.mode = payload.mode;
    if (state.mode === "AUTO") {
      state.timer_aktif = false;
      state.uv = state.kelembapan > state.threshold;
      state.fan = state.uv;
    }
  }
  if (payload.threshold !== undefined) {
    state.threshold = payload.threshold;
  }
  if (payload.uv !== undefined) {
    state.uv = payload.uv;
    state.fan = payload.fan ?? payload.uv;
    if (!state.uv) state.timer_aktif = false;
  }
  if (payload.timer_minutes !== undefined) {
    if (payload.timer_minutes > 0) {
      state.mode = "MANUAL";
      state.timer_aktif = true;
      state.sisa_detik = payload.timer_minutes * 60;
      state.uv = true;
      state.fan = true;
    } else {
      state.timer_aktif = false;
      state.sisa_detik = 0;
      state.uv = false;
      state.fan = false;
    }
  }
  renderDashboard();
}
