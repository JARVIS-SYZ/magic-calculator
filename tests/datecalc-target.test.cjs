const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const admin = read('admin.html');
const audience = read('index.html');
function between(source, start, end) {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first);
    assert.ok(first >= 0 && last > first, `missing code between ${start} and ${end}`);
    return source.slice(first, last);
}
function storage() {
    const values = new Map();
    return {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value))
    };
}
function calculatorContext(source) {
    const localStorage = storage();
    const context = vm.createContext({localStorage, Date});
    vm.runInContext(between(source, '    function dtOffsetMin()', '    function dtButton()'), context);
    return context;
}
function adminSettingsFixture() {
    const c = calculatorContext(admin);
    const writes = [];
    const element = extra => ({value: '', style: {}, listeners: {},
        addEventListener(type, callback) {this.listeners[type] = callback;}, ...extra});
    const elements = {
        dtTargetModePage: element({value: 'time'}), dtOffsetPage: element({value: '0'}),
        dtOffsetRow: element(), dtYearRow: element(), dtCustomRow: element(),
        dtCustomTarget: element(), dtCustomApply: element(), dtCustomError: element(),
        dtYearDigitsPage: element(), dtTargetPreview: element()
    };
    Object.assign(c, {currentAdminId: 'mine', console, setInterval() {},
        document: {getElementById: id => elements[id] ?? null},
        db_auth: {collection: () => ({doc: () => ({set: value => {writes.push(value); return Promise.resolve();}})})},
        window: {}});
    vm.runInContext(between(admin, '    var dtCustomPending = false;', '    function dtToggle()'), c);
    vm.runInContext(between(admin, '    (function dtInitSetting() {', '    // +/− 를 두 번 탭'), c);
    return {c, elements, writes};
}

test('current time uses 10 or 12 digits, while a custom birthday uses eight', () => {
    const base = new Date(2026, 9, 11, 10, 20).getTime();
    for (const source of [admin, audience]) {
        const c = calculatorContext(source);
        assert.equal(c.dtTargetAt(base), '2610111020');
        c.localStorage.setItem('dt_year_digits', '4');
        assert.equal(c.dtTargetAt(base), '202610111020');
        c.localStorage.setItem('dt_custom_target', '19950327');
        c.localStorage.setItem('dt_target_mode', 'custom');
        assert.equal(c.dtTargetAt(base), '19950327');
        assert.equal(c.dtValidCustomTarget('20000229'), true);
        for (const value of ['19000229', '19951327', '19950332', '950327']) {
            assert.equal(c.dtValidCustomTarget(value), false, value);
        }
    }
});

test('the birthday picker converts dates and ignores invalid selections', () => {
    const c = calculatorContext(admin);
    assert.match(admin, /id="dtCustomTarget" type="date"/);
    assert.equal(c.dtDateToTarget('1995-03-27'), '19950327');
    assert.equal(c.dtTargetToDate('19950327'), '1995-03-27');
    assert.equal(c.dtDateToTarget('2023-02-29'), null);
    assert.equal(c.dtNormalizeCustomTarget('2609291530'), '20260929');
    assert.equal(c.dtNormalizeCustomTarget('202609291530'), '20260929');
    assert.equal(c.dtNormalizeCustomTarget('202609292560'), null);
});

test('custom mode hides time controls and publishes only the selected birthday', () => {
    const {c, elements, writes} = adminSettingsFixture();
    elements.dtTargetModePage.value = 'custom';
    elements.dtTargetModePage.listeners.change();
    assert.equal(elements.dtOffsetRow.style.display, 'none');
    assert.equal(elements.dtYearRow.style.display, 'none');
    assert.equal(elements.dtCustomRow.style.display, '');
    assert.equal(elements.dtTargetPreview.textContent, '적용 전');
    assert.equal(writes.length, 0);

    elements.dtCustomTarget.value = '2023-02-29';
    elements.dtCustomApply.listeners.click();
    assert.equal(writes.length, 0);
    assert.match(elements.dtCustomError.textContent, /생년월일/);

    elements.dtCustomTarget.value = '1995-03-27';
    elements.dtCustomApply.listeners.click();
    assert.deepEqual(JSON.parse(JSON.stringify(writes[0])),
        {dtTargetMode: 'custom', dtCustomTarget: '19950327'});
    assert.equal(c.localStorage.getItem('dt_target_mode'), 'custom');
    assert.equal(elements.dtTargetPreview.textContent, '19950327');

    elements.dtTargetModePage.value = 'time';
    elements.dtTargetModePage.listeners.change();
    assert.equal(elements.dtOffsetRow.style.display, '');
    assert.equal(elements.dtYearRow.style.display, '');
    assert.equal(elements.dtCustomRow.style.display, 'none');
    assert.equal(writes[1].dtTargetMode, 'time');
    elements.dtYearDigitsPage.listeners.change({target: {value: '4'}});
    assert.equal(c.dtTargetAt(new Date(2026, 9, 11, 10, 20).getTime()), '202610111020');
});

test('admin and audience read the same birthday from cloud settings', () => {
    const adminFixture = adminSettingsFixture();
    adminFixture.c.window.__setDateCalcTargetConfig({dtTargetMode: 'custom', dtCustomTarget: '19950327', dtYearDigits: 4});
    assert.equal(adminFixture.elements.dtTargetModePage.value, 'custom');
    assert.equal(adminFixture.elements.dtCustomTarget.value, '1995-03-27');
    assert.equal(adminFixture.elements.dtOffsetRow.style.display, 'none');

    const c = calculatorContext(audience);
    vm.runInContext(between(audience, '    function applyCloudConfig(c) {', "        if (typeof c.dateCalc") + '\n}', c);
    c.applyCloudConfig({dtTargetMode: 'custom', dtCustomTarget: '19950327', dtYearDigits: 4});
    assert.equal(c.dtTargetAt(Date.now()), '19950327');
    c.applyCloudConfig({dtTargetMode: 'custom', dtCustomTarget: '2609291530'});
    assert.equal(c.dtTargetAt(Date.now()), '20260929');
    c.applyCloudConfig({dtOffset: 1});
    assert.equal(c.localStorage.getItem('dt_target_mode'), 'time');
    assert.equal(c.dtYearDigits(), 2);
});
