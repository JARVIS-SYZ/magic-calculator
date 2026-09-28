const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function read(name) {
    return fs.readFileSync(path.join(root, name), 'utf8');
}

function resolveFunction(html) {
    const match = html.match(/function resolveIos26\(val\) \{[\s\S]*?\n    \}/);
    assert.ok(match, 'resolveIos26 function must exist');
    return vm.runInNewContext(`(${match[0]})`);
}

for (const file of ['index.html', 'admin.html']) {
    test(`${file}: automatic mode uses the iOS 26+ interface`, () => {
        const html = read(file);
        const resolveIos26 = resolveFunction(html);

        assert.equal(resolveIos26('auto'), true);
        assert.equal(resolveIos26('26'), true);
        assert.equal(resolveIos26('18'), false);
    });

    test(`${file}: iOS 26+ keypad matches the native spacing`, () => {
        const html = read(file);

        assert.match(html, /body\.ios26-theme \{\s*--btn-w: calc\(\(100vw - 56px\) \/ 4\);\s*\}/);
        const expectedOffset = file === 'admin.html' ? 30 : 14;
        assert.match(html, new RegExp(`body\\.ios26-theme \\.calculator \\{\\s*transform: translateY\\(${expectedOffset}px\\);\\s*\\}`));
        assert.match(html, /body\.ios26-theme \.button-grid \{\s*gap: 8px;\s*padding: 0 16px 20px;\s*\}/);
        assert.match(html, /body\.ios26-theme \.button(?:\s|\{)[\s\S]*?transform: scale\(1\)/);
    });
}

test('admin automatic selection is not overwritten after detection', () => {
    assert.doesNotMatch(read('admin.html'), /ios26Mode\s*=\s*\(savedIosVersion\s*===\s*['"]26['"]\)/);
});
