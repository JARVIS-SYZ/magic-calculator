const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");

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

const API_REGION = "asia-northeast3";
const MAX_HISTORY_LIMIT = 100;

function setCorsHeaders(res) {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Cache-Control", "no-store");
}

function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function getBearerToken(req) {
    const value = req.get("authorization") || "";
    const match = value.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : "";
}

function serializeCalculation(doc) {
    const data = doc.data();
    const timestamp = data.timestamp?.toDate
        ? data.timestamp.toDate().toISOString()
        : null;

    return {
        id: doc.id,
        expression: data.expression || "",
        result: data.result ?? "",
        calcId: data.calcId || "",
        isForce: Boolean(data.isForce),
        timestamp,
    };
}

async function authenticateApiKey(req) {
    const key = getBearerToken(req);
    if (!key || !key.startsWith("mc_live_")) return null;

    const keyDoc = await admin.firestore()
        .collection("api_keys")
        .doc(sha256(key))
        .get();

    if (!keyDoc.exists || keyDoc.data().active === false) return null;
    return keyDoc.data();
}

async function issueApiKey(req, res) {
    const code = String(req.body?.code || "").replace(/\D/g, "");
    const requestedAdminId = String(req.body?.adminId || "").trim();

    if (code.length !== 6 || !requestedAdminId) {
        res.status(400).json({ error: "code와 adminId가 필요합니다." });
        return;
    }

    const codeDoc = await admin.firestore()
        .collection("admin_codes")
        .doc(code)
        .get();

    if (!codeDoc.exists || codeDoc.data().adminId !== requestedAdminId) {
        res.status(403).json({ error: "관리자 인증에 실패했습니다." });
        return;
    }

    const db = admin.firestore();
    const existing = await db.collection("api_keys")
        .where("adminId", "==", requestedAdminId)
        .get();
    const batch = db.batch();
    existing.forEach(doc => batch.delete(doc.ref));

    const rawKey = `mc_live_${crypto.randomBytes(24).toString("base64url")}`;
    const keyRef = db.collection("api_keys").doc(sha256(rawKey));
    batch.set(keyRef, {
        adminId: requestedAdminId,
        code,
        active: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await batch.commit();

    res.status(201).json({
        apiKey: rawKey,
        endpoint: `https://${API_REGION}-magic-calculator-5dcac.cloudfunctions.net/calculationsApi`,
    });
}

async function getCalculations(req, res, keyData, latestOnly) {
    const snapshot = await admin.firestore()
        .collection("calculations")
        .where("adminId", "==", keyData.adminId)
        .get();

    const sorted = snapshot.docs.sort((a, b) => {
        const aTime = a.data().timestamp?.toMillis?.() || 0;
        const bTime = b.data().timestamp?.toMillis?.() || 0;
        return bTime - aTime;
    });

    if (latestOnly) {
        res.json({ data: sorted[0] ? serializeCalculation(sorted[0]) : null });
        return;
    }

    const requestedLimit = Number.parseInt(req.query.limit, 10) || 20;
    const limit = Math.min(Math.max(requestedLimit, 1), MAX_HISTORY_LIMIT);
    res.json({
        data: sorted.slice(0, limit).map(serializeCalculation),
        count: Math.min(sorted.length, limit),
    });
}

exports.calculationsApi = onRequest(
    { region: API_REGION, timeoutSeconds: 30 },
    async (req, res) => {
        setCorsHeaders(res);
        if (req.method === "OPTIONS") {
            res.status(204).send("");
            return;
        }

        try {
            const path = req.path.replace(/\/+$/, "") || "/";

            if (req.method === "POST" && path === "/keys") {
                await issueApiKey(req, res);
                return;
            }

            if (req.method !== "GET") {
                res.status(405).json({ error: "지원하지 않는 요청입니다." });
                return;
            }

            const keyData = await authenticateApiKey(req);
            if (!keyData) {
                res.status(401).json({ error: "유효한 Bearer API 키가 필요합니다." });
                return;
            }

            if (path === "/latest") {
                await getCalculations(req, res, keyData, true);
                return;
            }
            if (path === "/history") {
                await getCalculations(req, res, keyData, false);
                return;
            }

            res.json({
                endpoints: ["GET /latest", "GET /history?limit=20"],
                authentication: "Authorization: Bearer mc_live_...",
            });
        } catch (error) {
            console.error("calculationsApi 오류:", error);
            res.status(500).json({ error: "API 처리 중 오류가 발생했습니다." });
        }
    }
);
