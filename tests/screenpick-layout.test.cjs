const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '../admin.html'), 'utf8');
function sourceBetween(start, end) {
    const from = html.indexOf(start);
    const to = html.indexOf(end, from);
    assert.ok(from >= 0 && to > from);
    return html.slice(from, to);
}
const geometry = sourceBetween('function spViewportFrame()', 'function spBaseShift()')
    + sourceBetween('function spImgLayout(r)', 'function spLayoutStage()');

test('the iOS 27 blur guard is active only outside screen pick mode', () => {
    assert.match(html, /@media \(display-mode:\s*standalone\)[\s\S]*?#iosTopBlurGuard\s*\{[\s\S]*?height:\s*11px;[\s\S]*?background-color:\s*#000;[\s\S]*?-webkit-background-clip:\s*text;/);
    assert.match(html, /html\.screen-pick-active\s+#iosTopBlurGuard\s*\{\s*display:\s*none;\s*\}/);
    assert.match(html, /<div id="iosTopBlurGuard" aria-hidden="true"><\/div>/);
});

function fixture({ width = 402, height = 874, safeTop = 62, standalone = true,
    scale = 1, shift = 0, imageWidth = 1206, imageHeight = 2622 } = {}) {
    const context = vm.createContext({
        window: { innerWidth: width, innerHeight: height, visualViewport: { scale } },
        screen: { width: 402, height: 874 }, navigator: { standalone },
        document: { documentElement: {} },
        getComputedStyle: () => ({ getPropertyValue: () => `${safeTop}px` }),
        spImgW: imageWidth, spImgH: imageHeight, spEffShift: () => shift
    });
    vm.runInContext(geometry, context);
    return context;
}

test('a same-device screenshot occupies the full screen without rescaling or offset', () => {
    const c = fixture();
    const f = c.spViewportFrame();
    const image = c.spImgLayout(f);
    assert.equal(f.top, 0);
    assert.equal(image.dw, 402);
    assert.equal(image.dh, 874);
    assert.equal(image.ox, 0);
    assert.equal(image.oy, 0);
});

test('an OS-owned top inset keeps the screenshot anchored at its visible top edge', () => {
    const c = fixture({ height: 812, safeTop: 0 });
    const f = c.spViewportFrame();
    assert.equal(f.top, 0);
    assert.equal(f.excludedTop, 62);
    assert.equal(f.height, 874);
    assert.equal(c.spImgLayout(f).dh, 874);
    assert.equal(c.spImgLayout(f).oy, 0);
});

test('iOS 27 fills the physical screen when safe-area and viewport cropping are both reported', () => {
    const c = fixture({ height: 812, safeTop: 62 });
    const f = c.spViewportFrame();
    assert.equal(f.height, 874);
    assert.equal(f.viewportGap, 62);
    assert.equal(f.excludedTop, 0);
    assert.equal(c.spImgLayout(f).dh, 874);
    assert.equal(c.spImgLayout(f).oy, 0);
});

test('browser chrome, keyboard, zoom and rotation are not treated as an OS top inset', () => {
    for (const options of [
        { height: 812, safeTop: 0, standalone: false },
        { height: 550, safeTop: 0 },
        { height: 812, safeTop: 0, scale: 2 },
        { width: 874, height: 402, safeTop: 0 }
    ]) assert.equal(fixture(options).spViewportFrame().excludedTop, 0);
});

test('moving a photo never changes its scale, including negative adjustments', () => {
    for (const shift of [-20, 20]) {
        const c = fixture({ shift });
        const image = c.spImgLayout(c.spViewportFrame());
        assert.equal(image.oy, -shift);
        assert.equal(image.dw, 402);
        assert.equal(image.dh, 874);
    }
});

test('preview and eyedropper use the same centered crop and movement as the stage', () => {
    const c = fixture({ shift: 17, imageWidth: 1800, imageHeight: 1800 });
    const full = c.spImgLayout({ width: 402, height: 874 });
    const half = c.spImgLayout({ width: 201, height: 437 });
    for (const key of ['dw', 'dh', 'ox', 'oy']) assert.equal(half[key] * 2, full[key]);
    assert.ok(full.ox < 0);
});

test('a slightly taller screenshot remains anchored to the top instead of center-cropping upward', () => {
    const c = fixture({ imageWidth: 1206, imageHeight: 2700 });
    const image = c.spImgLayout(c.spViewportFrame());
    assert.ok(image.dh > 874);
    assert.equal(image.oy, 0);
});

test('removed screen pick controls are absent and old effects are disabled', () => {
    for (const id of ['spPanelBox', 'spPanelBar', 'spShiftInput', 'spShiftAuto']) {
        assert.ok(!html.includes(`id="${id}"`));
    }
    const values = new Map([
        ['sp_layout_version', '2'], ['sp_box_on', 'true'],
        ['sp_bar_on', 'true'], ['sp_shift_adj', '35']
    ]);
    const context = vm.createContext({ localStorage: {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value)
    } });
    vm.runInContext(sourceBetween('const SP = {', 'let spImage ='), context);
    assert.equal(values.get('sp_layout_version'), '3');
    assert.equal(values.get('sp_box_on'), 'false');
    assert.equal(values.get('sp_bar_on'), 'false');
    assert.equal(values.get('sp_shift_adj'), '0');
});

test('touch tab enables and persists the touch area; manual disable still works', () => {
    const elements = new Map();
    function element(id) {
        if (!elements.has(id)) elements.set(id, {
            style: {}, dataset: {}, classList: { toggle() {} },
            listeners: {}, addEventListener(type, callback) { this.listeners[type] = callback; }
        });
        return elements.get(id);
    }
    const tabs = ['text', 'tap'].map(name => {
        const tab = element(name); tab.dataset.target = name; return tab;
    });
    const saved = new Map();
    const c = vm.createContext({
        document: { getElementById: element, querySelectorAll: () => tabs },
        spTarget: 'text', spTapOn: false, SP: { tapOn: 'sp_tap_on' },
        spSave: (key, value) => saved.set(key, value),
        spSetPicking() {}, spApplyPreviewStyle() {}
    });
    vm.runInContext(sourceBetween('        // 편집 대상 탭', '        // 글자'), c);
    vm.runInContext(sourceBetween("        const pOn = document.getElementById('spTapToggle');", '        const pW ='), c);
    tabs[1].listeners.click();
    assert.equal(c.spTapOn, true);
    assert.equal(element('spTapToggle').checked, true);
    assert.equal(saved.get('sp_tap_on'), true);
    element('spTapToggle').checked = false;
    element('spTapToggle').listeners.change();
    assert.equal(c.spTapOn, false);
    assert.equal(saved.get('sp_tap_on'), false);
    tabs[0].listeners.click();
    assert.equal(c.spTapOn, false);
    tabs[1].listeners.click();
    assert.equal(c.spTapOn, true);
});

test('small text sizes synchronize the controls and persist without a preview floor', () => {
    const c = vm.createContext({ spSize: 40, size: {}, sizeNum: {}, SP: { size: 'sp_size' },
        spSave(key, value) { c.saved = value; }, spApplyPreviewStyle() {} });
    vm.runInContext(sourceBetween('        function setSize(v)', '        if (size) {'), c);
    for (const value of [1, 5, 9, 10, 40, 240]) {
        c.setSize(value);
        assert.equal(c.spSize, value);
        assert.equal(c.size.value, String(value));
        assert.equal(c.sizeNum.value, String(value));
        assert.equal(c.saved, value);
    }
    c.setSize(0); assert.equal(c.spSize, 1);
    c.setSize(999); assert.equal(c.spSize, 240);
    assert.match(html, /spApplyTextStyle\(t, spSize \* scale\)/);
});
