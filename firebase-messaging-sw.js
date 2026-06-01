// firebase-messaging-sw.js
// 반드시 루트(/)에 위치해야 함

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

// 백그라운드 메시지 수신
messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || '계산기 입력';
    const body  = payload.notification?.body  || '';

    self.registration.showNotification(title, {
        body: body,
        icon: '/icon-180.png',
        badge: '/icon-180.png',
        vibrate: [200, 100, 200]
    });
});
