const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function read(name) {
    return fs.readFileSync(path.join(root, name), 'utf8');
}

// 기기 감지 함수만 떼어 내 가짜 기기 정보로 돌려 본다
function detector(html, { ua, supports = [], webTransport = false }) {
    const match = html.match(/function detectIosScreen\(\) \{[\s\S]*?\n    \}/);
    assert.ok(match, 'detectIosScreen function must exist');
    const ctx = vm.createContext({
        navigator: { userAgent: ua },
        window: { CSS: { supports: (c) => supports.includes(c) }, WebTransport: webTransport ? function () {} : undefined },
        CSS: { supports: (c) => supports.includes(c) }
    });
    vm.runInContext(match[0], ctx);
    return ctx.detectIosScreen();
}
const FROZEN = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

for (const file of ['index.html', 'admin.html']) {
    test(`${file}: the iOS screen version is detected from the device`, () => {
        const html = read(file);
        // Safari는 Version 토큰으로
        assert.equal(detector(html, { ua: FROZEN.replace('Mobile/', 'Version/27.0 Mobile/') }), '27');
        assert.equal(detector(html, { ua: FROZEN.replace('Mobile/', 'Version/26.2 Mobile/') }), '26');
        assert.equal(detector(html, { ua: FROZEN.replace('Mobile/', 'Version/18.6 Mobile/') }), '18');
        // 홈 화면 앱(Version 없음)은 지원 기능으로 (iOS 17.5 / 26.2 / 27.0 시뮬레이터 측정값)
        assert.equal(detector(html, { ua: FROZEN, supports: ['anchor-name: --a', 'display: grid-lanes', 'appearance: base-select'], webTransport: true }), '27');
        assert.equal(detector(html, { ua: FROZEN, supports: ['anchor-name: --a'] }), '26');
        assert.equal(detector(html, { ua: FROZEN }), '18');
    });

    test(`${file}: iOS 26+ keypad matches the native spacing`, () => {
        const html = read(file);

        assert.match(html, /body\.ios26-theme \{\s*--btn-w: calc\(\(100vw - 56px\) \/ 4\);\s*\}/);
        // 관객용도 관리자와 같은 위치에 키패드가 놓여야 한다
        assert.match(html, /apple-mobile-web-app-status-bar-style" content="black-translucent"/);
        assert.match(html, /document\.documentElement\.classList\.add\('ios-device'\)/);
        assert.match(html, /html\.ios-device \.calculator \{\s*padding-top: calc\(env\(safe-area-inset-top\) \+ 30px\);\s*\}/);
        assert.match(html, /html\.ios-device \.button-grid \{\s*padding-bottom: max\(9px, calc\(env\(safe-area-inset-bottom, 0px\) - 15px\)\);\s*\}/);
        assert.doesNotMatch(html, /body\.ios26-theme \.calculator \{\s*transform/);
        const keypadBottom = 5;
        assert.match(html, new RegExp(`body\\.ios26-theme \\.button-grid \\{\\s*gap: 8px;\\s*padding: 0 16px ${keypadBottom}px;\\s*\\}`));
        assert.match(html, /body\.ios26-theme \.button(?:\s|\{)[\s\S]*?transform: scale\(1\)/);
    });
}

test('admin automatic selection is not overwritten after detection', () => {
    assert.doesNotMatch(read('admin.html'), /ios26Mode\s*=\s*\(savedIosVersion\s*===\s*['"]26['"]\)/);
});

test('the audience screen ignores the admin version choice and the link has no ios param', () => {
    assert.match(read('index.html'), /function resolveIos26\(\) \{ const v = detectIosScreen\(\);/);
    assert.doesNotMatch(read('admin.html'), /\n\s*ios,\n\s*admin: currentAdminId/);
});
