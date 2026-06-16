importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyDEZlkBRFt4JtR1v3QGaBeTOPvD-Zg0cBs",
    authDomain: "magic-calculator-5dcac.firebaseapp.com",
    projectId: "magic-calculator-5dcac",
    storageBucket: "magic-calculator-5dcac.firebasestorage.app",
    messagingSenderId: "760520232651",
    appId: "1:760520232651:web:e22497f76382dc2086954e"
});

const messaging = firebase.messaging();

// FCM이 자동으로 알림을 표시하도록 놔둠 (직접 showNotification 호출 안 함)
// onBackgroundMessage를 등록하지 않으면 FCM SDK가 알아서 1번만 표시

// ===== 홈화면 앱이 항상 최신 HTML을 받도록 network-first =====
// 새 SW가 즉시 활성화되도록
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const HTML_CACHE = 'magic-html-v1';

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    // 페이지(HTML) 요청만 처리 — 온라인이면 항상 네트워크에서 최신을 가져오고,
    // 오프라인일 때만 마지막으로 받은 캐시로 폴백
    if (req.mode === 'navigate' || req.destination === 'document') {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(HTML_CACHE).then((c) => c.put('last-index', copy)).catch(() => {});
                    return res;
                })
                .catch(() => caches.open(HTML_CACHE).then((c) => c.match('last-index')))
        );
    }
    // 그 외(Firebase API, 스크립트 등)는 그대로 통과
});
