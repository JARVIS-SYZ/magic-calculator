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

test('an OS-owned top inset clips the screenshot instead of shrinking it below the status bar', () => {
    const c = fixture({ height: 812, safeTop: 0 });
    const f = c.spViewportFrame();
    assert.equal(f.top, 62);
    assert.equal(f.height, 874);
    assert.equal(c.spImgLayout(f).dh, 874);
    assert.equal(100 - f.top, 38);
});

test('browser chrome, keyboard, zoom and rotation are not treated as an OS top inset', () => {
    for (const options of [
        { height: 812, safeTop: 0, standalone: false },
        { height: 550, safeTop: 0 },
        { height: 812, safeTop: 0, scale: 2 },
        { width: 874, height: 402, safeTop: 0 }
    ]) assert.equal(fixture(options).spViewportFrame().top, 0);
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
