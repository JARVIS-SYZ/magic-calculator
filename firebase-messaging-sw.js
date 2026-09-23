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

function cacheKey(url) {
    try { return 'page:' + new URL(url).pathname; } catch (e) { return 'page:last-index'; }
}

function offlinePage() {
    return new Response(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<title>연결 없음</title>'
        + '<body style="margin:0;background:#000;color:#fff;font:16px -apple-system,sans-serif;'
        + 'display:flex;align-items:center;justify-content:center;height:100vh;text-align:center">'
        + '<div>네트워크에 연결되어 있지 않습니다.<br><br>'
        + '<button onclick="location.reload()" style="padding:10px 18px;border:none;border-radius:10px;'
        + 'background:#0a84ff;color:#fff;font-size:15px">다시 시도</button></div>',
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    // 페이지(HTML) 요청만 처리 — 온라인이면 항상 네트워크에서 최신을 가져오고,
    // 오프라인일 때만 마지막으로 받은 캐시로 폴백
    if (req.mode === 'navigate' || req.destination === 'document') {
        event.respondWith(
            // GitHub Pages가 HTML에 max-age=600을 붙여서 그냥 fetch하면 최대 10분간
            // 낡은 HTML이 나옴 - cache:'reload'로 HTTP 캐시를 건너뛰고 항상 원본에서 받음
            fetch(req.url, { cache: 'reload', credentials: 'same-origin' })
                .then((res) => {
                    const copy = res.clone();
                    // 페이지마다 따로 저장한다. 예전엔 키가 하나뿐이라 admin과 index가
                    // 서로를 덮어써서, 오프라인일 때 엉뚱한 페이지가 나올 수 있었다.
                    caches.open(HTML_CACHE).then((c) => c.put(cacheKey(req.url), copy)).catch(() => {});
                    return res;
                })
                .catch(() => caches.open(HTML_CACHE)
                    .then((c) => c.match(cacheKey(req.url)))
                    // 캐시에도 없으면 undefined가 넘어가 respondWith가 터진다
                    // ('Returned response is null'). 반드시 Response를 돌려준다.
                    .then((hit) => hit || offlinePage())
                    .catch(() => offlinePage()))
        );
    }
    // 그 외(Firebase API, 스크립트 등)는 그대로 통과
});
