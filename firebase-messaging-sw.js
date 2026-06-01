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
