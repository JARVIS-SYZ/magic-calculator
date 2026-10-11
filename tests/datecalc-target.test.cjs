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

test('both calculators accept valid fixed dates and reject malformed or impossible dates', () => {
    for (const source of [admin, audience]) {
        const c = calculatorContext(source);
        assert.equal(c.dtValidCustomTarget('2402292359'), true);
        for (const value of ['2302292359', '2413011200', '2412312460', '240101120', 'not-a-date']) {
            assert.equal(c.dtValidCustomTarget(value), false, value);
        }
        const base = new Date(2026, 9, 11, 10, 20).getTime();
        assert.equal(c.dtTargetAt(base), '2610111020');
        c.localStorage.setItem('dt_custom_target', '2402292359');
        c.localStorage.setItem('dt_target_mode', 'custom');
        assert.equal(c.dtTargetAt(base), '2402292359');
        c.localStorage.setItem('dt_target_mode', 'time');
        assert.equal(c.dtTargetAt(base), '2610111020');
    }
});

test('admin publishes only valid custom targets and can return to time mode', () => {
    const c = calculatorContext(admin);
    const writes = [];
    const elements = {
        dtOffsetPage: {value: 'custom'}, dtCustomTarget: {value: '2302292359'},
        dtCustomError: {style: {}, textContent: ''}, dtCustomRow: {style: {}},
        dtTargetPreview: {textContent: ''}
    };
    Object.assign(c, {
        currentAdminId: 'mine', console,
        document: {getElementById: id => elements[id] ?? null},
        db_auth: {collection: () => ({doc: () => ({set: value => {writes.push(value); return Promise.resolve();}})})},
        window: {}
    });
    vm.runInContext(between(admin, '    function dtShowCustomError(message)', '    function dtToggle()'), c);
    c.dtSaveCustomTarget();
    assert.equal(writes.length, 0);
    assert.equal(c.localStorage.getItem('dt_target_mode'), null);
    assert.match(elements.dtCustomError.textContent, /10자리/);

    elements.dtCustomTarget.value = '2609291530';
    c.dtSaveCustomTarget();
    assert.deepEqual(JSON.parse(JSON.stringify(writes[0])), {dtTargetMode: 'custom', dtCustomTarget: '2609291530'});
    assert.equal(elements.dtTargetPreview.textContent, '2609291530');
    assert.equal(c.localStorage.getItem('dt_target_mode'), 'custom');

    c.dtSyncOffset(2);
    assert.deepEqual(JSON.parse(JSON.stringify(writes[1])), {dtOffset: 2, dtTargetMode: 'time'});
    assert.equal(c.localStorage.getItem('dt_target_mode'), 'time');
    assert.equal(elements.dtCustomRow.style.display, 'none');
});

test('audience applies cloud target and legacy configs stay in time mode', () => {
    const c = calculatorContext(audience);
    vm.runInContext(between(audience, '    function applyCloudConfig(c) {', "        if (typeof c.dateCalc") + '\n}', c);
    c.applyCloudConfig({dtTargetMode: 'custom', dtCustomTarget: '2609291530'});
    assert.equal(c.dtTargetAt(Date.now()), '2609291530');
    c.applyCloudConfig({dtOffset: 1});
    assert.equal(c.localStorage.getItem('dt_target_mode'), 'time');
    assert.equal(c.dtOffsetMin(), 1);
});
