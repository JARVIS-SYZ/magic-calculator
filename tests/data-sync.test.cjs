const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const admin = read('admin.html'), audience = read('index.html');
function between(source, start, end) {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    assert.ok(a >= 0 && b > a);
    return source.slice(a, b);
}

test('latest calculations include new records beyond 20 and exclude other administrators', () => {
    const records = Array.from({length: 25}, (_, i) => ({id: String(i).padStart(2, '0'), adminId: 'mine', timestamp: i}));
    records.push({id: 'other', adminId: 'other', timestamp: 99});
    let rows;
    const query = {
        where(key, op, value) { rows = rows.filter(row => row[key] === value); return this; },
        orderBy(key, direction) { assert.equal(direction, 'desc'); rows.sort((a,b) => b[key] - a[key]); return this; },
        limit(count) { return rows.slice(0, count); }
    };
    const c = vm.createContext({currentAdminId:'mine', db2:{collection(name) { assert.equal(name, 'calculations'); rows = records.slice(); return query; }}});
    vm.runInContext(between(admin, '    function latestCalculations(limit)', '    // adminId 기준'), c);
    assert.equal(c.latestCalculations(20).length, 20);
    assert.equal(c.latestCalculations(20)[0].timestamp, 24);
    assert.equal(c.latestCalculations(1)[0].adminId, 'mine');
    c.currentAdminId = null;
    assert.throws(() => c.latestCalculations(1), /관리자 인증/);
});

test('admin push reports success only after the server write succeeds', async () => {
    const messages = [];
    let resolveWrite, rejectWrite;
    const c = vm.createContext({currentValue:'1,234', currentAdminId:'mine', window:{_authReady:Promise.resolve()},
        vibrateDevice() {}, showPushToast:m => messages.push(m), db_auth:{collection:() => ({doc:() => ({set:() => new Promise((resolve,reject) => {resolveWrite=resolve;rejectWrite=reject;})})})}});
    vm.runInContext(between(admin, '    async function pushCurrentValueToAudience()', '    // 디스플레이 영역을'), c);
    let pending = c.pushCurrentValueToAudience();
    await new Promise(setImmediate);
    assert.deepEqual(messages, ['전송 중: 1234']);
    resolveWrite(); await pending;
    assert.equal(messages.at(-1), '보냄: 1234');
    pending = c.pushCurrentValueToAudience(); await new Promise(setImmediate);
    rejectWrite(new Error('permission-denied')); await pending;
    assert.equal(messages.at(-1), 'ERR: permission-denied');
});

function audienceFixture() {
    let onValue, onError, timer, subscriptions = 0, refreshes = 0;
    const shown = [];
    const c = vm.createContext({
        window:{_adminId:'mine',_authReady:Promise.resolve()},
        firebase:{firestore:() => ({collection:() => ({doc:() => ({onSnapshot(value,error) {
            onValue=value;onError=error;subscriptions++;return () => {};
        }})})}), auth:() => ({currentUser:{getIdToken:async () => {refreshes++;}}})},
        updateDebugOverlay() {}, applyCloudConfig() {}, showPushedResult:value => shown.push(value),
        setTimeout:fn => {timer=fn;return 1;}, clearTimeout() {}, console
    });
    vm.runInContext('let _configUnsub = null;\n' + between(audience, '    let _configSubscribed', '    // 안드로이드 PWA는'), c);
    return {c, shown, value:doc => onValue(doc), error:e => onError(e), retry:() => timer(),
        subscriptions:() => subscriptions, refreshes:() => refreshes};
}

test('the first push after an initially missing config is displayed', async () => {
    const f = audienceFixture(); f.c.loadConfigFromCloud(); await new Promise(setImmediate);
    f.value({exists:false});
    f.value({exists:true,data:() => ({pushValue:123,pushAt:'2026-09-28T00:00:00Z'})});
    assert.deepEqual(f.shown,[123]);
});

test('audience config subscription recovers after a permission error', async () => {
    const f = audienceFixture(); f.c.loadConfigFromCloud(); await new Promise(setImmediate);
    f.value({exists:true,data:() => ({pushValue:1,pushAt:'old'})});
    assert.deepEqual(f.shown,[]);
    f.error({code:'permission-denied'});
    await f.retry(); await new Promise(setImmediate);
    assert.equal(f.refreshes(),1); assert.equal(f.subscriptions(),2);
    f.value({exists:true,data:() => ({pushValue:456,pushAt:'new'})});
    assert.deepEqual(f.shown,[456]);
});

test('screen pick layout refresh does not call removed diagnostics', () => {
    let callback;
    const calls = [];
    const c = vm.createContext({requestAnimationFrame:fn => {callback=fn;return 1;}, cancelAnimationFrame() {},
        spLayoutStage:() => calls.push('layout'),spApplyPreviewStyle:() => calls.push('preview')});
    vm.runInContext(between(admin, '        let layoutFrame = null;', "        window.addEventListener('resize', refreshLayout);") + '\nrefreshLayout();', c);
    callback(); assert.deepEqual(calls,['layout','preview']);
});

test('admin waits for login, retries subscriptions and does not replay old results', async () => {
    let login, onValue, onError, retry, subscriptions = 0;
    const shown = [], elements = new Map();
    const c = vm.createContext({
        adminReady:new Promise(resolve => {login=resolve;}),
        latestCalculations:limit => {assert.equal(limit,20);return {onSnapshot(options,value,error) {
            subscriptions++;onValue=value;onError=error;return () => {};
        }};},
        isFirstLoad:true, dataReady:false, cachedLatestData:null, recentCalcs:[],
        document:{getElementById:id => {if(!elements.has(id)) elements.set(id,{style:{},appendChild(){}});return elements.get(id);},createElement:() => ({})},
        window:{screenPickShow:value => shown.push(value)}, navigator:{},
        magicArmed:false, magicRunning:false, addLogItem(){}, console,
        firebase:{auth:() => ({currentUser:{getIdToken:async () => {}}})},
        setTimeout:fn => {retry=fn;return 1;},clearTimeout() {}
    });
    const pending = vm.runInContext('(async () => {' + between(admin, '        // 인증이 늦어져도 포기하지 않고', '    // 초기화\n    loadDelaySettings();') + '})()', c);
    await new Promise(setImmediate);assert.equal(subscriptions,0);
    login();await pending;assert.equal(subscriptions,1);
    const doc = (id,result) => ({id,data:() => ({expression:'1+1',result,timestamp:{toMillis:() => +id}})});
    const old = doc('1',2), latest = doc('2',0);
    function snapshot(docs, added) {return {empty:false,docs,size:docs.length,metadata:{hasPendingWrites:false},docChanges:() => added.map(doc => ({type:'added',doc}))};}
    onValue(snapshot([old],[old]));assert.deepEqual(shown,[]);
    onValue(snapshot([latest,old],[latest]));assert.deepEqual(shown,['0']);
    assert.equal(c.window.pendingResult,0);assert.equal(c.dataReady,true);
    onError({code:'permission-denied'});await retry();assert.equal(subscriptions,2);
    onValue(snapshot([latest,old],[latest,old]));assert.deepEqual(shown,['0']);
});
