const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();

exports.sendPushOnCalculation = onDocumentCreated(
    "calculations/{docId}",
    async (event) => {
        const data = event.data.data();
        const expression = data.expression || "";
        const calcId = data.calcId || "";
        const adminId = data.adminId || null;

        if (!adminId) {
            console.log("adminId 없음, 발송 생략");
            return null;
        }

        const tokensSnapshot = await admin.firestore()
            .collection("fcm_tokens")
            .where("adminId", "==", adminId)
            .get();

        if (tokensSnapshot.empty) {
            console.log("해당 관리자 토큰 없음:", adminId);
            return null;
        }

        // 중복 토큰 제거 후 전송
        const tokenMap = {};
        tokensSnapshot.docs.forEach(doc => {
            tokenMap[doc.data().token] = doc.id;
        });
        const uniqueTokens = Object.keys(tokenMap);

        console.log(`토큰 ${uniqueTokens.length}개로 발송`);

        const message = {
            notification: {
                title: "계산기 입력",
                body: expression,
            },
            data: { expression, calcId },
            tokens: uniqueTokens,
        };

        const response = await admin.messaging().sendEachForMulticast(message);
        console.log("푸시 발송:", response.successCount, "성공");

        // 실패한 토큰 삭제
        const batch = admin.firestore().batch();
        let hasFailed = false;
        response.responses.forEach((resp, idx) => {
            if (!resp.success) {
                const docId = tokenMap[uniqueTokens[idx]];
                batch.delete(admin.firestore().collection("fcm_tokens").doc(docId));
                hasFailed = true;
                console.log("실패 토큰 삭제:", uniqueTokens[idx]);
            }
        });
        if (hasFailed) await batch.commit();

        return null;
    }
);
