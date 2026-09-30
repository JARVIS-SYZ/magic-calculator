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

test('admin push blinks only after the server write succeeds', async () => {
    const messages = [], blinks = [];
    let resolveWrite, rejectWrite;
    const c = vm.createContext({currentValue:'1,234', currentAdminId:'mine', window:{_authReady:Promise.resolve()},
        vibrateDevice() {}, blinkPushDot:() => blinks.push(true), showPushToast:m => messages.push(m),
        db_auth:{collection:() => ({doc:() => ({set:() => new Promise((resolve,reject) => {resolveWrite=resolve;rejectWrite=reject;})})})}});
    vm.runInContext(between(admin, '    async function pushCurrentValueToAudience()', '    // 디스플레이 영역을'), c);
    let pending = c.pushCurrentValueToAudience();
    await new Promise(setImmediate);
    assert.deepEqual(blinks, []);
    resolveWrite(); await pending;
    assert.deepEqual(blinks, [true]);
    pending = c.pushCurrentValueToAudience(); await new Promise(setImmediate);
    rejectWrite(new Error('permission-denied')); await pending;
    assert.equal(messages.at(-1), 'ERR: permission-denied');
    assert.deepEqual(blinks, [true]);
});

function audienceFixture() {
    let onValue, onError, timer, subscriptions = 0, refreshes = 0;
    const shown = [];
    const c = vm.createContext({
        window:{_adminId:'mine',_authReady:Promise.resolve()},
        firebase:{firestore:() => ({collection:() => ({doc:() => ({onSnapshot(value,error) {
            onValue=value;onError=error;subscriptions++;return () => {};
        }})})}), auth:() => ({currentUser:{getIdToken:async () => {refreshes++;}}})},
        updateDebugOverlay() {}, applySessionEpoch() {}, applyCloudConfig() {}, showPushedResult:value => shown.push(value),
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

test('a newly generated audience link starts a fresh session on a previously expired device', () => {
    const values = new Map([['calc_session_start','1']]);
    let now = 1800001;
    const c = vm.createContext({window:{_adminId:'mine'},location:{search:'?admin=mine&session=new'},
        URLSearchParams, Date:{now:() => now},localStorage:{getItem:k => values.get(k) ?? null,setItem:(k,v) => values.set(k,v)}});
    vm.runInContext(between(audience, '    function prepareAudienceSession()', '    function startSessionExpiry()'),c);
    c.prepareAudienceSession();assert.equal(values.get('calc_session_start'),String(now));
    now += 60000;c.prepareAudienceSession();assert.equal(values.get('calc_session_start'),'1800001');
    c.location.search = '?admin=mine&session=next';c.prepareAudienceSession();
    assert.equal(values.get('calc_session_start'),String(now));
});

test('legacy links retain their expiry and explicit reset remains available', () => {
    const values = new Map([['calc_session_start','1']]);
    const c = vm.createContext({window:{_adminId:'mine'},location:{search:'?admin=mine'},URLSearchParams,
        Date:{now:() => 5000000},localStorage:{getItem:k => values.get(k) ?? null,setItem:(k,v) => values.set(k,v)}});
    vm.runInContext(between(audience, '    function prepareAudienceSession()', '    function startSessionExpiry()'),c);
    c.prepareAudienceSession();assert.equal(values.get('calc_session_start'),'1');
    c.location.search += '&reset=1';c.prepareAudienceSession();assert.equal(values.get('calc_session_start'),'5000000');
    assert.doesNotMatch(between(audience,'    function startSessionExpiry()', '    let _configSubscribed'), /removeItem|reset/);
});

test('generated URLs and QR codes share the selected session and administrator', () => {
    const c = vm.createContext({crypto:{randomUUID:() => 'test-session'},currentAdminId:'mine',
        URLSearchParams,location:{origin:'https://example.com'},localStorage:{getItem:() => null}});
    vm.runInContext(between(admin, '    let calcLinkSession', '    window.generateUrl'),c);
    const first = new URL(c.buildCalcUrl()), second = new URL(c.buildCalcUrl());
    assert.equal(first.searchParams.get('admin'),'mine');
    assert.equal(first.searchParams.get('session'),'test-session');
    assert.equal(first.href,second.href);
});

test('expired storage blocks both directions on the old link, but the new link remains active', () => {
    const values = new Map([['calc_session_start','1']]);
    const now = 60 * 60 * 1000;
    function load(search) {
        let timer;
        const c = vm.createContext({window:{_adminId:'mine'},location:{search},URLSearchParams,
            Date:{now:() => now},localStorage:{getItem:k => values.get(k) ?? null,setItem:(k,v) => values.set(k,v)},
            clearTimeout(){}, setTimeout:(fn,ms) => {timer=ms;return 1;}});
        vm.runInContext('const SESSION_MAX_MS=30*60*1000; let _expireTimer=null; function expireSession(){window._sessionExpired=true;}\n'
            + between(audience,'    function sessionStartedAt()', '    function expireSession()')
            + between(audience,'    function prepareAudienceSession()', '    let _configSubscribed')
            + '\nprepareAudienceSession();startSessionExpiry();',c);
        return {expired:!!c.window._sessionExpired,timer};
    }
    assert.equal(load('?admin=mine').expired,true);
    const fresh=load('?admin=mine&session=fresh');
    assert.equal(fresh.expired,false);assert.equal(fresh.timer,30*60*1000);
});

test('external app wording replaces router-only wording', () => {
    assert.match(admin, />외부 앱 연동</);
    assert.match(admin, /📡 외부 앱 조회 URL/);
    assert.match(admin, /외부 앱에서 최신 수신 계산/);
    assert.doesNotMatch(admin, />라우터 URL</);
    assert.doesNotMatch(admin, /라우터 조회 전용 URL/);
});

test('received history shows expressions and timestamps without calculator IDs', () => {
    const logCode = between(admin, '    function addLogItem', '    const db2');
    const initialLogCode = between(admin, '            if (isFirstLoad)', '            } else {');
    assert.doesNotMatch(logCode, /calcId|log-id/);
    assert.doesNotMatch(initialLogCode, /calcId|log-id/);
    assert.doesNotMatch(admin, /\.log-id\s*\{/);
    assert.match(admin, /\.log-meta\s*\{[^}]*justify-content:\s*flex-end/);
});
