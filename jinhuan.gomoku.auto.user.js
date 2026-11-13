// ==UserScript==
// @name         尽欢小游戏助手
// @namespace    https://52dmeme.com/
// @version      0.5.9
// @description  五子棋与可选抽牌、猜拳、盲盒自动执行，记录并汇总最近 50 局奖励
// @homepageURL  https://scriptcat.org/zh-CN/script-show-page/9066
// @supportURL   https://scriptcat.org/zh-CN/script-show-page/9066/issue
// @downloadURL  https://scriptcat.org/scripts/code/9066/%E5%B0%BD%E6%AC%A2%E5%B0%8F%E6%B8%B8%E6%88%8F%E5%8A%A9%E6%89%8B.user.js
// @updateURL    https://scriptcat.org/scripts/code/9066/%E5%B0%BD%E6%AC%A2%E5%B0%8F%E6%B8%B8%E6%88%8F%E5%8A%A9%E6%89%8B.meta.js
// @match        https://52dmeme.com/*
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

// 由 gomoku/build.cjs 生成；代码、棋谱和规则均内置，无额外规则或脚本文件依赖。
;(function startGomokuAssistant(createSolver, createBook, bundledData, createTransport, createBackground, createPreview, createRules, createRecords, assistantVersion) {
    'use strict';
    if (document.querySelector('[data-jinhuan-gomoku]')) return;
    const STORAGE = 'jinhuan.gomoku.book.v1';
    const SETTINGS = 'jinhuan.gomoku.settings.v1';
    const PANEL_UI = 'jinhuan.gomoku.panel.v1';
    const MAX_FILE = 5 * 1024 * 1024;
    const isPetsPage = () => /^\/pets(?:\/|$)/.test(location.pathname);
    const backgroundAvailable = typeof createTransport === 'function' && typeof createBackground === 'function';
    const optionalGames = ['card', 'rps', 'box'];
    const gameLabels = { gomoku: '五子棋', card: '抽牌比大小', rps: '剪刀石头布', box: '盲盒夺宝' };
    const normalizeGames = games => ['gomoku', ...optionalGames.filter(game => Array.isArray(games) && games.includes(game))];
    // 自动仅处理奖励局；旧配置中的 rewards:false 不再生效。
    const settings = { enabled: false, next: true, rewards: true, timeMs: 3000, background: backgroundAvailable, hints: false, history: false, games: ['gomoku'] };
    let foregroundPracticeRun = false;
    const hasExtraGames = () => settings.games.length > 1;
    let book = createBook(bundledData);
    let storageWarning = '';
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE) || 'null');
        if (saved) for (const game of saved.games || []) book.addGame(game);
    } catch { storageWarning = '本机棋谱读取失败，仍可使用内置棋谱'; }
    try {
        const saved = JSON.parse(localStorage.getItem(SETTINGS) || 'null');
        if (saved) {
            if (typeof saved.enabled === 'boolean') settings.enabled = saved.enabled;
            if (typeof saved.next === 'boolean') settings.next = saved.next;
            if (typeof saved.background === 'boolean' && backgroundAvailable) settings.background = saved.background;
            if (typeof saved.hints === 'boolean') settings.hints = saved.hints;
            if (typeof saved.history === 'boolean') settings.history = saved.history;
            settings.games = normalizeGames(saved.games);
            if ([500, 1500, 3000, 6000].includes(saved.timeMs)) settings.timeMs = saved.timeMs;
        }
    } catch { storageWarning = '自动设置读取失败，已使用默认暂停状态'; }
    const panelView = { hidden: false };
    try {
        const saved = JSON.parse(localStorage.getItem(PANEL_UI) || 'null');
        if (typeof saved?.hidden === 'boolean') panelView.hidden = saved.hidden;
    } catch { /* 面板偏好损坏时使用展开状态，不影响自动运行。 */ }
    const panel = document.createElement('section');
    panel.dataset.jinhuanGomoku = '';
    panel.id = 'jinhuan-gomoku-panel';
    panel.setAttribute('aria-label', '小游戏助手');
    // 所有样式限定在助手内，避免宿主页面的表单重置影响操作层级。
    panel.innerHTML = `<style>
        [data-jinhuan-gomoku], [data-panel-restore] {
            box-sizing:border-box;position:fixed;left:14px;right:auto;bottom:18px;z-index:2147483646;
            border:1px solid #b5a48b;border-radius:12px;background:#fffaf0;color:#30291f;
            font:13px/1.5 system-ui,sans-serif;box-shadow:0 6px 24px #30291f26;
        }
        [data-jinhuan-gomoku] {
            display:flex;flex-direction:column;width:320px;max-width:calc(100vw - 28px);
            max-height:calc(100vh - 36px);max-height:calc(100dvh - 36px - env(safe-area-inset-bottom));
            /* 整个面板独立合成，避免 Chromium 首次刷新时只绘制背景。 */
            bottom:max(18px,env(safe-area-inset-bottom));isolation:isolate;transform:translateZ(0);
        }
        [data-jinhuan-gomoku] *, [data-jinhuan-gomoku] *::before, [data-jinhuan-gomoku] *::after {box-sizing:border-box}
        [data-jinhuan-gomoku] [hidden], [data-panel-restore][hidden] {display:none!important}
        [data-jinhuan-gomoku] ::selection {background:#dfc8a4;color:#30291f}
        [data-jinhuan-gomoku] [data-panel-header] {position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:2px;flex:none;min-height:max(60px,1.5em + 38px);padding:10px calc(64px + max(40px,2em + 10px)) 10px 16px}
        [data-jinhuan-gomoku] .gomoku-heading {display:flex;flex-wrap:wrap;align-items:baseline;gap:4px;flex:1 1 auto;min-width:0;line-height:1.4}
        [data-jinhuan-gomoku] .gomoku-heading strong {font-size:14px;font-weight:650;white-space:nowrap}
        [data-jinhuan-gomoku] [data-panel-version] {color:#74634d;font-size:11px;font-weight:400;font-variant-numeric:tabular-nums;white-space:nowrap}
        [data-jinhuan-gomoku] button, [data-jinhuan-gomoku] select, [data-panel-restore] {
            font:inherit;color:inherit;letter-spacing:normal;text-transform:none;cursor:pointer;
            border:1px solid #b5a48b;border-radius:6px;background:#fffaf0;min-height:40px;
            padding:8px 12px;margin:0;box-shadow:none;touch-action:manipulation;
        }
        [data-jinhuan-gomoku] button:hover, [data-panel-restore]:hover {background:#f0e5d2;border-color:#8d7555}
        [data-jinhuan-gomoku] button:active, [data-panel-restore]:active {background:#e7d7bb}
        [data-jinhuan-gomoku] :is(button,select,input,summary):focus-visible, [data-panel-restore]:focus-visible {outline:2px solid #89501e;outline-offset:3px}
        [data-jinhuan-gomoku] button:disabled {cursor:default;color:#817662;background:#eee6d8;border-color:#d2c6b4}
        [data-jinhuan-gomoku] [data-panel-header] button {flex:none;min-width:40px;padding:8px 4px;border-color:transparent;background:transparent;color:#69573e}
        [data-jinhuan-gomoku] [data-panel-header] button:hover {background:#f0e5d2}
        [data-jinhuan-gomoku] [data-panel-header] [data-records-open] {font-size:12px}
        [data-jinhuan-gomoku] [data-panel-header] :is([data-panel-hide],[data-book-open]) {position:absolute;top:10px}
        [data-jinhuan-gomoku] [data-panel-header] [data-panel-hide] {right:54px}
        [data-jinhuan-gomoku] [data-panel-header] [data-book-open] {right:12px}
        [data-jinhuan-gomoku] [data-panel-runtime] {flex:none;padding:0 16px}
        [data-jinhuan-gomoku] [data-panel-body] {min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 16px 16px;scroll-padding:12px}
        [data-jinhuan-gomoku] [data-status] {padding:10px 12px;background:#f1e9db;border-radius:6px;overflow-wrap:anywhere;line-height:1.6}
        [data-jinhuan-gomoku] .gomoku-actions {display:grid;grid-template-columns:1fr;margin-top:10px;padding:4px 0;background:#fffaf0}
        [data-jinhuan-gomoku][data-panel-page=records] .gomoku-actions {margin-top:0}
        [data-jinhuan-gomoku] [data-toggle] {background:#704c2e;border-color:#704c2e;color:#fffaf0;font-weight:600}
        [data-jinhuan-gomoku] [data-toggle]:hover {background:#583a22;border-color:#583a22}
        [data-jinhuan-gomoku] [data-toggle]:active {background:#452c19}
        [data-jinhuan-gomoku] [data-toggle][aria-pressed=true] {background:#f0e5d2;border-color:#8d7555;color:#52391f}
        [data-jinhuan-gomoku] [data-toggle][aria-pressed=true]:hover {background:#e7d7bb}
        [data-jinhuan-gomoku] fieldset {min-width:0;border:0;border-top:1px solid #e0d4bf;margin:18px 0 0;padding:10px 0 0}
        [data-jinhuan-gomoku] legend {float:none;width:auto;padding:0 8px 0 0;font-size:12px;font-weight:600;color:#74634d}
        [data-jinhuan-gomoku] .gomoku-option {display:flex;align-items:center;gap:10px;min-height:40px;margin:0;padding:8px 0;cursor:pointer}
        [data-jinhuan-gomoku] .gomoku-option input {appearance:auto;flex:none;width:17px;height:17px;padding:0;margin:0;accent-color:#704c2e;cursor:pointer}
        [data-jinhuan-gomoku] .gomoku-option input:disabled {cursor:default}
        [data-jinhuan-gomoku] [data-background-help] {display:block;margin:-4px 0 8px 27px;color:#74634d;font-size:12px;line-height:1.5}
        [data-jinhuan-gomoku] [data-games-help] {margin:6px 0 0;color:#74634d;font-size:12px;line-height:1.6}
        [data-jinhuan-gomoku] [data-game-grid] {display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,8.5em),1fr));column-gap:12px}
        [data-jinhuan-gomoku] [data-game-grid] .gomoku-option {gap:8px;min-width:0;padding:6px 0}
        [data-jinhuan-gomoku] [data-game-grid] span {min-width:0;overflow-wrap:anywhere}
        [data-jinhuan-gomoku] [data-last-run] {display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 12px;align-items:center;width:100%;margin-top:16px;padding:10px 0 0;border:0;border-top:1px solid #e0d4bf;border-radius:0;background:transparent;text-align:left}
        [data-jinhuan-gomoku] [data-last-run]:hover {background:transparent;color:#704c2e}
        [data-jinhuan-gomoku] [data-last-run-label] {font-size:12px;color:#74634d}
        [data-jinhuan-gomoku] [data-last-run-rewards] {grid-column:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-variant-numeric:tabular-nums}
        [data-jinhuan-gomoku] [data-last-run] svg {grid-column:2;grid-row:1/3;width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.75}
        [data-jinhuan-gomoku] .gomoku-option:has(input:disabled) {cursor:default}
        [data-jinhuan-gomoku] .gomoku-time {display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;margin:0}
        [data-jinhuan-gomoku] select {appearance:auto;width:auto;min-width:92px;padding:6px 8px;background:#fffcf5}
        [data-jinhuan-gomoku] [data-book-open] svg {display:block;flex:none;width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
        [data-jinhuan-gomoku] [data-book-open] {display:flex;align-items:center;justify-content:center}
        [data-jinhuan-gomoku] .gomoku-book-actions {display:flex;gap:8px;flex-wrap:wrap}
        [data-jinhuan-gomoku] .gomoku-book-actions button {flex:1;white-space:nowrap}
        [data-jinhuan-gomoku] [data-stats] {display:block;margin-top:10px;font-size:12px;color:#74634d;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
        [data-jinhuan-gomoku] [data-run-summary] {margin:12px 0 16px;padding:0 0 16px;border-bottom:1px solid #e0d4bf}
        [data-jinhuan-gomoku] [data-summary-heading], [data-jinhuan-gomoku] [data-records-heading] {display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 12px}
        [data-jinhuan-gomoku] [data-summary-heading] strong {font-weight:600;font-size:12px;color:#74634d}
        [data-jinhuan-gomoku] [data-records-details] {margin-top:16px}
        [data-jinhuan-gomoku] [data-records-heading] {min-height:40px;margin:0 0 4px;align-items:center;cursor:pointer;list-style:none}
        [data-jinhuan-gomoku] [data-records-heading]::-webkit-details-marker {display:none}
        [data-jinhuan-gomoku] [data-records-heading]:hover {color:#704c2e}
        [data-jinhuan-gomoku] [data-records-heading] strong {flex:1;font-size:13px;font-weight:600}
        [data-jinhuan-gomoku] [data-records-heading] svg {flex:none;width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
        [data-jinhuan-gomoku] [data-records-details][open] [data-records-heading] svg {transform:rotate(90deg)}
        [data-jinhuan-gomoku] [data-run-summary] p {margin:4px 0;overflow-wrap:anywhere}
        [data-jinhuan-gomoku] [data-summary-games] {font-size:12px;color:#74634d}
        [data-jinhuan-gomoku] [data-summary-note], [data-jinhuan-gomoku] [data-records-note], [data-jinhuan-gomoku] [data-records-count] {font-size:12px;color:#74634d}
        [data-jinhuan-gomoku] [data-summary-time], [data-jinhuan-gomoku] [data-record-time], [data-jinhuan-gomoku] [data-record-mode] {font-size:11px;color:#74634d;font-variant-numeric:tabular-nums}
        [data-jinhuan-gomoku] [data-records-note] {margin:0 0 8px}
        [data-jinhuan-gomoku] [data-records-warning] {margin:10px 0;color:#8b3b23;overflow-wrap:anywhere}
        [data-jinhuan-gomoku] [data-records-list] {list-style:none;padding:0;margin:0}
        [data-jinhuan-gomoku] [data-records-list] li {border-top:1px solid #e0d4bf;padding:12px 0}
        [data-jinhuan-gomoku] [data-record-row] {display:flex;justify-content:space-between;align-items:baseline;gap:10px}
        [data-jinhuan-gomoku] [data-record-game] {font-size:13px;font-weight:600;overflow-wrap:anywhere}
        [data-jinhuan-gomoku] [data-record-result] {font-size:12px;color:#74634d;white-space:nowrap}
        [data-jinhuan-gomoku] [data-record-rewards] {margin:4px 0 6px;overflow-wrap:anywhere;font-size:15px;font-variant-numeric:tabular-nums;font-weight:600}
        [data-jinhuan-gomoku] [data-record-meta] {display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px}
        [data-jinhuan-gomoku] [data-summary-rewards] {font-size:18px;font-weight:650;font-variant-numeric:tabular-nums}
        [data-jinhuan-gomoku] [data-reward-items], [data-jinhuan-gomoku] [data-reward-note] {display:block;margin-top:4px;font-size:12px;font-weight:400;line-height:1.5;color:#74634d}
        [data-jinhuan-gomoku] [data-records-empty] {padding:18px 0;color:#74634d}
        [data-jinhuan-gomoku] [data-records-empty] strong {display:block;margin-bottom:6px;font-size:14px;font-weight:600;color:#30291f}
        [data-panel-restore] {display:grid;place-items:center;width:48px;height:48px;max-width:calc(100vw - 28px);padding:8px;bottom:max(18px,env(safe-area-inset-bottom));box-shadow:0 3px 14px #30291f26}
        @media (pointer:coarse) {
            [data-jinhuan-gomoku] button, [data-jinhuan-gomoku] select, [data-jinhuan-gomoku] .gomoku-option, [data-jinhuan-gomoku] summary {min-height:44px}
        }
    </style>
    <header data-panel-header>
        <div class="gomoku-heading"><strong data-panel-title>小游戏助手</strong><small data-panel-version title="当前版本"${assistantVersion ? '' : ' hidden'}>${assistantVersion ? `v${assistantVersion}` : ''}</small></div>
        <button type="button" data-records-open aria-controls="jinhuan-gomoku-records-page">对局记录</button>
        <button type="button" data-panel-hide>隐藏</button>
        <button type="button" data-book-open aria-label="更多设置" title="更多设置" aria-expanded="false" aria-controls="jinhuan-gomoku-book-page"><svg data-settings-icon viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 3.5h5l.6 2.6 1.7 1 2.6-.8 2.5 4.4-1.9 1.8v2l1.9 1.8-2.5 4.3-2.6-.8-1.7 1-.6 2.7h-5l-.6-2.7-1.7-1-2.6.8L2.1 16l1.9-1.8v-2L2.1 10.4l2.5-4.3 2.6.8 1.7-1z" transform="translate(0 -1.5) scale(1 .95)"/><circle cx="12" cy="11.5" r="3"/></svg><svg data-settings-back-icon viewBox="0 0 24 24" aria-hidden="true" hidden><path d="m14 6-6 6 6 6"/></svg></button>
    </header>
    <div data-panel-runtime>
        <div data-status role="status" aria-live="polite">已暂停</div>
        <div class="gomoku-actions"><button type="button" data-toggle aria-pressed="false">开启自动</button></div>
    </div>
    <div data-panel-body id="jinhuan-gomoku-controls">
        <p data-records-warning hidden></p>
        <div data-settings-page id="jinhuan-gomoku-main-page">
        <fieldset><legend>自动游戏</legend><div data-game-grid>
            <label class="gomoku-option"><input data-auto-game="gomoku" type="checkbox" checked disabled><span>五子棋（固定）</span></label>
            <label class="gomoku-option"><input data-auto-game="card" type="checkbox"><span>抽牌比大小</span></label>
            <label class="gomoku-option"><input data-auto-game="rps" type="checkbox"><span>剪刀石头布</span></label>
            <label class="gomoku-option"><input data-auto-game="box" type="checkbox"><span>盲盒夺宝</span></label>
            </div><p data-games-help>五子棋优先，其余轮换；额度用完暂停。</p>
        </fieldset>
        <button type="button" data-last-run hidden aria-controls="jinhuan-gomoku-records-page"><span data-last-run-label></span><span data-last-run-rewards></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button>
        </div>
        <div data-book-page id="jinhuan-gomoku-book-page" hidden>
        <fieldset><legend>通用设置</legend>
            <label class="gomoku-option"><input data-background type="checkbox" aria-describedby="jinhuan-gomoku-background-help"><span>允许后台执行</span></label>
            <small data-background-help id="jinhuan-gomoku-background-help">在后台完成已选小游戏的奖励局。</small>
            <label class="gomoku-option"><input data-next type="checkbox" checked><span>自动继续下一局</span></label>
        </fieldset>
        <fieldset><legend>对局设置</legend>
            <label class="gomoku-time"><span>每手搜索时长上限</span><select data-time><option value="500">0.5 秒</option><option value="1500">1.5 秒</option><option value="3000" selected>3 秒</option><option value="6000">6 秒</option></select></label>
            <label class="gomoku-option"><input data-hints type="checkbox"><span>前台对局时显示下一手</span></label>
            <label class="gomoku-option"><input data-history-toggle type="checkbox"><span>前台对局时显示当前棋谱</span></label>
        </fieldset>
            <fieldset><legend>棋谱管理</legend>
            <div class="gomoku-book-actions"><button type="button" data-import>导入棋谱</button><button type="button" data-export>导出棋谱</button><input data-file type="file" accept=".json,application/json" hidden></div>
            <small data-stats></small>
            </fieldset>
        </div>
        <div data-records-page id="jinhuan-gomoku-records-page" hidden>
            <section data-run-summary aria-label="最近 50 局奖励汇总" hidden>
                <div data-summary-heading><strong>最近 50 局汇总</strong><time data-summary-time></time></div>
                <p data-summary-rewards></p><p data-summary-games></p><p data-summary-note></p>
            </section>
            <details data-records-details>
                <summary data-records-heading><strong>对局明细</strong><small data-records-count></small><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m8 5 7 7-7 7"/></svg></summary>
                <p data-records-note>按时间倒序 · 最多保留 50 局</p>
                <ol data-records-list aria-label="最近对局记录"></ol>
            </details>
            <p data-records-empty><strong>还没有对局记录</strong>完成对局后，可在这里查看获得的奖励。</p>
        </div>
    </div>`;
    const ui = selector => panel.querySelector(selector);
    const restorePanel = document.createElement('button');
    restorePanel.type = 'button';
    restorePanel.dataset.panelRestore = '';
    restorePanel.innerHTML = '<svg viewBox="0 0 34 34" width="28" height="28" aria-hidden="true" focusable="false"><path d="M5 5v24M11 5v24M17 5v24M23 5v24M29 5v24M5 5h24M5 11h24M5 17h24M5 23h24M5 29h24" fill="none" stroke="currentColor" stroke-width="1" opacity=".45"/><g fill="currentColor"><circle cx="11" cy="23" r="3.5"/><circle cx="17" cy="17" r="3.5"/><circle cx="23" cy="11" r="3.5"/></g><g fill="#fffaf0" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="3.5"/><circle cx="23" cy="23" r="3.5"/></g></svg>';
    restorePanel.title = '显示小游戏助手';
    restorePanel.setAttribute('aria-label', '显示小游戏配置面板');
    restorePanel.setAttribute('aria-controls', panel.id);
    let currentPanelPage = 'main';
    let recordReturnPage = 'main';
    let recordReturnFocus = '[data-records-open]';
    function renderPanelChrome() {
        const home = currentPanelPage === 'main';
        const active = ui('[data-toggle]').getAttribute('aria-pressed') === 'true';
        const runtimeVisible = home || currentPanelPage === 'records' && active;
        const runtimeFocused = !runtimeVisible && ui('[data-panel-runtime]').contains(document.activeElement);
        panel.dataset.panelPage = currentPanelPage;
        ui('[data-panel-version]').hidden = !home || !assistantVersion;
        ui('[data-status]').hidden = !home;
        ui('.gomoku-actions').hidden = !runtimeVisible;
        ui('[data-panel-runtime]').hidden = !runtimeVisible;
        const returnToSettings = currentPanelPage === 'records' && recordReturnPage === 'settings';
        const label = home ? '更多设置' : returnToSettings ? '返回更多设置' : '返回主面板';
        ui('[data-book-open]').setAttribute('aria-label', label);
        ui('[data-book-open]').title = label;
        ui('[data-book-open]').setAttribute('aria-expanded', String(!home));
        ui('[data-book-open]').setAttribute('aria-controls', home || returnToSettings ? 'jinhuan-gomoku-book-page' : 'jinhuan-gomoku-main-page');
        ui('[data-settings-icon]').toggleAttribute('hidden', !home);
        ui('[data-settings-back-icon]').toggleAttribute('hidden', home);
        ui('[data-records-open]').hidden = currentPanelPage === 'records';
        ui('[data-panel-title]').textContent = { main: '小游戏助手', settings: '更多设置', records: '对局记录' }[currentPanelPage];
        if (runtimeFocused && !panel.hidden) ui('[data-book-open]').focus({ preventScroll: true });
    }
    function showPanelPage(page, focus = true) {
        // 子页沿用首页高度，右侧返回和隐藏按钮保持在同一屏幕位置。
        if (page !== 'main' && !panel.style.height && !panel.hidden) panel.style.height = `${panel.getBoundingClientRect().height}px`;
        else if (page === 'main') panel.style.height = '';
        if (page === 'records' && currentPanelPage !== 'records') ui('[data-records-details]').open = false;
        currentPanelPage = page;
        ui('[data-settings-page]').hidden = page !== 'main';
        ui('[data-book-page]').hidden = page !== 'settings';
        ui('[data-records-page]').hidden = page !== 'records';
        ui('[data-panel-body]').scrollTop = 0;
        renderRecords();
        if (focus) ui('[data-book-open]').focus();
    }
    function showBookPage(open, focus = true) { showPanelPage(open ? 'settings' : 'main', focus); }
    function showRecordsPage(event) {
        recordReturnPage = currentPanelPage;
        recordReturnFocus = event?.currentTarget === ui('[data-last-run]') ? '[data-last-run]' : '[data-records-open]';
        showPanelPage('records');
    }
    function renderPanelView() {
        const panelEligible = isPetsPage();
        if (panelView.hidden) showBookPage(false, false);
        panel.hidden = !panelEligible || panelView.hidden;
        panel.style.display = panel.hidden ? 'none' : '';
        restorePanel.hidden = !panelEligible || !panelView.hidden;
        restorePanel.style.display = restorePanel.hidden ? 'none' : '';
    }
    function setPanelView(changes) {
        Object.assign(panelView, changes);
        renderPanelView();
        // 视图偏好独立保存，不触碰自动开关、对局设置或执行锁。
        try { localStorage.setItem(PANEL_UI, JSON.stringify({ collapsed: false, hidden: panelView.hidden })); }
        catch { /* 存储不可用时仍允许在当前页面隐藏和恢复。 */ }
    }
    ui('[data-next]').checked = settings.next;
    function syncGameModeUI() {
        for (const input of panel.querySelectorAll('[data-auto-game]')) {
            input.checked = settings.games.includes(input.dataset.autoGame);
            input.disabled = input.dataset.autoGame === 'gomoku' || !backgroundAvailable;
        }
        ui('[data-background]').checked = usingBackground();
        ui('[data-background]').disabled = hasExtraGames();
        ui('[data-background-help]').textContent = foregroundPracticeRun ? '当前练习局使用前台棋盘，结束后暂停。' : hasExtraGames() ? '已选其他小游戏，需在后台完成。' : '在后台完成已选小游戏的奖励局。';
    }
    syncGameModeUI();
    ui('[data-background]').closest('label').hidden = !backgroundAvailable;
    ui('[data-background-help]').hidden = !backgroundAvailable;
    ui('[data-hints]').checked = settings.hints;
    ui('[data-history-toggle]').checked = settings.history;
    ui('[data-time]').value = String(settings.timeMs);
    const status = text => {
        const output = ui('[data-status]');
        if (output.textContent !== text) output.textContent = text;
    };
    const updateStats = () => {
        const s = book.stats();
        ui('[data-stats]').textContent = `已收录 ${s.size} 局，${s.positions} 个局面`;
    };
    let records = null;
    let recordsWarning = '';
    let currentRunId = null;
    const readAccount = () => document.querySelector('a[href$="/me"] img')?.alt || null;
    let recordsAccount = readAccount();
    let itemNames = null;
    const numberLabel = value => Number(value).toLocaleString('zh-CN');
    const timeLabel = value => {
        const date = new Date(value);
        return Number.isFinite(value) && Number.isFinite(date.getTime())
            ? date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
            : '时间未知';
    };
    function itemsLabel(items) {
        if (!Array.isArray(items) || !items.length) return '';
        if (!itemNames) {
            try { itemNames = typeof createRules === 'function' ? createRules().ITEM_NAME || {} : {}; }
            catch { itemNames = {}; }
        }
        return items.map(item => `${item.name || itemNames[item.id] || item.id}${item.q ? `（${['', '银星', '金星'][item.q] || '品质 ' + item.q}）` : ''} ×${numberLabel(item.n)}`).join('、');
    }
    function rewardLabel(coins, items, unknown = 0) {
        const parts = [];
        if (coins === null) parts.push('D币金额未知');
        else parts.push(`D币 +${numberLabel(coins || 0)}`);
        const itemText = itemsLabel(items);
        if (itemText) parts.push(itemText);
        if (unknown) parts.push(`${unknown} 局 D币金额未知`);
        return parts.join('；');
    }
    function renderReward(target, coins, items, unknown = 0) {
        const amount = document.createElement('span');
        amount.dataset.rewardCoins = '';
        amount.textContent = coins === null ? 'D币金额未知' : `D币 +${numberLabel(coins || 0)}`;
        target.replaceChildren(amount);
        const itemText = itemsLabel(items);
        if (itemText) {
            const detail = document.createElement('span');
            detail.dataset.rewardItems = '';
            detail.textContent = itemText;
            target.append(detail);
        }
        if (unknown) {
            const note = document.createElement('span');
            note.dataset.rewardNote = '';
            note.textContent = `${unknown} 局 D币金额未知`;
            target.append(note);
        }
    }
    function renderLastRunSummary() {
        const summary = records?.getLastSummary();
        const visible = !!summary && !currentRunId;
        const compact = ui('[data-last-run]');
        compact.hidden = !visible || !summary.games;
        if (!compact.hidden) {
            const rewards = rewardLabel(summary.coins, summary.items, summary.unknownCoins);
            ui('[data-last-run-label]').textContent = `最近运行 · ${summary.games} 局`;
            ui('[data-last-run-rewards]').textContent = rewards;
            compact.setAttribute('aria-label', `查看运行奖励汇总：${summary.games} 局，${rewards}`);
        }
    }
    function renderRecords() {
        renderPanelChrome();
        renderLastRunSummary();
        ui('[data-run-summary]').hidden = true;
        ui('[data-records-warning]').hidden = !recordsWarning;
        ui('[data-records-warning]').textContent = recordsWarning;
        if (currentPanelPage !== 'records') return;
        const entries = records?.getRecords() || [];
        const summary = records?.getRecentSummary();
        ui('[data-run-summary]').hidden = !summary;
        if (summary) {
            ui('[data-summary-games]').textContent = `共 ${summary.games} 局 · ${summary.wins} 胜 / ${summary.losses} 负 / ${summary.draws} 和`;
            renderReward(ui('[data-summary-rewards]'), summary.coins, summary.items, summary.unknownCoins);
            ui('[data-summary-note]').textContent = '跨运行累计 · 最多保留 50 局';
            ui('[data-summary-time]').textContent = `截至 ${timeLabel(summary.lastAt)}`;
            const lastAt = new Date(summary.lastAt);
            if (Number.isFinite(summary.lastAt) && Number.isFinite(lastAt.getTime())) ui('[data-summary-time]').dateTime = lastAt.toISOString();
            else ui('[data-summary-time]').removeAttribute('datetime');
        }
        ui('[data-records-details]').hidden = entries.length === 0;
        if (!entries.length) ui('[data-records-details]').open = false;
        ui('[data-records-count]').hidden = entries.length === 0;
        ui('[data-records-count]').textContent = `最近 ${entries.length} 局`;
        ui('[data-records-note]').hidden = entries.length === 0;
        ui('[data-records-empty]').hidden = entries.length > 0;
        const list = ui('[data-records-list]');
        list.replaceChildren();
        for (const entry of entries) {
            const row = document.createElement('li');
            const heading = document.createElement('div');
            heading.dataset.recordRow = '';
            const time = document.createElement('time');
            time.dataset.recordTime = '';
            time.textContent = timeLabel(entry.at);
            const recordedAt = new Date(entry.at);
            if (Number.isFinite(entry.at) && Number.isFinite(recordedAt.getTime())) time.dateTime = recordedAt.toISOString();
            const game = document.createElement('strong');
            game.dataset.recordGame = '';
            game.textContent = gameLabels[entry.game || 'gomoku'] || '小游戏';
            const result = document.createElement('span');
            result.dataset.recordResult = '';
            result.textContent = { win: '获胜', lose: '落败', draw: '平局' }[entry.result] || '已结算';
            heading.append(game, result);
            const rewards = document.createElement('p');
            rewards.dataset.recordRewards = '';
            renderReward(rewards, entry.coins, entry.items);
            const mode = document.createElement('small');
            mode.dataset.recordMode = '';
            mode.textContent = `${entry.mode === 'background' ? '后台对局' : '前台对局'} · ${entry.practice ? '练习局' : '奖励局'}`;
            const metadata = document.createElement('div');
            metadata.dataset.recordMeta = '';
            metadata.append(time, mode);
            row.append(heading, rewards, metadata);
            list.append(row);
        }
    }
    function beginCurrentRun() {
        if (currentRunId || !records || !readAccount()) return;
        try { currentRunId = records.beginRun({ mode: usingBackground() ? 'background' : 'foreground', rewardsOnly: true }); }
        catch { recordsWarning = '本次运行记录暂时不可用，自动对局仍可继续。'; }
        renderRecords();
    }
    function finishCurrentRun(reason) {
        if (!currentRunId || !records) return;
        currentRunId = null;
        try {
            const summary = records.finishRun(reason);
            if (summary) setPanelView({ hidden: false });
        } catch { recordsWarning = '奖励汇总暂时无法保存，已确认的对局仍可查看。'; }
        renderRecords();
    }
    if (typeof createRecords === 'function') {
        try {
            records = createRecords({
                window: globalThis,
                getAccount: readAccount,
                getMode: () => ui('[data-toggle]').getAttribute('aria-pressed') === 'true' && usingBackground() ? 'background' : 'foreground',
                onChange: () => renderRecords(),
                onWarning: message => { recordsWarning = message; renderRecords(); },
            });
            records.install();
        } catch { recordsWarning = '对局记录暂时不可用，不影响自动下棋。'; }
    }
    renderRecords();
    let running = false;
    let starting = false;
    let controlSequence = 0;
    let canvas = null;
    let boardReadable = false;
    let previous = null;
    let history = [];
    let historyOffset = 0;
    let completeHistory = false;
    let job = null;
    let recommendation = null;
    let analysisError = null;
    let waiting = null;
    let sequence = 0;
    let endedCanvas = null;
    let nextAt = 0;
    let nativePending = null;
    let pageSuspended = false;
    let resumeAfterHide = false;
    let stable = '';
    let stableAt = 0;
    let lease = null;
    let background = null;
    let allowCurrentPracticeTarget = null;
    let practicePermitBoard = null;
    const preview = typeof createPreview === 'function' ? createPreview({ onHidden: () => { if (recommendation) recommendation.readyAt = null; } }) : null;
    function usingBackground() { return backgroundAvailable && !foregroundPracticeRun && (hasExtraGames() || settings.background); }
    function saveGame(game) {
        book.addGame(game);
        updateStats();
        try {
            const latest = JSON.parse(localStorage.getItem(STORAGE) || 'null');
            const merged = createBook(book.exportData());
            if (latest) for (const previousGame of latest.games || []) merged.addGame(previousGame);
            book = merged;
            localStorage.setItem(STORAGE, JSON.stringify(merged.exportData()));
            updateStats();
        } catch { storageWarning = '棋谱仅保留在当前页面，保存失败，可手动导出'; }
    }
    function getBackground() {
        if (!background) background = createBackground({
            createTransport, createSolver, createBook, createRules, getBook: () => book,
            getAccount: readAccount,
            onStatus: message => { if (running && usingBackground()) status(message); },
            onStop: message => { if (running && usingBackground()) pause(message); },
            onGame: saveGame,
        });
        return background;
    }
    const tab = globalThis.crypto?.randomUUID?.() || String(Math.random());
    const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('jinhuan-gomoku-control') : null;
    channel?.addEventListener('message', event => {
        if (event.data?.type === 'start' && event.data.tab !== tab) {
            resumeAfterHide = false;
            pause('其他标签页已接管，当前已暂停', false);
        }
    });

    function saveSettings(enabled) {
        try {
            // 仅更改选项时保留最新总开关，避免闲置标签页覆盖正在执行的页面。
            if (typeof enabled === 'boolean') settings.enabled = enabled;
            else {
                const latest = JSON.parse(localStorage.getItem(SETTINGS) || 'null');
                if (typeof latest?.enabled === 'boolean') settings.enabled = latest.enabled;
            }
            localStorage.setItem(SETTINGS, JSON.stringify(settings));
        } catch { storageWarning = '自动设置仅在当前页面有效，保存失败'; }
    }

    function cancelJob() {
        if (job) { clearTimeout(job.watchdog); job.worker.terminate(); job = null; }
        recommendation = null;
        analysisError = null;
        sequence++;
    }

    function canvasVisible(target) {
        if (!target?.isConnected) return false;
        const rect = target.getBoundingClientRect();
        const style = getComputedStyle(target);
        return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth && style.display !== 'none' && style.visibility !== 'hidden';
    }

    function previewActive() {
        return isPetsPage() && document.visibilityState === 'visible' && !!preview && canvasVisible(canvas) && !(running && usingBackground()) && (ui('[data-hints]').checked || ui('[data-history-toggle]').checked);
    }

    function hintsActive() {
        return previewActive() && ui('[data-hints]').checked;
    }

    function hidePreview() {
        if (recommendation) recommendation.readyAt = null;
        preview?.hide();
    }

    function renderPreview(state, kind, error) {
        if (!previewActive()) { hidePreview(); return; }
        preview.attach(canvas);
        const current = recommendation?.canvas === canvas && recommendation.key === state?.key ? recommendation : null;
        if (hintsActive() && kind === 'ready' && current && current.readyAt === null) current.readyAt = performance.now();
        preview.render({ status: kind, recommendation: current ? { ...current.result, source: current.source } : null, history, historyOffset, completeHistory, error, showPrediction: ui('[data-hints]').checked, showHistory: ui('[data-history-toggle]').checked && boardReadable });
    }

    function refreshPreviewVisibility() {
        if (!previous) { hidePreview(); return; }
        const current = recommendation?.canvas === canvas && recommendation.key === previous.key;
        const kind = analysisError ? 'error' : current ? 'ready' : previous.blacks !== previous.whites ? 'white' : job ? 'thinking' : 'waiting';
        renderPreview(previous, kind, analysisError?.message);
    }

    function pause(message = '已暂停', persist = true, keepRun = false) {
        controlSequence++;
        starting = false;
        running = false;
        foregroundPracticeRun = false;
        syncGameModeUI();
        clearPracticePermit();
        cancelJob();
        background?.pause();
        lease?.();
        lease = null;
        if (persist) { resumeAfterHide = false; saveSettings(false); }
        ui('[data-toggle]').textContent = '开启自动';
        ui('[data-toggle]').setAttribute('aria-pressed', 'false');
        status(message);
        renderPanelChrome();
        if (!keepRun) finishCurrentRun(message);
    }
    function begin(explicit = false) {
        if (running || starting || pageSuspended) return;
        analysisError = null;
        clearPracticePermit();
        foregroundPracticeRun = false;
        syncGameModeUI();
        starting = true;
        ui('[data-toggle]').textContent = '暂停';
        ui('[data-toggle]').setAttribute('aria-pressed', 'true');
        renderPanelChrome();
        const control = ++controlSequence;
        const activate = () => {
            if (control !== controlSequence || pageSuspended) return;
            starting = false;
            running = true;
            const opened = document.querySelector('canvas.gomoku15');
            if (opened || document.querySelector('.gomoku-levels')) {
                const sheet = opened?.closest('[role="dialog"]') || opened?.parentElement;
                const practice = !!opened && nativePractice(sheet);
                if (hasExtraGames()) {
                    if (!explicit || !practice) {
                        pause(practice ? '练习局需手动点击“开启自动”，当前已暂停' : '请关闭五子棋面板后开启自动小游戏');
                        return;
                    }
                    foregroundPracticeRun = true;
                } else settings.background = false;
                syncGameModeUI();
                background?.pause();
                if (explicit && practice) {
                    try {
                        // 许可绑定点击时的棋盘快照，不能因同一 Canvas 重开而沿用到下一局。
                        practicePermitBoard = readBoard(opened).board.slice();
                        allowCurrentPracticeTarget = opened;
                    } catch (error) {
                        boardReadable = false;
                        pause('无法确认当前练习棋盘：' + error.message);
                        return;
                    }
                }
            }
            beginCurrentRun();
            saveSettings(true);
            ui('[data-toggle]').textContent = '暂停';
            ui('[data-toggle]').setAttribute('aria-pressed', 'true');
            channel?.postMessage({ type: 'start', tab });
            if (usingBackground()) {
                cancelJob();
                hidePreview();
                status('正在准备所选小游戏');
                Promise.resolve(getBackground().start({ games: settings.games.slice(), rewardsOnly: true, adoptExisting: explicit, timeMs: Number(ui('[data-time]').value), next: ui('[data-next]').checked }))
                    .catch(error => { if (control === controlSequence) pause(error.message); });
                return;
            }
            status(opened ? '等待棋盘稳定' : '未打开五子棋；请打开棋盘，或勾选“允许后台执行”');
        };
        // 在同源其他标签页操作时，不能同时控制第二盘。
        if (navigator.locks) {
            navigator.locks.request('jinhuan-gomoku-player', { ifAvailable: true }, async lock => {
                if (control !== controlSequence) return;
                if (!lock) { pause('另一个标签页正在执行小游戏，请先在那里暂停', false); return; }
                await new Promise(resolve => { lease = resolve; activate(); });
            }).catch(() => { if (control === controlSequence) pause('无法取得浏览器执行锁', false); });
        } else activate();
    }

    function readBoard(cv) {
        if (cv.width < 150 || cv.width !== cv.height) throw new Error('棋盘尺寸发生变化');
        const ctx = cv.getContext('2d');
        const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
        const cell = cv.width / 15;
        const offsets = [[0.23, 0], [-0.23, 0], [0, 0.23], [0, -0.23], [0.18, 0.18], [-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18]];
        const board = [];
        for (let i = 0; i < 225; i++) {
            let black = 0, white = 0, empty = 0;
            for (const [dx, dy] of offsets) {
                const x = Math.floor((i % 15 + 0.5 + dx) * cell);
                const y = Math.floor((Math.floor(i / 15) + 0.5 + dy) * cell);
                const p = (y * cv.width + x) * 4;
                const [r, g, b, a] = data.subarray(p, p + 4);
                if (a < 250) continue;
                if (Math.max(r, g, b) < 70) black++;
                else if (Math.min(r, g, b) > 215 && Math.max(r, g, b) - Math.min(r, g, b) < 25) white++;
                else if (r > b + 20 && g > b + 15 && r > 85) empty++;
            }
            if (black >= 6) board.push(1);
            else if (white >= 6) board.push(2);
            else if (empty >= 6) board.push(0);
            else throw new Error('棋盘颜色无法可靠识别，已停止落子');
        }
        const blacks = board.filter(v => v === 1).length;
        const whites = board.filter(v => v === 2).length;
        if (blacks !== whites && blacks !== whites + 1) throw new Error('黑白棋子数量异常，已停止落子');
        return { board, blacks, whites, key: board.join('') };
    }

    function observe(state) {
        if (!previous) {
            historyOffset = state.blacks + state.whites;
            completeHistory = historyOffset === 0;
            history = [];
        } else {
            const added = [];
            let invalid = false;
            state.board.forEach((value, i) => {
                if (value !== previous.board[i]) {
                    if (previous.board[i] || !value) invalid = true;
                    else added.push(i);
                }
            });
            if (added.length > 2) invalid = true;
            if (!invalid && added.length) {
                const nextColor = (historyOffset + history.length) % 2 + 1;
                added.sort((a, b) => (state.board[a] === nextColor ? -1 : 1) - (state.board[b] === nextColor ? -1 : 1));
                for (let turn = 0; turn < added.length; turn++) {
                    if (state.board[added[turn]] !== (historyOffset + history.length + turn) % 2 + 1) invalid = true;
                }
                if (!invalid) history.push(...added);
            }
            if (invalid) {
                // 无法还原的批量变化从当前局面重新记段，不按扫描顺序伪造此前棋谱。
                history = [];
                historyOffset = state.blacks + state.whites;
                completeHistory = false;
            }
        }
        previous = state;
    }

    function clearPracticePermit() {
        allowCurrentPracticeTarget = null;
        practicePermitBoard = null;
    }

    function practicePermitted(state, target) {
        if (allowCurrentPracticeTarget !== target) return false;
        if (!practicePermitBoard || practicePermitBoard.some((color, index) => color && color !== state.board[index])) {
            clearPracticePermit();
            return false;
        }
        practicePermitBoard = state.board.slice();
        return true;
    }

    function nativePractice(sheet) {
        const labels = [...sheet.querySelectorAll('.fun-head, .fun-info, .gomoku-info, .fun-res')];
        if (labels.length) return labels.some(label => /练习局/.test(label.textContent || ''));
        const copy = sheet.cloneNode(true);
        copy.querySelectorAll('[data-jinhuan-gomoku], [data-jinhuan-gomoku-preview]').forEach(node => node.remove());
        return /练习局/.test(copy.textContent || '');
    }

    function clickMove(index, expectedKey, targetCanvas) {
        if (!running || usingBackground() || targetCanvas !== canvas || !canvasVisible(canvas)) return;
        const now = readBoard(canvas);
        const sheet = canvas.closest('[role="dialog"]') || canvas.parentElement;
        if (nativePractice(sheet) && !practicePermitted(now, targetCanvas)) {
            pause('练习局需手动点击“开启自动”，当前已暂停');
            return;
        }
        if (now.key !== expectedKey || now.blacks !== now.whites || now.board[index] || sheet.querySelector('.gomoku-think') || /结算中|你赢了|52弟\s*赢了|和棋|平局|这局没算上/.test(sheet.querySelector('.fun-res')?.textContent || '')) return;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) { pause('棋盘不可见，已暂停'); return; }
        const args = { bubbles: true, clientX: rect.left + (index % 15 + 0.5) * rect.width / 15, clientY: rect.top + (Math.floor(index / 15) + 0.5) * rect.height / 15 };
        waiting = { key: expectedKey, index, until: performance.now() + 10000 };
        // 触屏页面原生要求同一格预览、确认两次，第二次仅在第一下没有落子时发送。
        canvas.dispatchEvent(new MouseEvent('click', args));
        const after = readBoard(canvas);
        if (after.key === expectedKey && window.matchMedia('(pointer: coarse)').matches) canvas.dispatchEvent(new MouseEvent('click', args));
        status(`已落子：第 ${Math.floor(index / 15) + 1} 行，第 ${index % 15 + 1} 列`);
    }

    function analysisFailed(message, target, key) {
        cancelJob();
        if (running && !usingBackground()) pause(message);
        analysisError = { canvas: target, key, message };
        if (target === canvas) renderPreview(previous, 'error', message);
    }

    function calculate(state) {
        const target = canvas;
        const matched = book.lookup(state.board);
        if (matched) {
            recommendation = { canvas: target, key: state.key, result: matched, source: '棋谱匹配', readyAt: null };
            if (running) status('已匹配棋谱，准备落子');
            renderPreview(state, 'ready');
            if (running && !hintsActive()) clickMove(matched.index, state.key, target);
            return;
        }
        const id = ++sequence;
        const timeMs = Number(ui('[data-time]').value);
        const source = `const solver = (${createSolver.toString()})(); onmessage = e => { try { postMessage({id:e.data.id,result:solver.choose(e.data.board,e.data.options)}); } catch(error) { postMessage({id:e.data.id,error:error.message}); } };`;
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        let worker;
        try { worker = new Worker(url); }
        catch (error) { analysisFailed('无法启动搜索线程：' + error.message, target, state.key); return; }
        finally { URL.revokeObjectURL(url); }
        job = { worker, id, canvas: target, key: state.key, watchdog: setTimeout(() => {
            if (job?.id === id) analysisFailed('搜索超时，可调整时间后重试', target, state.key);
        }, timeMs + 6000) };
        if (running) status('未命中棋谱，浏览器正在搜索…');
        renderPreview(state, 'thinking');
        worker.onerror = () => { if (job?.id === id) analysisFailed('浏览器无法启动搜索线程', target, state.key); };
        worker.onmessage = event => {
            if (job?.id !== id || event.data.id !== id) return;
            const data = event.data;
            clearTimeout(job.watchdog);
            worker.terminate();
            job = null;
            if (target !== canvas || !target.isConnected) return;
            try {
                const current = readBoard(target);
                if (current.key !== state.key) return;
                const sheet = target.closest('[role="dialog"]') || target.parentElement;
                if (/结算中|你赢了|52弟\s*赢了|和棋|平局|这局没算上/.test(sheet.querySelector('.fun-res')?.textContent || '') || sheet.querySelector('.gomoku-think')) return;
                if (data.error) { analysisFailed('搜索失败：' + data.error, target, state.key); return; }
                const index = data.result?.index;
                if (!Number.isInteger(index) || index < 0 || index >= 225 || current.board[index]) { analysisFailed('搜索没有返回合法落点', target, state.key); return; }
                recommendation = { canvas: target, key: state.key, result: data.result, source: '浏览器搜索', readyAt: null };
                renderPreview(current, 'ready');
                if (running && !hintsActive()) clickMove(index, state.key, target);
            } catch (error) { boardReadable = false; analysisFailed(error.message, target, state.key); }
        };
        worker.postMessage({ id, board: state.board, options: { timeMs, maxDepth: 8, color: 1 } });
    }

    function requestNative(button, kind, message) {
        if (!running || nativePending) return;
        // 原生开局可能先销毁棋盘、再异步返回难度页；保留同一个请求，绝不循环点击。
        nativePending = { kind, until: performance.now() + 10000 };
        cancelJob();
        button.click();
        status(message);
    }

    function startLevel(levels) {
        const buttons = [...levels.querySelectorAll('button')];
        const hard = buttons.find(button => button.querySelector('b')?.textContent.trim() === '困难');
        if (!hard) { pause('未找到困难难度，已暂停'); return; }
        if (!/赢了奖励/.test(hard.querySelector('small')?.textContent || '')) {
            const anyReward = buttons.some(button => /赢了奖励/.test(button.querySelector('small')?.textContent || ''));
            pause(anyReward ? '困难奖励局不可用，已暂停' : '今日奖励局已用完，已暂停');
            return;
        }
        if (hard.disabled) { pause('困难开局暂不可用，已暂停'); return; }
        requestNative(hard, 'start', '已选择困难，等待棋盘');
    }

    function waitNative(levels, state, resultText) {
        if (!nativePending) return false;
        if (nativePending.kind === 'levels' && levels) {
            nativePending = null;
            return false;
        }
        if (nativePending.kind !== 'levels' && !levels && state && state.blacks + state.whites === 0 && !/结算中|你赢了|52弟\s*赢了|和棋|平局|这局没算上/.test(resultText)) {
            nativePending = null;
            return false;
        }
        if (performance.now() >= nativePending.until) {
            const message = nativePending.kind === 'levels' ? '切换难度未完成，已暂停' : '开局未完成，已暂停，请核对页面';
            nativePending = null;
            if (running) pause(message);
            else status(message);
        }
        return true;
    }

    function finish(sheet) {
        const text = sheet.querySelector('.fun-res')?.textContent || '';
        if (/这局没算上/.test(text)) {
            if (running) pause('这局没算上，已暂停，请核对结算');
            return;
        }
        const won = /你赢了/.test(text);
        if (endedCanvas !== canvas) {
            endedCanvas = canvas;
            cancelJob();
            if (won && completeHistory) {
                saveGame({ result: 'win', moves: history.slice() });
            }
            nextAt = performance.now() + 1800;
        }
        if (!running) return;
        if (allowCurrentPracticeTarget === canvas || nativePractice(sheet)) {
            pause('本局练习已完成，已暂停；不会自动继续下一局');
            return;
        }
        if (!ui('[data-next]').checked) { pause((won ? '本局获胜，已暂停' : '本局结束，已暂停') + (storageWarning ? '；' + storageWarning : '')); return; }
        if (nativePending || performance.now() < nextAt) return;
        const button = [...sheet.querySelectorAll('.fun-res button')].find(b => b.textContent.trim() === '换难度');
        if (button && !button.disabled) {
            requestNative(button, 'levels', '本局已结算，正在核对下一局奖励');
        } else if (performance.now() >= nextAt + 10000) pause('未找到下一局入口，已暂停，请核对结算');
    }

    function tick() {
        if (pageSuspended) return;
        const account = readAccount();
        if (records && account !== recordsAccount) {
            recordsAccount = account;
            renderRecords();
        }
        if (running && !currentRunId) beginCurrentRun();
        const cv = document.querySelector('canvas.gomoku15');
        const levels = document.querySelector('.gomoku-levels');
        renderPanelView();
        if (running && usingBackground()) {
            if (job || recommendation) cancelJob();
            hidePreview();
            return;
        }
        if (cv !== canvas) {
            if (allowCurrentPracticeTarget !== cv) clearPracticePermit();
            cancelJob();
            hidePreview();
            canvas = cv;
            boardReadable = false;
            previous = null;
            history = [];
            historyOffset = 0;
            waiting = null;
            stable = '';
            endedCanvas = null;
            if (running) status(cv ? '等待棋盘稳定' : '等待打开五子棋');
        }
        if (!cv) {
            hidePreview();
            if (waitNative(levels, null, '')) return;
            if (running && levels) startLevel(levels);
            else if (running) status('未打开五子棋；请打开棋盘，或勾选“允许后台执行”');
            return;
        }
        const state = readBoard(cv);
        boardReadable = true;
        const practiceAuthorized = practicePermitted(state, cv);
        if (previous && state.blacks + state.whites === 0 && previous.blacks + previous.whites > 0) {
            if (!practiceAuthorized) clearPracticePermit();
            cancelJob();
            previous = null;
            history = [];
            historyOffset = 0;
            waiting = null;
            endedCanvas = null;
            stable = '';
        }
        observe(state);
        const sheet = cv.closest('[role="dialog"]') || cv.parentElement;
        const text = sheet.querySelector('.fun-res')?.textContent || '';
        if (waitNative(levels, state, text)) { renderPreview(state, 'waiting'); return; }
        if (levels) {
            hidePreview();
            if (running) startLevel(levels);
            return;
        }
        if (/结算中|你赢了|52弟\s*赢了|和棋|平局|这局没算上/.test(text)) {
            if (job || recommendation) cancelJob();
            if (running && /结算中/.test(text)) status('正在结算本局奖励');
            if (!/结算中/.test(text) && (running || endedCanvas !== canvas)) finish(sheet);
            renderPreview(state, 'ended');
            return;
        }
        if (running && allowCurrentPracticeTarget !== cv && nativePractice(sheet)) {
            pause('练习局需手动点击“开启自动”，当前已暂停');
        }
        if (waiting) {
            if (state.board[waiting.index] === 1) waiting = null;
            else if (performance.now() > waiting.until) { waiting = null; pause('落子未确认，已暂停，请核对棋盘'); }
            else { renderPreview(state, 'waiting'); return; }
        }
        if (stable !== state.key) {
            cancelJob();
            stable = state.key;
            stableAt = performance.now();
        }
        if (state.blacks !== state.whites || sheet.querySelector('.gomoku-think')) {
            if (job || recommendation) cancelJob();
            if (running) status('等待52弟落子');
            renderPreview(state, 'white');
            return;
        }
        if (performance.now() - stableAt < 450) {
            if (running) status('等待棋盘稳定');
            renderPreview(state, 'waiting'); return;
        }
        if (analysisError?.canvas === canvas && analysisError.key === state.key) {
            renderPreview(state, 'error', analysisError.message);
            return;
        }
        if (!running && !hintsActive()) {
            if (job) cancelJob();
            // 只显示棋谱时继续观察实际手顺，不启动推荐搜索。
            renderPreview(state, 'waiting');
            return;
        }
        if (recommendation?.canvas === canvas && recommendation.key === state.key) {
            if (running) status(recommendation.source === '棋谱匹配' ? '已匹配棋谱，准备落子' : '搜索完成，准备落子');
            renderPreview(state, 'ready');
            if (running && (!hintsActive() || (recommendation.readyAt !== null && performance.now() - recommendation.readyAt >= 400))) clickMove(recommendation.result.index, state.key, canvas);
            return;
        }
        if (job) { renderPreview(state, 'thinking'); return; }
        calculate(state);
    }

    ui('[data-book-open]').onclick = () => {
        if (currentPanelPage === 'records') {
            showPanelPage(recordReturnPage, false);
            const target = ui(recordReturnFocus);
            (target.getClientRects().length ? target : ui('[data-records-open]')).focus();
        } else showBookPage(currentPanelPage !== 'settings');
    };
    ui('[data-records-open]').onclick = showRecordsPage;
    ui('[data-last-run]').onclick = showRecordsPage;
    ui('[data-panel-hide]').onclick = () => { setPanelView({ hidden: true }); restorePanel.focus({ preventScroll: true }); };
    restorePanel.onclick = () => {
        setPanelView({ hidden: false });
        ui('[data-toggle]').focus();
    };
    ui('[data-toggle]').onclick = () => running || starting ? pause('已手动中断') : begin(true);
    for (const input of panel.querySelectorAll('[data-auto-game]')) {
        input.onchange = () => {
            settings.games = normalizeGames([...panel.querySelectorAll('[data-auto-game]:checked')].map(item => item.dataset.autoGame));
            syncGameModeUI();
            cancelJob();
            stableAt = performance.now();
            if (running || starting) pause('游戏选择已更新，请重新开启自动');
            else saveSettings();
        };
    }
    for (const selector of ['[data-next]', '[data-time]', '[data-background]']) {
        ui(selector).onchange = () => {
            const wasBackground = usingBackground();
            settings.next = ui('[data-next]').checked;
            settings.timeMs = Number(ui('[data-time]').value);
            if (selector === '[data-background]') settings.background = backgroundAvailable && ui('[data-background]').checked;
            syncGameModeUI();
            cancelJob();
            stableAt = performance.now();
            saveSettings();
            if ((running || starting) && (wasBackground || selector === '[data-background]')) pause('设置已更新，请重新开启自动');
        };
    }
    ui('[data-hints]').onchange = () => {
        settings.hints = ui('[data-hints]').checked;
        cancelJob();
        stableAt = performance.now();
        refreshPreviewVisibility();
        saveSettings();
    };
    ui('[data-history-toggle]').onchange = () => {
        settings.history = ui('[data-history-toggle]').checked;
        refreshPreviewVisibility();
        saveSettings();
    };
    ui('[data-import]').onclick = () => ui('[data-file]').click();
    ui('[data-file]').onchange = async event => {
        pause();
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            if (file.size > MAX_FILE) throw new Error('棋谱文件不能超过 5 MB');
            const incoming = JSON.parse(await file.text());
            if (incoming.version !== 1 || !Array.isArray(incoming.games)) throw new Error('不支持的棋谱格式');
            // 先在副本中完整校验，任何非法棋谱都不部分覆盖已保存数据。
            const merged = createBook(book.exportData());
            const latest = JSON.parse(localStorage.getItem(STORAGE) || 'null');
            if (latest) for (const game of latest.games || []) merged.addGame(game);
            for (const game of incoming.games) merged.addGame(game);
            localStorage.setItem(STORAGE, JSON.stringify(merged.exportData()));
            book = merged;
            cancelJob();
            updateStats();
            status('棋谱已导入');
        } catch (error) { status('导入失败：' + error.message); }
        event.target.value = '';
    };
    ui('[data-export]').onclick = () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(book.exportData())], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = '尽欢五子棋棋谱.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    document.body.append(panel, restorePanel);
    renderPanelView();
    updateStats();
    status(storageWarning || '已暂停');
    const timer = setInterval(() => {
        try { tick(); }
        catch (error) {
            boardReadable = false;
            cancelJob();
            if (running) pause(error.message);
            renderPreview(previous, 'error', '无法识别当前棋盘：' + error.message);
        }
    }, 250);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') {
            hidePreview();
            // 后台不为只读显示保留搜索，自动对局仍按原执行模式继续。
            if (!running) cancelJob();
        } else refreshPreviewVisibility();
    });
    window.addEventListener('storage', event => {
        if (event.key === PANEL_UI) {
            try {
                const saved = JSON.parse(event.newValue || 'null');
                panelView.hidden = saved?.hidden === true;
                renderPanelView();
            } catch { /* 不完整的跨标签页视图偏好不改变当前面板。 */ }
            return;
        }
        if (event.key !== SETTINGS) return;
        try {
            const saved = JSON.parse(event.newValue || 'null');
            if (!saved || typeof saved.enabled !== 'boolean') return;
            const backgroundWasRunning = running && usingBackground();
            const previousMode = usingBackground();
            const previousGames = settings.games.join(',');
            const previousOptions = [settings.next, settings.timeMs];
            const previousHints = settings.hints;
            settings.enabled = saved.enabled;
            if (typeof saved.next === 'boolean') settings.next = saved.next;
            if (typeof saved.background === 'boolean' && backgroundAvailable) settings.background = saved.background;
            if (typeof saved.hints === 'boolean') settings.hints = saved.hints;
            if (typeof saved.history === 'boolean') settings.history = saved.history;
            settings.games = normalizeGames(saved.games);
            if ([500, 1500, 3000, 6000].includes(saved.timeMs)) settings.timeMs = saved.timeMs;
            ui('[data-next]').checked = settings.next;
            ui('[data-time]').value = String(settings.timeMs);
            ui('[data-hints]').checked = settings.hints;
            ui('[data-history-toggle]').checked = settings.history;
            const modeChanged = previousMode !== usingBackground();
            const gamesChanged = previousGames !== settings.games.join(',');
            const backgroundOptionsChanged = previousOptions.some((value, index) => value !== [settings.next, settings.timeMs][index]);
            syncGameModeUI();
            if (modeChanged || gamesChanged || backgroundOptionsChanged || previousHints !== settings.hints) {
                cancelJob();
                stableAt = performance.now();
            }
            refreshPreviewVisibility();
            if (!saved.enabled) {
                resumeAfterHide = false;
                if (running || starting) pause('自动已在其他标签页暂停', false);
                else if (currentRunId) finishCurrentRun('自动已在其他标签页暂停');
            } else if (((modeChanged || gamesChanged) && (running || starting)) || (backgroundWasRunning && backgroundOptionsChanged)) {
                pause('后台设置已在其他标签页变更，请重新开启', false);
            }
        } catch { /* 忽略损坏或不完整的跨标签页设置。 */ }
    });
    window.addEventListener('pagehide', event => {
        resumeAfterHide = (running || starting);
        pageSuspended = true;
        hidePreview();
        // 离开页面只释放 Worker 与执行锁，不关闭已经保存的每日自动开关。
        pause('页面已离开，已释放自动执行资源', false, event.persisted);
        if (!event.persisted) { clearInterval(timer); channel?.close(); background?.dispose(); preview?.destroy(); }
    });
    window.addEventListener('pageshow', event => {
        pageSuspended = false;
        if (event.persisted) {
            // 冻结期间的 storage 事件可能尚未送达，先同步最新设置再决定是否恢复。
            try {
                const latest = JSON.parse(localStorage.getItem(SETTINGS) || 'null');
                settings.enabled = latest?.enabled === true;
                if (typeof latest?.next === 'boolean') settings.next = latest.next;
                if (typeof latest?.background === 'boolean' && backgroundAvailable) settings.background = latest.background;
                if (typeof latest?.hints === 'boolean') settings.hints = latest.hints;
                if (typeof latest?.history === 'boolean') settings.history = latest.history;
                settings.games = normalizeGames(latest?.games);
                if ([500, 1500, 3000, 6000].includes(latest?.timeMs)) settings.timeMs = latest.timeMs;
                ui('[data-next]').checked = settings.next;
                ui('[data-time]').value = String(settings.timeMs);
                syncGameModeUI();
                ui('[data-hints]').checked = settings.hints;
                ui('[data-history-toggle]').checked = settings.history;
            } catch { settings.enabled = false; }
        }
        if (event.persisted && resumeAfterHide && settings.enabled) {
            resumeAfterHide = false;
            begin();
        } else if (event.persisted && currentRunId && !settings.enabled) {
            resumeAfterHide = false;
            finishCurrentRun('自动已在其他标签页暂停');
        }
    });
    if (settings.enabled) begin();
})(function createGomokuSolver() {
    'use strict';
    const SIZE = 15;
    const CELLS = 225;
    const MATE = 100000000;
    const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
    const lines = [];
    const nearby = [];
    const patterns = new Int32Array(19683);
    patterns.fill(-1);
    for (let i = 0; i < CELLS; i++) {
        const x = i % SIZE;
        const y = Math.floor(i / SIZE);
        lines[i] = directions.map(([dx, dy]) => {
            const result = [];
            for (let offset = -4; offset <= 4; offset++) {
                const xx = x + dx * offset;
                const yy = y + dy * offset;
                result.push(xx >= 0 && xx < SIZE && yy >= 0 && yy < SIZE ? yy * SIZE + xx : -1);
            }
            return result;
        });
        nearby[i] = [];
        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                const xx = x + dx;
                const yy = y + dy;
                if ((dx || dy) && xx >= 0 && xx < SIZE && yy >= 0 && yy < SIZE) nearby[i].push(yy * SIZE + xx);
            }
        }
    }

    // 每条线上所有包含中心的五格窗口，共用同一个威胁识别表。
    function profile(key) {
        if (patterns[key] >= 0) return patterns[key];
        const cells = new Int8Array(9);
        let rest = key;
        for (let i = 0; i < 9; i++) {
            cells[i] = rest % 3;
            rest = Math.floor(rest / 3);
        }
        function winningMask() {
            let mask = 0;
            for (let start = 0; start < 5; start++) {
                let own = 0;
                let empty = -1;
                for (let k = start; k < start + 5; k++) {
                    if (cells[k] === 1) own++;
                    else if (cells[k] === 0) empty = k;
                    else { own = -10; break; }
                }
                if (own === 5) return 512;
                if (own === 4) mask |= 1 << empty;
            }
            return mask;
        }
        const wins = winningMask();
        let value = 0;
        if (wins === 512) value = 5;
        else if (wins && (wins & (wins - 1))) value = 4;
        else if (wins) value = 3;
        else {
            let threes = 0;
            let twos = 0;
            for (let k = 0; k < 9; k++) {
                if (cells[k] !== 0) continue;
                cells[k] = 1;
                const next = winningMask();
                cells[k] = 0;
                if (next && next !== 512 && (next & (next - 1))) threes++;
                else if (next) twos++;
            }
            if (threes) value = 2;
            else if (twos) value = 1;
        }
        patterns[key] = value;
        return value;
    }

    function choose(input, options) {
        options = options || {};
        if (!input || input.length !== CELLS) throw new Error('棋盘必须包含 225 个交点');
        const board = new Int8Array(CELLS);
        let count = 0;
        for (let i = 0; i < CELLS; i++) {
            if (input[i] !== 0 && input[i] !== 1 && input[i] !== 2) throw new Error('棋盘交点只能是 0、1 或 2');
            board[i] = input[i];
            if (board[i]) count++;
        }
        const color = options.color === 2 ? 2 : 1;
        const other = 3 - color;
        const budget = Number.isFinite(options.timeMs) ? Math.max(0, options.timeMs) : 2500;
        const maxDepth = Number.isFinite(options.maxDepth) ? Math.max(1, Math.min(16, Math.floor(options.maxDepth))) : 6;
        const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const started = now();
        const deadline = started + budget;
        const timeout = {};
        let nodes = 0;
        let hashA = 0;
        let hashB = 0;
        let seed = 1597334677;
        const zobrist = new Int32Array(CELLS * 4);
        for (let i = 0; i < zobrist.length; i++) {
            seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
            zobrist[i] = seed;
        }
        const neighbors = new Int16Array(CELLS);
        for (let i = 0; i < CELLS; i++) {
            if (!board[i]) continue;
            hashA ^= zobrist[i * 4 + board[i] - 1];
            hashB ^= zobrist[i * 4 + board[i] + 1];
            for (const j of nearby[i]) neighbors[j]++;
        }
        function put(i, stone) {
            board[i] = stone;
            hashA ^= zobrist[i * 4 + stone - 1];
            hashB ^= zobrist[i * 4 + stone + 1];
            for (const j of nearby[i]) neighbors[j]++;
            count++;
        }
        function undo(i, stone) {
            board[i] = 0;
            hashA ^= zobrist[i * 4 + stone - 1];
            hashB ^= zobrist[i * 4 + stone + 1];
            for (const j of nearby[i]) neighbors[j]--;
            count--;
        }
        function checkTime(limit) {
            if (now() >= (limit === undefined ? deadline : limit)) throw timeout;
        }
        function winsAt(i, stone) {
            const x = i % SIZE;
            const y = Math.floor(i / SIZE);
            for (const [dx, dy] of directions) {
                let run = 1;
                for (const sign of [-1, 1]) {
                    for (let step = 1; step < SIZE; step++) {
                        const xx = x + dx * step * sign;
                        const yy = y + dy * step * sign;
                        if (xx < 0 || xx >= SIZE || yy < 0 || yy >= SIZE || board[yy * SIZE + xx] !== stone) break;
                        run++;
                    }
                }
                if (run >= 5) return true;
            }
            return false;
        }
        function winningMoves(stone) {
            const result = [];
            for (let i = 0; i < CELLS; i++) if (!board[i] && winsAt(i, stone)) result.push(i);
            return result;
        }
        function moveScore(i, stone) {
            let fours = 0;
            let openFours = 0;
            let threes = 0;
            let twos = 0;
            for (const line of lines[i]) {
                let key = 0;
                let factor = 1;
                for (let k = 0; k < 9; k++) {
                    const j = line[k];
                    key += (k === 4 ? 1 : j < 0 ? 2 : board[j] === stone ? 1 : board[j] ? 2 : 0) * factor;
                    factor *= 3;
                }
                const type = profile(key);
                if (type === 5) return 10000000;
                if (type === 4) openFours++;
                else if (type === 3) fours++;
                else if (type === 2) threes++;
                else if (type === 1) twos++;
            }
            let score = openFours * 180000 + fours * 11000 + threes * 2200 + twos * 100;
            if (fours > 1) score += 150000;
            if (fours && threes) score += 90000;
            if (threes > 1) score += 18000;
            return score;
        }
        function candidates(stone, preferred, width) {
            const moves = [];
            const ownWins = [];
            const enemyWins = [];
            for (let i = 0; i < CELLS; i++) {
                if (board[i] || !neighbors[i]) continue;
                const attack = moveScore(i, stone);
                const defend = moveScore(i, 3 - stone);
                const center = 14 - Math.abs(i % SIZE - 7) - Math.abs(Math.floor(i / SIZE) - 7);
                const move = { index: i, attack, defend, rank: Math.max(attack, defend * 1.04) + Math.min(attack, defend) * 0.2 + center };
                if (i === preferred) move.rank += 1000000000;
                moves.push(move);
                if (attack >= 10000000) ownWins.push(move);
                if (defend >= 10000000) enemyWins.push(move);
            }
            moves.sort((a, b) => b.rank - a.rank);
            if (ownWins.length) return { moves: ownWins, win: true, loss: false, forced: false };
            if (enemyWins.length) return { moves: enemyWins, win: false, loss: enemyWins.length > 1, forced: true };
            return { moves: moves.slice(0, width), win: false, loss: false, forced: false };
        }
        function result(index, depth, score, proven) {
            return { index, x: index < 0 ? -1 : index % SIZE, y: index < 0 ? -1 : Math.floor(index / SIZE), depth, nodes, score, proven: !!proven };
        }
        if (count === CELLS) return result(-1, 0, 0, false);
        if (!count) return result(112, 0, 0, false);

        // 根节点始终完整扫描，不因时间耗尽而漏掉唯一的直接防守点。
        const immediate = winningMoves(color);
        if (immediate.length) return result(immediate[0], 1, MATE, true);
        const defenses = winningMoves(other);
        let root = candidates(color, -1, 24).moves;
        if (defenses.length) {
            root = root.filter(move => defenses.includes(move.index));
            if (defenses.length === 1) return result(defenses[0], 1, root.length ? root[0].attack - root[0].defend : 0, false);
            return result(root.length ? root[0].index : defenses[0], 1, -MATE, false);
        }
        if (!root.length) return result(board.findIndex(value => !value), 0, 0, false);
        let bestIndex = root[0].index;
        let bestScore = root[0].attack - root[0].defend;
        let completed = 0;
        const table = new Map();
        const vcfTable = new Map();
        function key(stone) { return hashA + ':' + hashB + ':' + stone; }

        // 连续冲四仅枚举真实强制应手；每步都先检查防守方能否直接获胜。
        function vcf(attacker, remaining, limit) {
            nodes++;
            checkTime(limit);
            const attackerWins = winningMoves(attacker);
            if (attackerWins.length) return attackerWins[0];
            if (remaining <= 0) return -1;
            const cacheKey = key(attacker);
            if ((vcfTable.get(cacheKey) || 0) >= remaining) return -1;
            const defender = 3 - attacker;
            const defenderWins = winningMoves(defender);
            if (defenderWins.length > 1) return -1;
            const attacks = candidates(attacker, -1, CELLS).moves.filter(move => move.attack >= 11000 && (!defenderWins.length || defenderWins[0] === move.index));
            for (const move of attacks) {
                checkTime(limit);
                let reply = -1;
                let success = false;
                put(move.index, attacker);
                try {
                    if (!winningMoves(defender).length) {
                        const threats = winningMoves(attacker);
                        if (threats.length > 1) success = true;
                        else if (threats.length === 1) {
                            reply = threats[0];
                            put(reply, defender);
                            try { success = vcf(attacker, remaining - 1, limit) >= 0; }
                            finally { undo(reply, defender); }
                        }
                    }
                } finally { undo(move.index, attacker); }
                if (success) return move.index;
            }
            vcfTable.set(cacheKey, remaining);
            return -1;
        }
        function evaluate(moves) {
            let own = 0;
            let enemy = 0;
            let ownSecond = 0;
            let enemySecond = 0;
            for (const move of moves) {
                if (move.attack > own) { ownSecond = own; own = move.attack; }
                else if (move.attack > ownSecond) ownSecond = move.attack;
                if (move.defend > enemy) { enemySecond = enemy; enemy = move.defend; }
                else if (move.defend > enemySecond) enemySecond = move.defend;
            }
            return Math.round(own + ownSecond * 0.2 - enemy * 1.08 - enemySecond * 0.25);
        }
        function search(stone, depth, alpha, beta, ply, quiet) {
            nodes++;
            if ((nodes & 15) === 0) checkTime();
            if (count === CELLS) return 0;
            const originalAlpha = alpha;
            const cacheKey = key(stone);
            const cached = table.get(cacheKey);
            // 静态延伸与常规深度分开缓存，防止复用不同搜索范围的分数。
            if (cached && cached.depth >= depth && cached.quiet === quiet) {
                if (cached.flag === 0) return cached.score;
                if (cached.flag === 1) alpha = Math.max(alpha, cached.score);
                else beta = Math.min(beta, cached.score);
                if (alpha >= beta) return cached.score;
            }
            const generated = candidates(stone, cached ? cached.index : -1, ply < 3 ? 16 : 10);
            if (generated.win) return MATE - ply;
            if (generated.loss) return -MATE + ply + 1;
            if (!generated.moves.length) return 0;
            let moves = generated.moves;
            if (depth <= 0) {
                if (quiet <= 0) return evaluate(moves);
                if (!generated.forced) {
                    const forcing = moves.filter(move => move.attack >= 11000);
                    if (!forcing.length) return evaluate(moves);
                    moves = forcing.slice(0, 5);
                }
            }
            let best = -Infinity;
            let index = moves[0].index;
            for (const move of moves) {
                put(move.index, stone);
                let value;
                try { value = -search(3 - stone, depth - 1, -beta, -alpha, ply + 1, depth <= 0 ? quiet - 1 : quiet); }
                finally { undo(move.index, stone); }
                if (value > best) { best = value; index = move.index; }
                alpha = Math.max(alpha, value);
                if (alpha >= beta) break;
            }
            if (table.size > 80000) table.clear();
            table.set(cacheKey, { depth, quiet, score: best, index, flag: best <= originalAlpha ? 2 : best >= beta ? 1 : 0 });
            return best;
        }
        try {
            checkTime();
            const attackLimit = Math.min(deadline, started + Math.min(400, budget * 0.2));
            try {
                const forcedWin = vcf(color, 12, attackLimit);
                if (forcedWin >= 0) return result(forcedWin, 0, MATE - 1, true);
            } catch (error) { if (error !== timeout) throw error; }
            checkTime();
            for (let depth = 1; depth <= maxDepth; depth++) {
                let iterationIndex = bestIndex;
                let iterationScore = -Infinity;
                let alpha = -MATE * 2;
                root.sort((a, b) => (b.index === bestIndex ? 1000000000 : b.rank) - (a.index === bestIndex ? 1000000000 : a.rank));
                for (const move of root) {
                    checkTime();
                    put(move.index, color);
                    let value;
                    try { value = -search(other, depth - 1, -MATE * 2, -alpha, 1, 4); }
                    finally { undo(move.index, color); }
                    if (value > iterationScore) { iterationScore = value; iterationIndex = move.index; }
                    alpha = Math.max(alpha, value);
                }
                bestIndex = iterationIndex;
                bestScore = iterationScore;
                completed = depth;
                if (Math.abs(bestScore) >= MATE - 100) break;
            }
        } catch (error) { if (error !== timeout) throw error; }
        return result(bestIndex, completed, bestScore, false);
    }
    return { choose };
},function createGomokuBook(data = { version: 1, games: [] }) {
    const SIZE = 15;
    const CELLS = SIZE * SIZE;
    const MAX_GAMES = 500;
    const games = [];
    const gameKeys = new Set();
    const positions = new Map();
    const transforms = [];
    const inverses = [];
    const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
    let metadata;

    // 前四种为旋转，后四种为先镜像再旋转；同时保存落点的逆映射。
    for (let symmetry = 0; symmetry < 8; symmetry++) {
        const forward = new Int16Array(CELLS);
        const inverse = new Int16Array(CELLS);
        for (let index = 0; index < CELLS; index++) {
            let x = index % SIZE;
            let y = Math.floor(index / SIZE);
            if (symmetry >= 4) x = SIZE - 1 - x;
            for (let turn = 0; turn < symmetry % 4; turn++) {
                const previousX = x;
                x = SIZE - 1 - y;
                y = previousX;
            }
            const target = y * SIZE + x;
            forward[index] = target;
            inverse[target] = index;
        }
        transforms.push(forward);
        inverses.push(inverse);
    }

    function clone(value) {
        try { return JSON.parse(JSON.stringify(value)); }
        catch (_) { throw new Error('棋谱附加信息必须可保存为 JSON'); }
    }

    function canonical(board) {
        let bestKey = null;
        let bestTransform = 0;
        for (let symmetry = 0; symmetry < 8; symmetry++) {
            const cells = new Array(CELLS);
            const forward = transforms[symmetry];
            for (let index = 0; index < CELLS; index++) cells[forward[index]] = String(board[index]);
            const key = cells.join('');
            if (bestKey === null || key < bestKey) {
                bestKey = key;
                bestTransform = symmetry;
            }
        }
        return { key: bestKey, symmetry: bestTransform };
    }

    function isWin(board, index, color) {
        const x = index % SIZE;
        const y = Math.floor(index / SIZE);
        for (const [dx, dy] of directions) {
            let run = 1;
            for (const sign of [-1, 1]) {
                for (let step = 1; step < SIZE; step++) {
                    const xx = x + step * dx * sign;
                    const yy = y + step * dy * sign;
                    if (xx < 0 || xx >= SIZE || yy < 0 || yy >= SIZE || board[yy * SIZE + xx] !== color) break;
                    run++;
                }
            }
            if (run >= 5) return true;
        }
        return false;
    }

    function validateGame(game) {
        if (!game || typeof game !== 'object' || Array.isArray(game)) throw new Error('棋谱必须是 JSON 对象');
        if (game.result !== 'win') {
            if (game.result === 'lose' || game.result === 'draw') return null;
            throw new Error('棋谱结果必须是 win、lose 或 draw');
        }
        if (!Array.isArray(game.moves) || !game.moves.length || game.moves.length > CELLS) throw new Error('棋谱必须包含 1 至 225 个落点');
        const board = new Int8Array(CELLS);
        let blackWon = false;
        for (let turn = 0; turn < game.moves.length; turn++) {
            const index = game.moves[turn];
            if (!Number.isInteger(index) || index < 0 || index >= CELLS) throw new Error('棋谱落点必须是 0 至 224 的整数');
            if (board[index]) throw new Error('棋谱包含重复落点');
            const color = turn % 2 === 0 ? 1 : 2;
            board[index] = color;
            if (isWin(board, index, color)) {
                if (color === 2) throw new Error('棋谱中白棋提前获胜，不能作为黑棋胜局');
                if (turn !== game.moves.length - 1) throw new Error('棋谱在终局后继续落子');
                blackWon = true;
            }
        }
        if (!blackWon) throw new Error('棋谱必须以黑棋连成至少五子获胜结束');
        const clean = { result: 'win', moves: game.moves.slice() };
        if (game.seed !== undefined) clean.seed = clone(game.seed);
        if (game.level !== undefined) clean.level = clone(game.level);
        return clean;
    }

    function addGame(game) {
        // 所有验证先完成，失败时不留下局面或对局的部分写入。
        const clean = validateGame(game);
        if (!clean) return false;
        const gameKey = clean.moves.join(',');
        if (gameKeys.has(gameKey) || games.length >= MAX_GAMES) return false;
        const board = new Int8Array(CELLS);
        for (let turn = 0; turn < clean.moves.length; turn++) {
            const index = clean.moves[turn];
            if (turn % 2 === 0) {
                const normalized = canonical(board);
                if (!positions.has(normalized.key)) {
                    positions.set(normalized.key, transforms[normalized.symmetry][index]);
                }
            }
            board[index] = turn % 2 === 0 ? 1 : 2;
        }
        games.push(clean);
        gameKeys.add(gameKey);
        return true;
    }

    function lookup(board) {
        if (!board || board.length !== CELLS) throw new Error('棋盘必须包含 225 个交点');
        let black = 0;
        let white = 0;
        for (let index = 0; index < CELLS; index++) {
            const color = board[index];
            if (color !== 0 && color !== 1 && color !== 2) throw new Error('棋盘交点只能是 0、1 或 2');
            if (color === 1) black++;
            else if (color === 2) white++;
        }
        if (black !== white) return null;
        const normalized = canonical(board);
        const next = positions.get(normalized.key);
        if (next === undefined) return null;
        const index = inverses[normalized.symmetry][next];
        if (board[index]) return null;
        return { index, x: index % SIZE, y: Math.floor(index / SIZE), source: '棋谱' };
    }

    function exportData() {
        const output = { version: 1, games: clone(games) };
        if (metadata !== undefined) output.metadata = clone(metadata);
        return output;
    }

    if (!data || typeof data !== 'object' || data.version !== 1 || !Array.isArray(data.games)) throw new Error('棋谱数据必须使用 version: 1 和 games 数组');
    if (data.metadata !== undefined) metadata = clone(data.metadata);
    for (const game of data.games) addGame(game);
    return { lookup, addGame, exportData, stats: () => ({ size: games.length, positions: positions.size }) };
},{"version":1,"games":[{"result":"win","moves":[112,96,81,97,98,84,110,111,125,95,126,140,79,94,93,127,107,65,108,109,78,123,80,77,82],"seed":1,"level":3},{"result":"win","moves":[112,111,82,97,83,81,96,113,65,129,145,128,68,110,54,40,67,66,38,53,35,51,20,50,70,86,22,6,52,37,36,4,84],"seed":3,"level":3},{"result":"win","moves":[112,113,142,127,141,143,128,111,159,95,79,96,156,114,170,184,157,158,186,171,189,173,204,174,154,202,138,122,140,139,126,98,168],"seed":5,"level":3},{"result":"win","moves":[112,127,110,111,95,125,126,97,139,83,69,98,94,142,78,62,109,124,92,93,137,123,136,138,64,122,121,50,106,120,151,91,166],"seed":6,"level":3},{"result":"win","moves":[112,97,114,113,129,99,98,127,85,141,155,126,130,82,146,162,115,100,132,131,87,101,88,86,160,174,118,104,116,117,102,74,144],"seed":7,"level":3},{"result":"win","moves":[112,98,99,113,128,144,82,97,81,83,96,80,69,68,53,111,37,85,52,67,54,51,84,39,114],"seed":8,"level":3}],"metadata":{"rulesSha256":"14d6529325ef23830b8e007311e52f0ad69bbc6580987e9ad3b0e0e7d3ce064c","rule":"FREESTYLE","rulesSnapshotId":"pet-world-14d6529325ef2383"}},function createGomokuTransport(options) {
    'use strict';
    options = options || {};
    const env = options.window || globalThis;
    const storageKey = options.storageKey || 'jinhuan.gomoku.transport.pending.v1';
    const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const validState = value => object(value) && object(value.state) && Number.isSafeInteger(value.rev) && value.rev >= 0;
    const validAction = action => {
        if (!object(action) || action.a !== 'npc') return false;
        if (action.g === 'gomoku') return ['start', 'end'].includes(action.k);
        if (action.g === 'card') return action.k === undefined || action.k === 'play';
        if (action.g === 'rps') return (action.k === undefined || action.k === 'play') && Number.isInteger(action.m) && action.m >= 0 && action.m <= 2;
        if (action.g === 'box') return action.k === 'start' || action.k === 'pick' && Number.isInteger(action.i) && action.i >= 0 && action.i < 9;
        return false;
    };
    const URLType = env.URL || globalThis.URL;
    const Encoder = env.TextEncoder || globalThis.TextEncoder;
    const encoder = new Encoder();
    const frozen = new Map();
    const ownEdges = new Map();
    const nativePending = new Set();
    const waiters = new Set();
    const selfPaths = new Set(['/api/pet/world', '/api/pet/world/act', '/api/pet/world/auto', '/api/pet/world/welcome', '/api/pet/world/tax']);
    let installed = false, enabled = false, disposed = false;
    let originalFetch = null, storage = null, pending = null, snapshot = null, snapshotOwner;
    let driverOwner, epoch = 0, flight = null;
    let queued = 0, hiding = false;
    let tail = Promise.resolve();

    function account() {
        const value = options.getAccount?.();
        if (value == null) return null;
        if (!['string', 'number'].includes(typeof value)) throw new Error('账号标识无效');
        return String(value);
    }
    function notify(name, ...values) {
        try { options[name]?.(...values.map(copy)); }
        catch (error) { report('后台小游戏状态回调失败，已暂停', !!pending, error); }
    }
    function report(message, unconfirmed = false, cause = null) {
        enabled = false;
        const error = new Error(message);
        error.code = unconfirmed ? 'GOMOKU_UNCONFIRMED' : 'GOMOKU_FAILED';
        error.unconfirmed = unconfirmed;
        error.pending = copy(pending);
        if (cause) error.cause = cause;
        try { options.onError?.(error); } catch { /* 原生请求不受错误回调异常影响。 */ }
        return error;
    }
    function nativeError(message) {
        const error = new Error(message);
        error.code = 'GOMOKU_NATIVE_RETRY';
        return error;
    }
    function enqueue(task) {
        queued++;
        const result = tail.then(task).finally(() => { queued--; });
        tail = result.catch(() => {});
        return result;
    }
    function dispatchIdle(task) {
        // 先占住仲裁槽，再在当前调用栈派发 keepalive；后来的请求仍必须等待这次响应。
        queued++;
        let resolve, reject;
        const slot = new Promise((yes, no) => { resolve = yes; reject = no; });
        const result = slot.finally(() => { queued--; });
        tail = result.catch(() => {});
        try { Promise.resolve(task()).then(resolve, reject); } catch (error) { reject(error); }
        return result;
    }
    function wake() {
        for (const resolve of waiters) resolve();
        waiters.clear();
    }
    function fingerprint(text) {
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
        return `${text.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
    }
    function validJournal(value) {
        if (!object(value) || typeof value.operation !== 'string' || !validAction(value.action)
            || !(value.owner === null || typeof value.owner === 'string')) return false;
        if (value.version === 1) return Number.isInteger(value.originalCount) && value.originalCount >= 0
            && value.originalCount < 40 && typeof value.originalFingerprint === 'string';
        if (value.version !== 2 || value.kind !== 'standalone' || typeof value.body !== 'string'
            || !Number.isSafeInteger(value.baseRev) || value.baseRev < 0) return false;
        try {
            const body = JSON.parse(value.body);
            return body.rev === value.baseRev && body.operation === value.operation && body.actions?.length === 1
                && JSON.stringify(body.actions[0]) === JSON.stringify(value.action);
        } catch { return false; }
    }
    function loadPending() {
        try {
            storage = env.sessionStorage || env.localStorage;
            if (!storage) throw new Error('浏览器存储不可用');
            const raw = storage.getItem(storageKey);
            if (!raw) return;
            const saved = JSON.parse(raw);
            if (!validJournal(saved)) throw new Error('待确认记录无效');
            pending = saved;
            // 刷新后的旧 in-flight/retry 已没有本页任务会完成它，必须拒绝旧保存而不是永久等待。
            pending.status = 'unknown';
            report('发现刷新前未确认的小游戏请求，请先核对服务端状态', true);
        } catch (error) {
            pending = { status: 'storage-unavailable' };
            report('后台小游戏待确认记录无法读取，已暂停', true, error);
        }
    }
    function persist(entry, status) {
        const value = { version: 2, kind: 'standalone', operation: entry.operation, action: copy(entry.action),
            body: entry.body, baseRev: entry.baseRev, owner: entry.owner, originalCount: 0,
            originalFingerprint: fingerprint(entry.body), status, createdAt: entry.createdAt };
        try { storage.setItem(storageKey, JSON.stringify(value)); pending = value; return true; }
        catch (error) { report('后台请求待确认记录保存失败，已暂停', !!pending, error); return false; }
    }
    function clearPending(operation) {
        if (!pending || (operation !== undefined && pending.operation !== operation)) return true;
        try { storage.removeItem(storageKey); pending = null; wake(); return true; }
        catch (error) {
            pending.status = 'unknown';
            report('后台请求待确认记录无法清除，已暂停', true, error);
            wake();
            return false;
        }
    }
    function unknown(entry, message, cause) {
        if (entry.resolved) return report(message, false, cause);
        entry.status = 'unknown';
        if (pending?.operation === entry.operation) pending.status = 'unknown';
        persist(entry, 'unknown');
        wake();
        return report(message, true, cause);
    }
    function observe(data, owner, publish = true, context = null) {
        if (!validState(data)) return false;
        if (snapshot && snapshotOwner === owner && data.rev < snapshot.rev) return false;
        snapshot = copy(data);
        snapshotOwner = owner;
        if (publish) notify('onState', data, context);
        return true;
    }
    async function readData(response) {
        try { return await response.clone().json(); } catch { return null; }
    }
    function emit(name, detail) {
        const Event = env.CustomEvent || globalThis.CustomEvent;
        if (typeof env.dispatchEvent === 'function' && typeof Event === 'function') env.dispatchEvent(new Event(name, { detail }));
    }
    function nativeBusy() {
        const detail = { busy: false };
        emit('pet-friend-check', detail);
        return detail.busy === true;
    }
    function edgeKey(owner, rev) { return JSON.stringify([owner, rev]); }
    function rebase(rev, owner) {
        if (!snapshot || snapshotOwner !== owner || rev >= snapshot.rev) return rev;
        let current = rev;
        while (current < snapshot.rev) {
            const edge = ownEdges.get(edgeKey(owner, current));
            if (!edge || edge.to !== current + 1) return rev;
            current = edge.to;
        }
        return current;
    }
    function route(input, init) {
        try {
            const url = new URLType(typeof input === 'string' ? input : input.url || input.href, env.location.href);
            if (url.origin !== env.location.origin || !(url.pathname === '/api/pet/world' || url.pathname.startsWith('/api/pet/world/'))) return null;
            const method = String(init?.method ?? input?.method ?? 'GET').toUpperCase();
            if (!['GET', 'POST'].includes(method)) return null;
            return { method, self: !url.search && !url.hash && selfPaths.has(url.pathname), act: url.pathname === '/api/pet/world/act',
                keepalive: init?.keepalive ?? input?.keepalive ?? false };
        } catch { return null; }
    }
    async function bodyOf(input, init) {
        if (init?.body !== undefined) return typeof init.body === 'string' ? init.body : null;
        return typeof input?.clone === 'function' ? input.clone().text() : null;
    }
    function ownBlocksNative(request, owner) {
        if (!pending || pending.owner !== owner && pending.owner !== undefined) return null;
        if (pending.version !== 2 || pending.kind !== 'standalone') return 'unknown';
        if (request.rev > pending.baseRev) return null;
        return pending.status === 'inflight' || pending.status === 'retry' ? 'wait' : 'unknown';
    }
    async function sendNative(input, init, target, text, request, owner) {
        if (account() !== owner) throw nativeError('账号已变化，旧页面保存尚未派发，请刷新核对');
        const hasIdentity = target.self && object(request) && typeof request.operation === 'string'
            && Number.isSafeInteger(request.rev) && request.rev >= 0;
        let entry = hasIdentity ? frozen.get(request.operation) : null;
        if (entry && (entry.kind !== 'native' || entry.originalBody !== text || entry.owner !== owner)) {
            throw report('同一原生操作标识的输入已变化，已禁止发送');
        }
        if (entry?.status === 'retired') throw nativeError('该限流批次已由相同的新批次确认完成，禁止再次派发旧操作');
        if (hasIdentity && pending?.operation === request.operation) throw nativeError('原生请求与待确认后台操作标识冲突，请先核对结果');
        if (hasIdentity) {
            const blocked = ownBlocksNative(request, owner);
            if (blocked === 'unknown') throw nativeError('后台请求结果未确认，暂缓旧版本原生保存以保留操作队列');
            if (blocked === 'wait') return { wait: new Promise(resolve => waiters.add(resolve)) };
        }
        if (!entry && hasIdentity) {
            const nextRev = rebase(request.rev, owner);
            if (snapshotOwner === owner && request.rev < snapshot.rev && nextRev !== snapshot.rev) {
                report('世界版本变化无法仅由后台小游戏解释，后台已暂停；原生保存暂缓以保留操作');
                throw nativeError('缺少完整后台版本链，暂缓旧版本原生保存，请核对页面状态');
            }
            const body = nextRev === request.rev ? text : JSON.stringify({ ...request, rev: nextRev });
            if (encoder.encode(body).length > 3900 && body !== text) throw nativeError('重基后保存批次超过限制，请核对页面操作');
            entry = { kind: 'native', operation: request.operation, originalBody: text, body, owner, status: 'inflight',
                payload: JSON.stringify({ ...request, rev: nextRev, operation: null }), wireRev: nextRev,
                actionCount: Array.isArray(request.actions) ? request.actions.length : null, uncertain: false };
            frozen.set(request.operation, entry);
        }
        const outgoing = entry && entry.body !== text ? { ...init, body: entry.body } : init;
        try {
            if (entry) entry.status = 'inflight';
            const response = await originalFetch.call(env, input, outgoing);
            const data = await readData(response);
            let context = null;
            if (entry) {
                const rejected = response.status >= 400 && response.status < 500 && response.status !== 429;
                entry.status = rejected && !entry.uncertain || response.ok && validState(data) ? 'resolved' : 'retry';
                entry.lastStatus = response.status;
                if (!rejected && response.status !== 429 && !(response.ok && validState(data))) entry.uncertain = true;
                if (entry.status === 'resolved') nativePending.delete(entry); else nativePending.add(entry);
                if (rejected && entry.uncertain) report('原生保存曾出现未知结果，当前拒绝响应不足以确认旧操作，后台已暂停');
                const confirmed = response.ok && validState(data) && data.rev === entry.wireRev + 1
                    && (entry.actionCount === null || Array.isArray(data.out) && data.out.length === entry.actionCount
                        && data.out.every(result => object(result) && typeof result.ok === 'boolean'));
                if (confirmed) {
                    // 仅完整确认的同页非 NPC 批次能证明盲盒仍为原局；GET 本身不提供版本来源。
                    if (target.act && Array.isArray(request.actions)
                        && request.actions.every(action => object(action) && typeof action.a === 'string' && action.a !== 'npc')) {
                        context = { origin: 'native', requestRev: entry.wireRev };
                    }
                    // 仅同一版本、同一完整批次的新操作已成功，才能证明旧 429 批次已被取代。
                    for (const previous of nativePending) {
                        if (previous !== entry && previous.owner === owner && previous.status === 'retry'
                            && previous.lastStatus === 429 && !previous.uncertain && previous.payload === entry.payload) {
                            previous.status = 'retired';
                            nativePending.delete(previous);
                        }
                    }
                }
            }
            if (target.self && (response.ok || response.status === 409) && account() === owner) observe(data, owner, true, context);
            return { response };
        } catch (error) {
            if (entry) { entry.status = 'unknown'; entry.lastStatus = null; entry.uncertain = true; nativePending.add(entry); }
            throw error;
        }
    }
    function wrappedFetch(input, init) {
        const target = route(input, init);
        if (!target) return originalFetch.call(env, input, init);
        // 字符串请求的手动 NPC 意图在入队时立即失效后台归属，不等正在进行的请求结束。
        let immediate = null;
        if (target.method === 'POST' && typeof init?.body === 'string') {
            try { immediate = JSON.parse(init.body); } catch { /* 非 JSON 请求仍原样排队。 */ }
            if (target.act && Array.isArray(immediate?.actions) && immediate.actions.some(action => action?.a === 'npc')) {
                enabled = false;
                notify('onManualNpc');
            }
        }
        if (target.method === 'POST' && !target.self && enabled) report('检测到其他世界写操作，后台已暂停；原生操作继续执行');
        const owner = account();
        if (target.method === 'GET') return enqueue(async () => {
            const response = await originalFetch.call(env, input, init);
            const data = await readData(response);
            if (target.self && response.ok && account() === owner) observe(data, owner);
            return response;
        });
        const terminal = hiding || env.document?.hidden === true || env.document?.visibilityState === 'hidden' || env.event?.type === 'pagehide';
        if (target.act && target.self && target.keepalive === true && terminal && !queued && !flight && !pending && !nativePending.size
            && typeof init?.body === 'string' && object(immediate) && typeof immediate.operation === 'string'
            && Number.isSafeInteger(immediate.rev) && immediate.rev >= 0 && !frozen.has(immediate.operation)
            && (!snapshot || snapshotOwner !== owner || immediate.rev >= snapshot.rev)) {
            return dispatchIdle(() => sendNative(input, init, target, init.body, immediate, owner)).then(result => result.response);
        }
        return (async () => {
            let text = null, request = immediate;
            try { text = typeof init?.body === 'string' ? init.body : await bodyOf(input, init); if (request === null && typeof text === 'string') request = JSON.parse(text); }
            catch { /* 无法读取的原生请求不改写。 */ }
            if (!immediate && target.act && Array.isArray(request?.actions) && request.actions.some(action => action?.a === 'npc')) {
                enabled = false;
                notify('onManualNpc');
            }
            for (;;) {
                const result = await enqueue(() => sendNative(input, init, target, text, request, owner));
                if (result.wait) { await result.wait; continue; }
                return result.response;
            }
        })();
    }
    function uuid() {
        const crypto = env.crypto || globalThis.crypto;
        if (crypto?.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const value = Math.floor(Math.random() * 16);
            return (c === 'x' ? value : value & 3 | 8).toString(16);
        });
    }
    function cancelEntry(entry, reason) {
        entry.resolved = true;
        entry.status = 'cancelled';
        clearPending(entry.operation);
        notify('onSkipped', entry.action, reason);
    }
    async function attempt(task) {
        if (task.token !== epoch || !enabled || disposed) {
            if (task.entry?.status === 'retry') cancelEntry(task.entry, '后台已暂停，排队的限流动作未执行');
            return { submitted: false, cancelled: true };
        }
        const owner = account();
        if (driverOwner !== undefined && driverOwner !== owner) throw report('账号已变化，后台已暂停；不会沿用另一账号的棋局');
        if (driverOwner === undefined) driverOwner = owner;
        if ([...nativePending].some(entry => entry.owner === owner)) return { submitted: false, deferred: true, reason: 'native-pending' };
        let entry = task.entry;
        if (!entry) {
            if (pending) throw report('有结果未确认的后台请求，禁止另开棋局', true);
            let response;
            task.readAttempts++;
            try { response = await originalFetch.call(env, '/api/pet/world', { credentials: 'same-origin', cache: 'no-cache' }); }
            catch (error) {
                if (task.readAttempts >= 3) throw report('世界状态读取失败，尚未发送后台动作，已暂停', false, error);
                notify('onStatus', '世界状态暂时无法读取，正在重试');
                return { retry: true, delay: 300 * task.readAttempts };
            }
            if (!response.ok && response.status >= 500 && task.readAttempts < 3) {
                notify('onStatus', '世界状态暂时无法读取，正在重试');
                return { retry: true, delay: 300 * task.readAttempts };
            }
            const value = await readData(response);
            if (!response.ok || !validState(value)) throw report('无法读取当前账号的完整世界状态，后台已暂停');
            if (account() !== owner) throw report('读取期间账号已变化，后台已暂停');
            if (!observe(value, owner) && snapshot?.rev !== value.rev) throw report('世界状态版本异常，后台已暂停');
            if (task.token !== epoch || !enabled || disposed) return { submitted: false, cancelled: true };
            if (nativeBusy()) return { submitted: false, deferred: true, reason: 'native-busy' };
            const operation = uuid();
            if (frozen.has(operation)) throw report('后台操作标识重复，已暂停；不会改写已有请求');
            let action;
            try { action = options.nextAction?.(copy(value), { rev: value.rev, operation, actions: [] }); }
            catch (error) { throw report('后台规划失败，已暂停', false, error); }
            if (action == null) return { submitted: false, snapshot: copy(value) };
            if (!validAction(action) || typeof action.then === 'function') throw report('后台规划返回了无效 NPC 动作');
            action = copy(action);
            if (task.token !== epoch || !enabled || disposed) {
                notify('onSkipped', action, '后台已暂停，动作尚未派发');
                return { submitted: false, cancelled: true };
            }
            const body = JSON.stringify({ rev: value.rev, operation, actions: [action] });
            if (encoder.encode(body).length > 3900) {
                notify('onSkipped', action, '小游戏请求超过批次字节上限');
                throw report('小游戏请求超过保存限制，后台已暂停');
            }
            entry = { kind: 'standalone', operation, action, body, baseRev: value.rev, owner, createdAt: Date.now(), status: 'inflight', resolved: false };
            if (!persist(entry, 'inflight')) {
                notify('onSkipped', action, '待确认记录保存失败，动作尚未派发');
                throw new Error('后台请求无法保存待确认记录');
            }
            task.entry = entry;
            frozen.set(operation, entry);
        } else {
            if (entry.owner !== owner) throw report('账号已变化，后台已暂停', true);
            if (nativeBusy()) {
                cancelEntry(entry, '原生保存优先，本次限流请求不再派发');
                return { submitted: false, deferred: true, reason: 'native-busy' };
            }
            if (!persist(entry, 'inflight')) {
                cancelEntry(entry, '待确认记录更新失败，本次限流动作未执行');
                return { submitted: false, cancelled: true };
            }
        }
        if (account() !== owner) {
            cancelEntry(entry, '提交前账号已变化，动作尚未派发');
            throw report('提交前账号已变化，后台已暂停');
        }
        entry.status = 'inflight';
        task.attempts++;
        let response;
        try {
            response = await originalFetch.call(env, '/api/pet/world/act', { method: 'POST', credentials: 'same-origin',
                headers: { 'content-type': 'application/json' }, body: entry.body });
        } catch (error) { throw unknown(entry, '后台请求网络结果未确认，已暂停；不会另开一局', error); }
        const data = await readData(response);
        if (response.status === 429) {
            entry.status = 'retry';
            persist(entry, 'retry');
            if (task.attempts >= 3) {
                cancelEntry(entry, '服务端持续限流，本次动作未执行');
                throw report('后台请求持续限流，已暂停；稍后可重新开启');
            }
            if (task.token !== epoch || !enabled || disposed) {
                cancelEntry(entry, '后台已暂停，限流动作未执行');
                return { submitted: false, cancelled: true };
            }
            const retry = Number(data?.retry);
            return { retry: true, delay: Math.max(250, Math.min(30000, (Number.isFinite(retry) && retry >= 0 ? retry : 2) * 1000 + 200)) };
        }
        if (!response.ok) {
            if (response.status >= 500) throw unknown(entry, `后台服务器响应异常（HTTP ${response.status}），结果未确认`);
            entry.resolved = true;
            clearPending(entry.operation);
            if (account() === owner) observe(data, owner);
            notify('onSkipped', entry.action, '服务端明确拒绝本次后台请求');
            throw report(`后台请求保存失败（HTTP ${response.status}），已暂停`);
        }
        if (!validState(data) || data.rev !== entry.baseRev + 1 || !Array.isArray(data.out) || data.out.length !== 1 || typeof data.out[0]?.ok !== 'boolean') {
            throw unknown(entry, '后台回执或版本无法确认，已暂停；不会另开一局');
        }
        // 即使动作失败，服务端也可能已删除 npcG；这条已确认的单 NPC 版本边仍须保护原生旧队列。
        ownEdges.set(edgeKey(owner, entry.baseRev), { to: data.rev, operation: entry.operation });
        entry.resolved = true;
        clearPending(entry.operation);
        if (account() !== owner) throw report('回执返回时账号已变化，后台已暂停；不认领该棋局');
        observe(data, owner, false);
        try {
            if (data.out[0].ok) options.onReceipt?.(copy(entry.action), copy(data.out[0]), copy(data));
            else report('后台 NPC 动作失败，已暂停：' + (data.out[0].msg || '服务端未接受棋局'));
        } catch (error) {
            entry.resolved = false;
            throw unknown(entry, '后台回执处理失败，已暂停，请核对结果', error);
        } finally {
            notify('onState', data);
            emit('pet-friend-saved', copy(data));
        }
        return { submitted: true, response, snapshot: copy(data) };
    }
    function finish(task, result, error) {
        if (flight === task) flight = null;
        if (task.timer !== null) env.clearTimeout(task.timer);
        if (error) task.reject(error); else task.resolve(result);
    }
    function run(task) {
        enqueue(() => attempt(task)).then(result => {
            if (!result.retry) { finish(task, result); return; }
            if (task.token !== epoch || !enabled || disposed) {
                if (task.entry?.status === 'retry') cancelEntry(task.entry, '后台已暂停，限流动作未执行');
                finish(task, { submitted: false, cancelled: true });
                return;
            }
            task.timer = env.setTimeout(() => { task.timer = null; run(task); }, result.delay);
        }, error => finish(task, null, error));
    }
    function submitAutonomous() {
        if (flight) return flight.promise;
        if (!installed || !enabled || disposed) return Promise.resolve({ submitted: false, cancelled: true });
        const task = { token: epoch, entry: null, timer: null, attempts: 0, readAttempts: 0 };
        task.promise = new Promise((resolve, reject) => { task.resolve = resolve; task.reject = reject; });
        flight = task;
        run(task);
        return task.promise;
    }
    function cancelAutonomous() {
        epoch++;
        const task = flight;
        if (task?.timer !== null && task?.timer !== undefined) {
            env.clearTimeout(task.timer);
            task.timer = null;
        }
        if (task?.entry?.status === 'retry') {
            cancelEntry(task.entry, '后台已暂停，限流动作未执行');
            finish(task, { submitted: false, cancelled: true });
        } else if (task && !task.entry) finish(task, { submitted: false, cancelled: true });
    }
    function install() {
        if (installed) return api;
        if (typeof env.fetch !== 'function') throw new Error('浏览器 fetch 不可用');
        originalFetch = env.fetch;
        installed = true;
        loadPending();
        env.addEventListener?.('pagehide', () => { hiding = true; }, true);
        env.addEventListener?.('pageshow', () => { hiding = false; }, true);
        env.fetch = wrappedFetch;
        return api;
    }
    function dispose() {
        enabled = false;
        disposed = true;
        cancelAutonomous();
        // 已确认版本边和原生冻结体仍保护本页保存；停止后台不卸掉这层仲裁。
        if (!ownEdges.size && !pending && !frozen.size && env.fetch === wrappedFetch) {
            env.fetch = originalFetch;
            installed = false;
        }
    }
    const api = { install, dispose, submitAutonomous, cancelAutonomous,
        setEnabled(value) {
            enabled = value === true && !disposed;
            // 开启时即绑定账号，首次自主请求前的账号切换也不能跨越归属边界。
            if (enabled && driverOwner === undefined) driverOwner = account();
            if (!enabled) cancelAutonomous();
        },
        getSnapshot() { return copy(snapshot); },
        getPending() { return copy(pending); },
        clearResolvedPending() {
            if (!pending) return true;
            const entry = frozen.get(pending.operation);
            return entry?.resolved === true ? clearPending(pending.operation) : false;
        }
    };
    return api;
},function createGomokuBackground(options) {
    'use strict';
    options = options || {};
    const env = options.window || globalThis;
    const getBook = options.getBook || (() => options.book);
    if (typeof options.createTransport !== 'function' || typeof options.createBook !== 'function' || typeof options.createSolver !== 'function' || !getBook()) throw new Error('后台小游戏缺少传输层、棋谱或搜索工厂');
    let enabled = false;
    let disposed = false;
    let installed = false;
    let generation = 0;
    let phase = 'idle';
    const rewardsOnly = true;
    let next = true;
    let games = ['gomoku'];
    let rotation = 0;
    let skipGomoku = false;
    let ignoredPractice = null;
    let timeMs = Number.isFinite(options.timeMs) ? Math.max(0, options.timeMs) : 3000;
    let rules = null;
    let verifiedHash = null;
    let snapshot = null;
    let owned = null;
    let ownedBoxRev = null;
    let ready = null;
    let sent = null;
    let workerJob = null;
    let lastError = null;
    let ownershipInvalidated = false;
    let observer = null;
    let pumpTimer = null;
    let pumping = false;
    let afterPump = null;
    let startWait = null;
    let lastSettlement = null;
    const gameNames = { gomoku: '五子棋', card: '抽牌比大小', rps: '剪刀石头布', box: '盲盒夺宝' };
    const clone = value => JSON.parse(JSON.stringify(value));
    const status = message => options.onStatus?.(message);
    const transport = options.createTransport({
        window: env,
        getAccount: options.getAccount,
        nextAction,
        onReceipt,
        onState,
        onSkipped,
        onError: error => stop(error?.unconfirmed ? '后台请求结果未知，已暂停；请先核对原生保存结果，不会自动另开一局' : '后台保存失败，已暂停：' + (error?.message || '未知错误')),
        onManualNpc: manualNpc,
        onStatus: status,
    });

    function cancelWorker() {
        if (!workerJob) return;
        env.clearTimeout(workerJob.timer);
        workerJob.worker.terminate();
        workerJob = null;
    }

    function pause() {
        generation++;
        enabled = false;
        cancelWorker();
        if (pumpTimer !== null) env.clearTimeout(pumpTimer);
        pumpTimer = null;
        afterPump = null;
        if (startWait) { env.clearTimeout(startWait.timer); startWait.resolve(); startWait = null; }
        transport.setEnabled(false);
        if (!disposed) phase = 'paused';
        // 已发送动作的收据仍须处理；保留本实例的归属和已计算棋谱，不擅自结束服务器棋局。
    }

    function stop(message) {
        pause();
        lastError = message;
        status(message);
        options.onStop?.(message);
    }

    function manualNpc() {
        ownershipInvalidated = true;
        ignoredPractice = null;
        owned = null;
        ready = null;
        sent = null;
        stop('检测到手动 NPC 操作，后台已暂停；不会提交旧棋局');
    }

    function sceneAllowed() {
        const document = env.document;
        return !document?.querySelector('.isle.visiting');
    }

    function schedulePump(delay = 0) {
        if (!enabled || disposed || options.autoDrive === false) return;
        if (pumping) { afterPump = { delay, generation }; return; }
        if (pumpTimer !== null) env.clearTimeout(pumpTimer);
        pumpTimer = env.setTimeout(drive, delay);
    }

    async function drive() {
        pumpTimer = null;
        if (!enabled || disposed || pumping || !['waiting', 'ready'].includes(phase)) return;
        const control = generation;
        pumping = true;
        let deferred = false;
        try {
            const result = await transport.submitAutonomous();
            deferred = !!result?.deferred;
            if (deferred && enabled && control === generation) status('等待页面当前保存完成，随后继续后台对局');
        } catch (error) {
            if (enabled && control === generation) stop('后台请求失败，已暂停：' + error.message);
        } finally {
            pumping = false;
            const requested = afterPump;
            afterPump = null;
            if (enabled && ['waiting', 'ready'].includes(phase)) {
                if (requested?.generation === generation) schedulePump(requested.delay);
                else if (control === generation) schedulePump(deferred ? 500 : 250);
            }
        }
    }

    async function readInitialState(control) {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const response = await env.fetch('/api/pet/world', { credentials: 'same-origin', cache: 'no-cache' });
                if (!response.ok && response.status < 500) throw Object.assign(new Error('无法读取当前账号世界状态'), { final: true });
                if (!response.ok) throw new Error('世界状态暂时无法读取');
                const value = await response.json();
                if (!value?.state || !Number.isSafeInteger(value.rev) || value.rev < 0) throw Object.assign(new Error('世界状态格式异常'), { final: true });
                return value;
            } catch (error) {
                if (control !== generation || disposed) return null;
                if (error.final || attempt === 2) throw error;
                status('世界状态暂时无法读取，正在重试');
                await new Promise(resolve => { startWait = { resolve, timer: env.setTimeout(resolve, 300 * (attempt + 1)) }; });
                startWait = null;
                if (control !== generation || disposed) return null;
            }
        }
        return null;
    }

    function manualBoard() {
        return !!env.document?.querySelector('canvas.gomoku15, .gomoku-levels, .fun-head, .fun-games');
    }

    function identity(game, completedBox = false) {
        if (game?.g === 'box') {
            if (game.done && !completedBox) return null;
            const { left, me, np } = game;
            const pk = game.pk ?? [];
            if (!Array.isArray(left) || !Array.isArray(me) || !Array.isArray(np) || !Array.isArray(pk)
                || me.length !== np.length || me.length > (completedBox ? 3 : 2)
                || left.length + me.length + np.length !== 9 || pk.length !== me.length * 2
                || [...left, ...me, ...np].some(value => !Number.isFinite(value))
                || pk.some(value => !Number.isInteger(value) || value < 0 || value >= 9) || new Set(pk).size !== pk.length) return null;
            return { g: 'box', left: clone(left), me: clone(me), np: clone(np), pk: clone(pk) };
        }
        if (!game || game.g !== 'gomoku' || game.d !== 3 || game.n !== 15 || !Number.isSafeInteger(game.seed) || game.seed <= 0 || !Number.isFinite(game.t)) return null;
        return { g: 'gomoku', d: 3, n: 15, seed: game.seed, t: game.t, p: !!game.p };
    }

    function sameGame(first, second) {
        const value = identity(second);
        return !!first && !!value && JSON.stringify(first) === JSON.stringify(value);
    }

    function quotaCounts(value) {
        if (!value?.state || !Number.isFinite(value.now)) throw new Error('服务器未返回完整状态或时间，无法确认奖励额度');
        const refreshed = clone(value.state);
        rules.refresh(refreshed, value.now);
        const npc = refreshed.cnt?.npc ?? 0;
        const paid = refreshed.cnt?.gomokuPaid ?? 0;
        if (!Number.isSafeInteger(npc) || npc < 0 || !Number.isSafeInteger(paid) || paid < 0) throw new Error('服务器奖励计数异常');
        return { npc, paid };
    }

    function selectGame(value) {
        const { npc, paid } = quotaCounts(value);
        if (npc >= rules.NPC.daily) return null;
        if (!skipGomoku && paid < rules.GOMOKU_PAID) return 'gomoku';
        const others = games.filter(game => game !== 'gomoku');
        return others.length ? others[rotation % others.length] : null;
    }

    function quotaAvailable(value) { return selectGame(value) !== null; }

    function practiceIdentity(game) {
        if (game?.g !== 'gomoku' || !game.p || ![1, 2, 3].includes(game.d) || game.n !== 15
            || !Number.isSafeInteger(game.seed) || game.seed <= 0 || !Number.isFinite(game.t)) return null;
        return { g: 'gomoku', d: game.d, n: 15, seed: game.seed, t: game.t, p: true };
    }

    function sameIgnoredPractice(game) {
        const current = practiceIdentity(game);
        return !!ignoredPractice && !!current && JSON.stringify(ignoredPractice) === JSON.stringify(current);
    }

    function skipExistingPractice(value) {
        const current = practiceIdentity(value?.state?.npcG);
        if (!current || !games.some(game => game !== 'gomoku') || quotaCounts(value).npc >= rules.NPC.daily) return false;
        // 抽牌、猜拳保留 npcG，盲盒开局按原站语义自然替换它；不提交练习五子棋的结束动作。
        ignoredPractice = current;
        skipGomoku = true;
        owned = null;
        ready = null;
        status('已跳过现有五子棋练习局，本次只继续所选其他小游戏');
        return true;
    }

    function matchesSent(action) {
        return sent && action?.a === 'npc' && action.g === sent.g && (action.k || 'play') === sent.kind
            && (sent.kind !== 'pick' || action.i === sent.i);
    }

    function nextBoxState(previous, action, out) {
        const current = identity(out?.box, true);
        if (!current || current.me.length !== previous.me.length + 1 || current.np.length !== previous.np.length + 1
            || !Number.isInteger(out.j) || out.j < 0 || out.j >= 9 || out.j === action.i || previous.pk.includes(out.j)) return null;
        const left = clone(previous.left);
        for (const item of [out.mine, out.theirs]) {
            const index = left.indexOf(item);
            if (index < 0) return null;
            left.splice(index, 1);
        }
        const expected = { g: 'box', left, me: [...previous.me, out.mine], np: [...previous.np, out.theirs], pk: [...previous.pk, action.i, out.j] };
        return JSON.stringify(current) === JSON.stringify(expected) ? current : null;
    }

    function verifyBoxState(value, context) {
        if (owned?.g !== 'box') return true;
        const continuous = Number.isSafeInteger(ownedBoxRev) && (value?.rev === ownedBoxRev
            || (context?.origin === 'native' && context.requestRev === ownedBoxRev && value?.rev === ownedBoxRev + 1));
        if (continuous && sameGame(owned, value?.state?.npcG)) {
            ownedBoxRev = value.rev;
            return true;
        }
        // 盲盒初态没有唯一标识；内容相同也不能跨过来源不明的版本变化。
        owned = null;
        ownedBoxRev = null;
        ready = null;
        sent = null;
        ownershipInvalidated = true;
        stop('无法证明盲盒仍为本实例原局，后台已暂停；不会继续未知对局');
        return false;
    }

    function onState(value, context) {
        snapshot = value;
        if (!verifyBoxState(value, context)) return;
        if (!enabled || phase === 'loading' || phase === 'starting' || phase === 'settling') return;
        if (ignoredPractice && !sameIgnoredPractice(value?.state?.npcG)) {
            stop('被跳过的五子棋练习局已变化，后台已暂停；请核对当前对局');
        } else if (owned && !sameGame(owned, value?.state?.npcG)) {
            owned = null;
            ready = null;
            stop('服务器对局已变化，后台已暂停；不会接管其他对局');
        } else if (!owned && value?.state?.npcG && !sameIgnoredPractice(value.state.npcG)) {
            stop('已有未完成的 NPC 对局，后台已暂停；请先手动处理');
        }
    }

    function nextAction(value, request) {
        if (!enabled || disposed || !rules || sent || transport.getPending?.()) return null;
        try {
            // 原生客户端可能已接收更高版本；旧快照不能为新版本请求提交无 seed 的结束动作。
            if (!Number.isSafeInteger(value?.rev) || !Number.isSafeInteger(request?.rev) || value.rev !== request.rev) return null;
            if (request?.actions?.some(action => action?.a === 'npc')) { manualNpc(); return null; }
            if (!sceneAllowed()) { stop('当前正在串门，后台已暂停'); return null; }
            if (manualBoard()) { manualNpc(); return null; }
            snapshot = value;
            const current = value?.state?.npcG;
            if (!verifyBoxState(value)) return null;
            if (owned) {
                if (!sameGame(owned, current)) {
                    owned = null;
                    ready = null;
                    stop('服务器对局已变化，后台已暂停；不会提交旧对局');
                    return null;
                }
                if (owned.g === 'box') {
                    const i = Array.from({ length: 9 }, (_, index) => index).find(index => !owned.pk.includes(index));
                    sent = { kind: 'pick', g: 'box', i, identity: clone(owned) };
                    phase = 'settling';
                    status('正在完成本实例的盲盒对局');
                    return { a: 'npc', g: 'box', k: 'pick', i };
                }
                if (owned.p) { stop('服务器已标记为练习局，后台已暂停；本局尚未结算'); return null; }
                if (!ready) return null;
                const action = { a: 'npc', g: 'gomoku', k: 'end', mv: clone(ready.mv) };
                sent = { kind: 'end', g: 'gomoku', identity: clone(owned), game: ready.game };
                phase = 'settling';
                status('胜局已准备，正在提交结算');
                return action;
            }
            if (ignoredPractice && !sameIgnoredPractice(current)) { stop('被跳过的五子棋练习局已变化，后台已暂停'); return null; }
            if (current && !sameIgnoredPractice(current)) { stop('已有未完成的 NPC 对局，后台已暂停；请先手动处理'); return null; }
            const game = selectGame(value);
            if (!game) { stop('今日所选小游戏奖励额度已用完，已暂停'); return null; }
            const kind = ['gomoku', 'box'].includes(game) ? 'start' : 'play';
            sent = { kind, g: game };
            phase = kind === 'start' ? 'starting' : 'settling';
            status(gameNames[game] + ' · 正在开启小游戏奖励局');
            if (game === 'gomoku') return { a: 'npc', g: game, k: 'start', d: 3 };
            if (game === 'box') return { a: 'npc', g: game, k: 'start' };
            return game === 'rps' ? { a: 'npc', g: game, k: 'play', m: 0 } : { a: 'npc', g: game, k: 'play' };
        } catch (error) {
            stop('后台规划失败，已暂停：' + error.message);
            return null;
        }
    }

    function onSkipped(action) {
        if (!matchesSent(action)) return;
        // 仲裁器可能让原生保存优先；明确未发出的动作不能占住等待收据状态。
        sent = null;
        if (!enabled || disposed) return;
        phase = owned && ready ? 'ready' : 'waiting';
        status('本次后台请求尚未发送，稍后继续');
        schedulePump(500);
    }

    function onReceipt(action, out, value) {
        snapshot = value;
        if (disposed || ownershipInvalidated || !matchesSent(action)) return;
        if (out?.ok !== true || out.g !== sent.g) { stop('后台动作未确认成功，已暂停'); return; }
        if (sent.kind === 'start') {
            const current = identity(value?.state?.npcG);
            if (sent.g === 'box') {
                if (!current || current.g !== 'box' || current.me.length !== 0
                    || JSON.stringify(current) !== JSON.stringify(identity(out.box))) {
                    sent = null;
                    stop('盲盒开局收据与完整服务器状态不一致，已暂停；不会认领未知对局');
                    return;
                }
                owned = current;
                ownedBoxRev = value.rev;
                ignoredPractice = null;
                sent = null;
                if (enabled) { phase = 'waiting'; status('盲盒已开启，正在准备选择'); schedulePump(500); }
                else phase = 'paused';
                return;
            }
            if (!current || current.g !== 'gomoku' || current.seed !== out.seed || (out.d !== undefined && out.d !== 3) || Boolean(out.practice) !== current.p) {
                sent = null;
                stop('开局收据与服务器棋局不一致，已暂停；不会认领未知棋局');
                return;
            }
            owned = current;
            ready = null;
            sent = null;
            if (current.p) {
                if (enabled && skipExistingPractice(value)) { phase = 'waiting'; schedulePump(); }
                else stop('服务器已标记为练习局，后台已暂停；本局尚未结算');
                return;
            }
            if (enabled) calculateGame();
            else phase = 'paused';
            return;
        }
        const completed = sent;
        sent = null;
        if (completed.kind === 'pick') {
            const current = owned && sameGame(completed.identity, owned) ? nextBoxState(completed.identity, action, out) : null;
            if (!current || (current.me.length < 3
                ? !sameGame(current, value?.state?.npcG) || out.res !== undefined || out.box.done
                : !!value?.state?.npcG || out.box.done !== 1)) {
                owned = null;
                stop('盲盒选择收据与完整服务器状态不一致，已暂停；请核对服务器状态');
                return;
            }
            if (current.me.length < 3) {
                owned = current;
                ownedBoxRev = value.rev;
                if (enabled) { phase = 'waiting'; status('本次盲盒选择已确认，继续完成本局'); schedulePump(500); }
                else phase = 'paused';
                return;
            }
        } else if ((completed.kind === 'end' && (!owned || !sameGame(completed.identity, owned))) || (completed.kind === 'play' && ignoredPractice ? !sameIgnoredPractice(value?.state?.npcG) : !!value?.state?.npcG)) {
            owned = null;
            ready = null;
            stop('结算后的对局归属异常，已暂停；请核对服务器状态');
            return;
        }
        owned = null;
        ready = null;
        if (!['win', 'draw', 'lose'].includes(out.res) || out.practice) { stop('服务器未确认正常奖励局结算，已暂停'); return; }
        lastSettlement = { game: completed.g, result: out.res, earn: Number.isFinite(out.earn) ? out.earn : 0, items: Array.isArray(out.got) ? clone(out.got) : [] };
        if (completed.g !== 'gomoku') {
            // 暂停后选择可能改变，仍从刚完成游戏在当前列表中的下一项继续。
            const index = games.filter(game => game !== 'gomoku').indexOf(completed.g);
            rotation = index < 0 ? 0 : index + 1;
        }
        const settledMessage = gameNames[completed.g] + ' · 后台本局已结算：' + ({ win: '获胜', draw: '平局', lose: '落败' })[out.res]
            + (lastSettlement.earn > 0 ? `，奖励 +${lastSettlement.earn} D币` : '');
        if (completed.g === 'gomoku' && out.res === 'win') {
            try {
                if (options.onGame) {
                    const result = options.onGame(clone(completed.game));
                    result?.catch?.(error => stop('本局已结算，但棋谱保存失败：' + error.message));
                } else getBook().addGame(completed.game);
            } catch (error) { stop('本局已结算，但棋谱保存失败：' + error.message); return; }
        }
        if (!enabled) { phase = 'paused'; return; }
        if (!next) { stop(settledMessage + '；已暂停'); return; }
        try {
            if (!quotaAvailable(value)) { stop(settledMessage + '；今日所选小游戏奖励额度已用完，已暂停'); return; }
        } catch (error) { stop('本局已结算，但下一局额度无法确认，已暂停：' + error.message); return; }
        phase = 'waiting';
        status(settledMessage + '；稍后继续下一局');
        schedulePump(1800);
    }

    function loadRules() {
        const expected = getBook().exportData().metadata?.rulesSha256;
        if (typeof expected !== 'string' || !/^[0-9a-f]{64}$/i.test(expected)) throw new Error('棋谱缺少规则 SHA256，不能用于后台结算');
        if (rules && verifiedHash === expected.toLowerCase()) return { rules, hash: verifiedHash };
        if (typeof options.createRules !== 'function') throw new Error('脚本缺少内置规则工厂，请安装完整的单文件脚本');
        const module = options.createRules();
        if (!module || module.snapshotSha256 !== expected.toLowerCase()) throw new Error('内置规则版本与棋谱不一致，请更新完整脚本');
        if (['gomokuAI', 'gomokuLine', 'gomokuReplay', 'refresh'].some(name => typeof module[name] !== 'function') || module.GOMOKU_N !== 15 || !Number.isSafeInteger(module.NPC?.daily) || module.NPC.daily < 1 || !Number.isSafeInteger(module.GOMOKU_PAID) || module.GOMOKU_PAID < 1) throw new Error('内置规则接口不受支持');
        // 规则固定随脚本发布；网站规则变化后必须更新脚本，不能混用其他版本的 AI。
        return { rules: module, hash: expected.toLowerCase() };
    }

    // 所有 AI 调用与搜索均在 Worker 内执行，不占用钓鱼、挖矿页面的主线程。
    function workerProgram() {
        self.onmessage = event => {
            const data = event.data;
            try {
                const R = createRules();
                if (R.snapshotSha256 !== data.rulesHash) throw new Error('计算线程载入了不同版本的内置规则');
                const book = createBook(data.book);
                const solver = createSolver();
                const board = Array(225).fill(0);
                const moves = [];
                const mv = [];
                let outcome = null;
                let bookHits = 0;
                let searchMoves = 0;
                for (let step = 0; step < 113; step++) {
                    let choice = book.lookup(board);
                    if (choice) bookHits++;
                    else { choice = solver.choose(board, { color: 1, timeMs: data.timeMs, maxDepth: 8 }); searchMoves++; }
                    const index = choice?.index;
                    if (!Number.isInteger(index) || index < 0 || index >= 225 || board[index]) throw new Error('后台计算返回非法黑棋落点');
                    const x = index % 15;
                    const y = Math.floor(index / 15);
                    board[index] = 1;
                    moves.push(index);
                    mv.push([x, y]);
                    if (R.gomokuLine(board, x, y, 1, 15) >= 5) { outcome = 'win'; break; }
                    if (board.every(Boolean)) { outcome = 'draw'; break; }
                    const before = board.join('');
                    const point = R.gomokuAI(board, data.owned.seed, step, 3, 15);
                    if (board.join('') !== before || !Array.isArray(point) || point.length !== 2) throw new Error('原站 AI 返回异常棋盘');
                    const [ax, ay] = point;
                    const reply = ay * 15 + ax;
                    if (!Number.isInteger(ax) || !Number.isInteger(ay) || ax < 0 || ax >= 15 || ay < 0 || ay >= 15 || board[reply]) throw new Error('原站 AI 返回非法白棋落点');
                    board[reply] = 2;
                    moves.push(reply);
                    if (R.gomokuLine(board, ax, ay, 2, 15) >= 5) { outcome = 'lose'; break; }
                    if (board.every(Boolean)) { outcome = 'draw'; break; }
                }
                if (outcome !== 'win' || R.gomokuReplay(data.owned.seed, mv, 3, 15) !== 'win') throw new Error('未能得到经原站复盘确认的完整胜局');
                self.postMessage({ id: data.id, mv, game: { seed: data.owned.seed, level: 3, result: 'win', moves }, bookHits, searchMoves });
            } catch (error) { self.postMessage({ id: data.id, error: error.message }); }
        };
    }

    function calculateGame() {
        if (!enabled || owned?.g !== 'gomoku' || workerJob || ready) return;
        const control = generation;
        const current = clone(owned);
        const Worker = env.Worker;
        if (typeof Worker !== 'function') { stop('浏览器不支持后台计算线程，已暂停；本局尚未结算'); return; }
        try {
            const URL = env.URL || globalThis.URL;
            const Blob = env.Blob || globalThis.Blob;
            const source = `const createBook = (${options.createBook.toString()}); const createSolver = (${options.createSolver.toString()}); const createRules = (${options.createRules.toString()}); (${workerProgram.toString()})();`;
            const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
            let worker;
            try { worker = new Worker(url); }
            finally { URL.revokeObjectURL(url); }
            const id = String(control) + ':' + current.seed + ':' + current.t;
            const timer = env.setTimeout(() => {
                if (workerJob?.id === id) stop('后台计算超时，已暂停；本局尚未结算');
            }, Math.max(15000, Math.min(120000, timeMs * 32 + 15000)));
            workerJob = { worker, timer, id };
            phase = 'computing';
            status('后台正在计算完整胜局，可继续浏览页面');
            worker.onerror = () => { if (workerJob?.id === id) stop('后台计算线程失败，已暂停；本局尚未结算'); };
            worker.onmessage = event => {
                if (!enabled || control !== generation || workerJob?.id !== id || event.data?.id !== id || !sameGame(current, owned)) return;
                const result = event.data;
                cancelWorker();
                if (result.error) { stop('后台计算失败，已暂停：' + result.error); return; }
                if (!Array.isArray(result.mv) || !result.mv.length || !result.game || result.game.result !== 'win' || result.game.seed !== current.seed) { stop('后台计算结果异常，已暂停'); return; }
                ready = { mv: clone(result.mv), game: clone(result.game), bookHits: result.bookHits, searchMoves: result.searchMoves };
                phase = 'ready';
                status('后台胜局已准备，正在提交结算');
                schedulePump();
            };
            worker.postMessage({ id, owned: current, rulesHash: verifiedHash, book: getBook().exportData(), timeMs });
        } catch (error) { stop('无法启动后台计算，已暂停：' + error.message); }
    }

    async function start(config) {
        if (disposed) return false;
        config = config || {};
        pause();
        const control = ++generation;
        // 奖励限制为固定规则，兼容旧调用时也不接受 rewardsOnly:false。
        next = config.next !== false;
        games = ['gomoku', ...['card', 'rps', 'box'].filter(game => Array.isArray(config.games) && config.games.includes(game))];
        rotation = 0;
        skipGomoku = false;
        ignoredPractice = null;
        if (Number.isFinite(config.timeMs)) timeMs = Math.max(0, config.timeMs);
        lastError = null;
        phase = 'loading';
        status('正在读取后台小游戏状态');
        try {
            if (!installed) { installed = true; transport.install(); }
            if (control !== generation) return false;
            if (transport.getPending?.()) throw new Error('有结果未知的后台请求，请先核对原生保存结果');
            const loaded = loadRules();
            if (control !== generation || disposed) return false;
            rules = loaded.rules;
            verifiedHash = loaded.hash;
            const value = await readInitialState(control);
            if (control !== generation || disposed) return false;
            if (!value?.state || !Number.isSafeInteger(value.rev) || value.rev < 0) throw new Error('小岛状态格式异常');
            snapshot = value;
            quotaCounts(value);
            if (!sceneAllowed()) throw new Error('当前正在串门，请离开串门场景后再开启后台小游戏');
            if (manualBoard()) throw new Error('请先关闭手动小游戏面板再开启后台模式');
            if (!verifyBoxState(value)) return false;
            skipExistingPractice(value);
            if (owned) {
                if (!sameGame(owned, value.state.npcG)) { owned = null; ready = null; throw new Error('原后台棋局已变化，不能自动接管其他棋局'); }
                if (owned.p) throw new Error('当前后台棋局为练习局，已暂停；请打开棋盘后手动点击开启自动');
            } else if (value.state.npcG && !sameIgnoredPractice(value.state.npcG)) {
                // 显式开启才授权接管；刷新恢复不会把未知原生对局当成本实例所有。
                if (config.adoptExisting !== true) throw new Error('已有未完成的 NPC 棋局；请手动点击开启自动以接管困难奖励五子棋');
                const current = identity(value.state.npcG);
                if (!current || current.g !== 'gomoku') throw new Error('已有其他或不受支持的 NPC 对局，请先手动处理');
                if (current.p) throw new Error('已有五子棋为练习局，请打开棋盘后手动点击开启自动');
                owned = current;
                ready = null;
                status('已接管现有困难奖励棋局');
            } else if (!quotaAvailable(value)) throw new Error('今日奖励局已用完，已暂停');
            ownershipInvalidated = false;
            sent = null;
            enabled = true;
            transport.setEnabled(true);
            if (owned && ready) { phase = 'ready'; status('后台胜局已准备，正在提交结算'); schedulePump(); }
            else if (owned?.g === 'gomoku') calculateGame();
            else { phase = 'waiting'; status(skipGomoku ? '已跳过五子棋练习局，正在准备所选其他小游戏奖励局' : '后台已开启，正在准备小游戏奖励局'); schedulePump(); }
            if (!observer && env.MutationObserver && env.document?.body) {
                observer = new env.MutationObserver(() => {
                    if (!enabled) return;
                    if (manualBoard()) manualNpc();
                    else if (!sceneAllowed()) stop('当前正在串门，后台已暂停');
                });
                observer.observe(env.document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
            }
            return true;
        } catch (error) {
            if (control === generation && !disposed) stop('后台启动失败，已暂停：' + error.message);
            return false;
        }
    }

    function dispose() {
        pause();
        disposed = true;
        phase = 'disposed';
        observer?.disconnect();
        observer = null;
        transport.dispose();
    }

    function getState() {
        return { enabled, phase, owned: owned ? clone(owned) : null, ready: !!ready, pending: transport.getPending?.() || null, rulesLoaded: !!rules, rewardsOnly, next, games: clone(games), skipGomoku, timeMs, lastError, lastSettlement: clone(lastSettlement) };
    }
    return { start, pause, dispose, getState };
},function createGomokuPreview(options) {
    'use strict';
    options = options || {};
    const env = options.window || globalThis;
    const document = env.document;
    const columns = 'ABCDEFGHJKLMNOP';
    const namespace = 'http://www.w3.org/2000/svg';
    const root = document.createElement('section');
    root.dataset.jinhuanGomokuPreview = '';
    root.setAttribute('aria-label', '五子棋预测');
    root.style.cssText = 'position:relative;box-sizing:border-box;max-width:100%;margin:10px auto 0;padding:10px 12px;border-top:1px solid #c9bba2;background:#fffaf0;color:#382e22;font:13px/1.6 system-ui;text-align:left';
    root.innerHTML = '<style>[data-jinhuan-gomoku-preview][hidden],[data-jinhuan-gomoku-preview] [hidden]{display:none!important}[data-jinhuan-gomoku-preview] [data-hint-row]{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 10px}[data-jinhuan-gomoku-preview] [data-hint-coordinate]{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;color:#713d1f}[data-jinhuan-gomoku-preview] [data-hint-source],[data-jinhuan-gomoku-preview] [data-hint-depth]{color:#685139;font-size:12px}[data-jinhuan-gomoku-preview] ::selection{background:#e6cba3;color:#382e22}</style><div data-hint-row role="status" aria-live="polite"><span data-hint-status>等待棋盘稳定</span><strong data-hint-coordinate></strong><span data-hint-source></span><span data-hint-depth></span></div>';
    const ui = selector => root.querySelector(selector);
    const text = (selector, value) => { const node = ui(selector); if (node.textContent !== value) node.textContent = value; };

    function overlay(attribute, zIndex) {
        const element = document.createElementNS(namespace, 'svg');
        element.setAttribute(attribute, '');
        element.setAttribute('viewBox', '0 0 15 15');
        element.setAttribute('preserveAspectRatio', 'none');
        element.setAttribute('focusable', 'false');
        element.style.cssText = `position:fixed;display:none;pointer-events:none;z-index:${zIndex};overflow:hidden`;
        return element;
    }
    const marker = overlay('data-jinhuan-gomoku-marker', 2147483645);
    marker.setAttribute('aria-hidden', 'true');
    const ring = document.createElementNS(namespace, 'circle');
    ring.setAttribute('r', '0.3');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', '#8a481a');
    ring.setAttribute('stroke-width', '0.085');
    ring.style.pointerEvents = 'none';
    const center = document.createElementNS(namespace, 'circle');
    center.setAttribute('r', '0.065');
    center.setAttribute('fill', '#8a481a');
    center.style.pointerEvents = 'none';
    marker.append(ring, center);
    const historyMarker = overlay('data-history-marker', 2147483644);
    historyMarker.setAttribute('role', 'img');
    const historyTitle = document.createElementNS(namespace, 'title');
    const historyDescription = document.createElementNS(namespace, 'desc');
    historyDescription.id = 'jinhuan-gomoku-history-' + (env.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
    historyMarker.setAttribute('aria-describedby', historyDescription.id);
    historyMarker.append(historyTitle, historyDescription);
    let canvas = null;
    let index = -1;
    let visible = false;
    let historyVisible = false;
    let historyCount = 0;
    let historyKey = '';
    const resizeObserver = env.ResizeObserver ? new env.ResizeObserver(updateBounds) : null;

    function coordinate(value) {
        if (!Number.isInteger(value) || value < 0 || value >= 225) return '';
        return columns[value % 15] + (15 - Math.floor(value / 15));
    }

    function updateBounds() {
        if (!visible || !canvas?.isConnected) { hideOverlays(); return; }
        const rect = canvas.getBoundingClientRect();
        // 只给可见的预测文字区对齐；仅显示手顺时不占用棋盘下方空间。
        if (!root.hidden) {
            root.style.width = Math.max(0, canvas.offsetWidth || rect.width) + 'px';
            const rootRect = root.getBoundingClientRect();
            const scale = root.offsetWidth && rootRect.width ? rootRect.width / root.offsetWidth : 1;
            const shift = (parseFloat(root.style.left) || 0) + (rect.left - rootRect.left) / scale;
            if (Math.abs((parseFloat(root.style.left) || 0) - shift) > 0.01) root.style.left = shift + 'px';
        }
        if (!rect.width || !rect.height) { hideOverlays(); return; }
        let left = Math.max(0, rect.left);
        let top = Math.max(0, rect.top);
        let right = Math.min(env.innerWidth || document.documentElement.clientWidth, rect.right);
        let bottom = Math.min(env.innerHeight || document.documentElement.clientHeight, rect.bottom);
        // 两个覆盖层共享原棋盘各滚动祖先的裁剪，不会漂到弹窗标题或别的区域上。
        for (let parent = canvas.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
            const style = env.getComputedStyle(parent);
            const clippedX = /auto|scroll|hidden|clip/.test(style.overflowX);
            const clippedY = /auto|scroll|hidden|clip/.test(style.overflowY);
            if (!clippedX && !clippedY) continue;
            const bounds = parent.getBoundingClientRect();
            if (clippedX) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
            if (clippedY) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
        }
        if (right <= left || bottom <= top) { hideOverlays(); return; }
        for (const layer of [marker, historyMarker]) {
            layer.style.left = rect.left + 'px';
            layer.style.top = rect.top + 'px';
            layer.style.width = rect.width + 'px';
            layer.style.height = rect.height + 'px';
            layer.style.clipPath = `inset(${Math.max(0, top - rect.top)}px ${Math.max(0, rect.right - right)}px ${Math.max(0, rect.bottom - bottom)}px ${Math.max(0, left - rect.left)}px)`;
        }
        if (index >= 0) {
            for (const shape of [ring, center]) {
                shape.setAttribute('cx', String(index % 15 + 0.5));
                shape.setAttribute('cy', String(Math.floor(index / 15) + 0.5));
            }
            marker.style.display = 'block';
        } else hideMarker();
        historyMarker.style.display = historyVisible && historyCount > 0 ? 'block' : 'none';
    }

    function hideMarker() {
        // 推荐计时只由推荐是否可见决定，与手顺编号层的显隐无关。
        options.onHidden?.();
        marker.style.display = 'none';
    }

    function hideOverlays() {
        hideMarker();
        historyMarker.style.display = 'none';
    }

    function attach(target) {
        if (canvas !== target) {
            if (canvas) resizeObserver?.unobserve(canvas);
            canvas = target;
            index = -1;
            historyKey = '';
            historyCount = 0;
            hideOverlays();
            if (canvas) resizeObserver?.observe(canvas);
        }
        if (!canvas?.isConnected) { hide(); return; }
        if (root.previousElementSibling !== canvas) canvas.after(root);
        if (!historyMarker.isConnected) document.body.append(historyMarker);
        if (!marker.isConnected) document.body.append(marker);
    }

    function renderHistory(model) {
        const offset = Number.isInteger(model.historyOffset) && model.historyOffset >= 0 && model.historyOffset <= 225 ? model.historyOffset : 0;
        const history = historyVisible && Array.isArray(model.history) ? model.history.slice(0, 225 - offset) : [];
        const complete = model.completeHistory === true && offset === 0;
        const key = `${historyVisible}:${offset}:${complete}:${history.join(',')}`;
        if (key === historyKey) return;
        historyKey = key;
        historyMarker.replaceChildren(historyTitle, historyDescription);
        const entries = history.map((value, turn) => ({ index: value, number: offset + turn + 1, color: (offset + turn) % 2 + 1 })).filter(entry => Number.isInteger(entry.index) && entry.index >= 0 && entry.index < 225);
        historyCount = entries.length;
        const note = complete ? `本局棋谱，已标注 ${historyCount} 手。` : `棋谱记录不完整，此前 ${offset} 手的落子顺序未知，仅标注此后可靠观察到的 ${historyCount} 手。`;
        historyTitle.textContent = note;
        historyMarker.setAttribute('aria-label', note);
        historyDescription.textContent = entries.map(entry => `第 ${entry.number} 手，${entry.color === 1 ? '黑棋' : '白棋'} ${coordinate(entry.index)}`).join('；');
        entries.forEach((entry, turn) => {
            const backdrop = document.createElementNS(namespace, 'circle');
            backdrop.setAttribute('data-history-backplate', '');
            backdrop.setAttribute('data-index', String(entry.index));
            backdrop.setAttribute('data-color', String(entry.color));
            backdrop.setAttribute('cx', String(entry.index % 15 + 0.5));
            backdrop.setAttribute('cy', String(Math.floor(entry.index / 15) + 0.5));
            backdrop.setAttribute('r', '0.24');
            backdrop.setAttribute('fill', entry.color === 1 ? '#222' : '#f8fbff');
            backdrop.style.pointerEvents = 'none';
            // 底片遮住原生末手红点，序号与红点不会叠印；不改动 Canvas。
            const number = document.createElementNS(namespace, 'text');
            const latest = turn === entries.length - 1;
            const fill = latest ? '#e23b30' : entry.color === 1 ? '#fffaf0' : '#28241d';
            number.setAttribute('data-history-number', '');
            number.setAttribute('data-index', String(entry.index));
            number.setAttribute('data-color', String(entry.color));
            number.setAttribute('data-move-number', String(entry.number));
            if (latest) number.setAttribute('data-history-latest', '');
            number.setAttribute('x', String(entry.index % 15 + 0.5));
            number.setAttribute('y', String(Math.floor(entry.index / 15) + 0.5));
            number.setAttribute('text-anchor', 'middle');
            number.setAttribute('dominant-baseline', 'central');
            number.setAttribute('font-family', 'system-ui, sans-serif');
            number.setAttribute('font-size', entry.number >= 100 ? '0.36' : entry.number >= 10 ? '0.47' : '0.56');
            number.setAttribute('font-weight', latest ? '600' : '500');
            number.setAttribute('fill', fill);
            number.style.fill = fill;
            number.style.pointerEvents = 'none';
            number.style.fontVariantNumeric = 'tabular-nums';
            number.textContent = String(entry.number);
            historyMarker.append(backdrop, number);
        });
    }

    function render(model) {
        if (!canvas?.isConnected) { hide(); return; }
        model = model || {};
        const showPrediction = model.showPrediction !== false;
        historyVisible = model.showHistory !== false;
        root.hidden = !showPrediction;
        ui('[data-hint-row]').hidden = !showPrediction;
        if (!showPrediction && !historyVisible) { hide(); return; }
        visible = true;
        const ready = showPrediction && model.status === 'ready' && Number.isInteger(model.recommendation?.index) && model.recommendation.index >= 0 && model.recommendation.index < 225;
        index = ready ? model.recommendation.index : -1;
        const names = { ready: '下一步推荐', thinking: '计算中…', white: '等待白棋应手', ended: '本局结束', waiting: '等待棋盘稳定', error: '预测暂不可用' };
        text('[data-hint-status]', model.error || names[model.status] || names.waiting);
        text('[data-hint-coordinate]', ready ? coordinate(index) : '');
        text('[data-hint-source]', ready ? model.recommendation.source || '' : '');
        text('[data-hint-depth]', ready && Number.isInteger(model.recommendation.depth) && model.recommendation.depth > 0 ? `搜索深度 ${model.recommendation.depth}` : '');
        renderHistory(model);
        updateBounds();
    }

    function hide() {
        visible = false;
        index = -1;
        root.hidden = true;
        hideOverlays();
    }

    function destroy() {
        hide();
        resizeObserver?.disconnect();
        env.removeEventListener('resize', updateBounds);
        env.removeEventListener('scroll', updateBounds, true);
        root.remove();
        marker.remove();
        historyMarker.remove();
        canvas = null;
    }
    env.addEventListener('resize', updateBounds);
    env.addEventListener('scroll', updateBounds, true);
    return { attach, render, hide, destroy, coordinate, updateBounds };
},function createGomokuRules() {
'use strict';
const NPC = {"daily":52,"jackpot":0.001,"jackpotCoins":1000000};
const GOMOKU_PAID = 10;
const GOMOKU_N = 15;
const ITEM_NAME = {"turnip":"小白萝卜","carrot":"胡萝卜","wheat":"小麦","strawberry":"草莓","tomato":"番茄","corn":"玉米","grape":"葡萄","pumpkin":"南瓜","cabbage":"冬白菜","egg":"鸡蛋","duckegg":"鸭蛋","milk":"牛奶","wool":"羊毛","truffle":"松露","sardine":"沙丁鱼","carp":"鲤鱼","bass":"鲈鱼","salmon":"三文鱼","squid":"鱿鱼","tuna":"金枪鱼","puffer":"河豚","whale":"迷你鲸","coal":"煤","copper":"铜矿","iron":"铁矿","amethyst":"紫水晶","gold":"金矿","emerald":"祖母绿","ruby":"红宝石","diamond":"钻石","feed":"饲料","bait":"鱼饵","salad":"田园沙拉","flour":"面粉","jam":"草莓果酱","ketchup":"番茄酱","popcorn":"爆米花","wine":"葡萄酒","pie":"南瓜派","kimchi":"泡菜","mayo":"蛋黄酱","cheese":"奶酪","sweater":"羊绒毛衣","ironbar":"铁锭","ingot":"金锭","jewel":"宝石项链","crown":"钻石王冠","bomb":"炸药","sd_turnip":"小白萝卜种子","sd_carrot":"胡萝卜种子","sd_wheat":"小麦种子","sd_strawberry":"草莓种子","sd_tomato":"番茄种子","sd_corn":"玉米种子","sd_grape":"葡萄种子","sd_pumpkin":"南瓜种子","sd_cabbage":"冬白菜种子","guard1":"潮铃","guard2":"贝壳护具","guard3":"珊瑚挡板","guard4":"萤火灯","cloak":"轻步斗篷","whistle":"风声口哨","sack":"折叠菜篮","tide_snack":"潮汐饭团"};
const worldDay = ((t) => new Date((t + 8 * 3600) * 1000).toISOString().slice(0, 10));
const WORLD = {"energyBase":100,"energyPerHouse":20,"regen":180};
const energyMax = ((s) => WORLD.energyBase + WORLD.energyPerHouse * s.tools.house);
function refresh(s, t) {
    const day = worldDay(t), max = energyMax(s);
    if (s.en >= max)
        s.enT = Math.max(s.enT, t);
    else {
        const n = Math.floor((t - s.enT) / WORLD.regen);
        if (n > 0) {
            s.en = Math.min(max, s.en + n);
            s.enT = s.en >= max ? t : s.enT + n * WORLD.regen;
        }
    }
    if (s.enDay !== day) {
        s.enDay = day;
        s.cnt = {};
    }
    if (s.earn.day !== day)
        s.earn = { day, amt: 0 };
    return s;
}
function rng32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gomokuCands(b, N, r = 2) {
    const cand = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if (b[y * N + x]) continue;
        let near = false;
        for (let dy = -r; dy <= r && !near; dy++) for (let dx = -r; dx <= r; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < N && Y < N && b[Y * N + X]) { near = true; break; } }
        if (near) cand.push([x, y]);
    }
    return cand;
}
const DIRS = [[1,0],[0,1],[1,1],[1,-1]];
function gomokuLine(b, x, y, who, N = GOMOKU_N) {
    let best = 0;
    for (const [dx, dy] of DIRS) { let n = 1; for (const sg of [1, -1]) { let k = 1; while (true) { const X = x + dx * k * sg, Y = y + dy * k * sg; if (X < 0 || Y < 0 || X >= N || Y >= N || b[Y * N + X] !== who) break; n++; k++; } } best = Math.max(best, n); }
    return best;
}
function gomokuStrength(b, N, x, y, who) {
    let total = 0, threats = 0;
    for (const [dx, dy] of DIRS) {
        let n = 1, open = 0;
        for (const sg of [-1, 1]) { let k = 1; while (true) { const X = x + dx * k * sg, Y = y + dy * k * sg; if (X < 0 || Y < 0 || X >= N || Y >= N) break; const v = b[Y * N + X]; if (v !== who) { if (!v) open++; break; } n++; k++; } }
        total += n >= 4 ? (open === 2 ? 50000 : open ? 10000 : 0) : n === 3 ? (open === 2 ? 3500 : open ? 250 : 0) : n === 2 ? (open === 2 ? 180 : open ? 30 : 0) : open * 3;
        if (n >= 3 && open === 2) threats++;
        for (let start = -4; start <= 0; start++) { let count = 0, valid = true; for (let k = start; k < start + 5; k++) { const X = x + dx * k, Y = y + dy * k; if (X < 0 || Y < 0 || X >= N || Y >= N) { valid = false; break; } const v = k === 0 ? who : b[Y * N + X]; if (v && v !== who) { valid = false; break; } if (v === who) count++; } if (valid) total += count === 4 ? 2500 : count === 3 ? 100 : count === 2 ? 8 : 0; }
    }
    return total + (threats >= 2 ? 12000 : 0);
}
function gomokuFives(b, N, who, at = -1) {
    // at>=0 时只检查经过该点的四条线（距离 4 格内），否则全盘扫描。
    const out = [], seen = new Set(), test = (i) => { if (b[i] || seen.has(i)) return; seen.add(i); const x = i % N, y = (i - x) / N; if (gomokuLine(b, x, y, who, N) >= 5) out.push(i); };
    if (at < 0) { for (let i = 0; i < N * N; i++) test(i); return out; }
    const ax = at % N, ay = (at - ax) / N;
    for (const [dx, dy] of DIRS) for (let k = -4; k <= 4; k++) { const x = ax + dx * k, y = ay + dy * k; if (k && x >= 0 && y >= 0 && x < N && y < N) test(y * N + x); }
    return out;
}
function gomokuVcfStep(b, N, who, depth, budget) {
    if (depth <= 0 || budget.n <= 0) return -1;
    const foe = 3 - who;
    for (const [x, y] of gomokuCands(b, N, 1)) {
        if (--budget.n <= 0) return -1;
        const i = y * N + x; b[i] = who;
        const f = gomokuFives(b, N, who, i);
        let ok = false;
        if (f.length >= 2) ok = true;
        else if (f.length === 1) { const j = f[0]; b[j] = foe; ok = !gomokuFives(b, N, foe, j).length && gomokuVcfStep(b, N, who, depth - 1, budget) >= 0; b[j] = 0; }
        b[i] = 0;
        if (ok) return i;
    }
    return -1;
}
function gomokuVcf(b, N, who, depth, budget) {
    if (gomokuFives(b, N, 3 - who).length) return -1;
    return gomokuVcfStep(b, N, who, depth, budget);
}
function gomokuAI(b, seed, step, d = 2, N = GOMOKU_N) {
    const r = rng32(seed * 31 + step * 7919), cand = gomokuCands(b, N), c = N >> 1;
    if (!cand.length) return [c, c];
    const win = cand.find(([x, y]) => gomokuLine(b, x, y, 2, N) >= 5); if (win) return win;
    const block = cand.find(([x, y]) => gomokuLine(b, x, y, 1, N) >= 5); if (block) return block;
    const rows = cand.map((p) => { const a = gomokuStrength(b, N, p[0], p[1], 2), o = gomokuStrength(b, N, p[0], p[1], 1); return { p, a, o, v: a + o * 1.1 - (Math.abs(p[0] - c) + Math.abs(p[1] - c)) * 0.2 }; });
    const pickBest = (list, key) => { let best = -Infinity, choices = []; for (const x of list) { const v = key(x); if (v > best) { best = v; choices = [x.p]; } else if (v === best) choices.push(x.p); } return choices[Math.floor(r() * choices.length)]; };
    if (d === 1) {
        // 简单：活四/冲四一定会堵（不送分），其余在前四名里按权重随机，常常漏掉活三。
        const urgent = rows.filter((x) => x.o >= 10000 || x.a >= 10000);
        if (urgent.length && r() < 0.9) return pickBest(urgent, (x) => x.v);
        const top = rows.slice().sort((x, y) => y.v - x.v || x.p[1] - y.p[1] || x.p[0] - y.p[0]).slice(0, 4), w = [0.4, 0.27, 0.19, 0.14];
        let roll = r() * w.slice(0, top.length).reduce((s, v) => s + v, 0);
        for (let i = 0; i < top.length; i++) { roll -= w[i]; if (roll <= 0) return top[i].p; }
        return top[0].p;
    }
    if (d !== 3) return pickBest(rows, (x) => x.v);
    // 困难：自己的活四直接走；否则取前 6 个候选，估算落子后对手最强的一手（全局威胁只算一次，
    // 候选周围两格内增量重算），选对手威胁最小、自身收益最大的。
    const four = rows.find((x) => x.a >= 50000); if (four) return four.p;
    const mine = gomokuVcf(b, N, 2, 6, { n: 500 }); if (mine >= 0) return [mine % N, (mine - mine % N) / N];
    if (gomokuVcf(b, N, 1, 6, { n: 350 }) >= 0) {
        // 对手有连续冲四：在高分候选里找一手能破解的（下完后对手不再有 VCF）。
        const fix = rows.slice().sort((x, y) => y.v - x.v || x.p[1] - y.p[1] || x.p[0] - y.p[0]).slice(0, 8).find((x) => { const i = x.p[1] * N + x.p[0]; b[i] = 2; const still = gomokuVcf(b, N, 1, 6, { n: 160 }) >= 0; b[i] = 0; return !still; });
        if (fix) return fix.p;
    }
    const top = rows.slice().sort((x, y) => y.v - x.v || x.p[1] - y.p[1] || x.p[0] - y.p[0]).slice(0, 6);
    const threat = new Map(rows.map((x) => [x.p[1] * N + x.p[0], x.o]));
    for (const x of top) {
        const [px, py] = x.p, i = py * N + px; b[i] = 2;
        let reply = 0;
        for (const [k, o] of threat) { if (k === i) continue; const qx = k % N, qy = (k - qx) / N; if (Math.abs(qx - px) > 2 || Math.abs(qy - py) > 2) { if (o > reply) reply = o; } }
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const qx = px + dx, qy = py + dy; if (qx < 0 || qy < 0 || qx >= N || qy >= N || b[qy * N + qx]) continue; const o = gomokuStrength(b, N, qx, qy, 1); if (o > reply) reply = o; }
        b[i] = 0; x.h = x.a * 1.15 + x.o - reply * 0.9;
    }
    return pickBest(top, (x) => x.h);
}
function gomokuReplay(seed, mv, d = 2, N = GOMOKU_N) {
    const b = new Array(N * N).fill(0);
    for (let k = 0; k < mv.length; k++) {
        const [x, y] = mv[k] || [];
        if (!(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < N && y < N) || b[y * N + x]) return 'bad';
        b[y * N + x] = 1;
        if (gomokuLine(b, x, y, 1, N) >= 5) return k === mv.length - 1 ? 'win' : 'bad';
        if (b.every(Boolean)) return k === mv.length - 1 ? 'draw' : 'bad';
        const [ax, ay] = gomokuAI(b, seed, k, d, N); b[ay * N + ax] = 2;
        if (gomokuLine(b, ax, ay, 2, N) >= 5) return k === mv.length - 1 ? 'lose' : 'bad';
        if (b.every(Boolean)) return k === mv.length - 1 ? 'draw' : 'bad';
    }
    return 'bad';
}
return Object.freeze({ NPC, GOMOKU_PAID, GOMOKU_N, ITEM_NAME, refresh, gomokuAI, gomokuLine, gomokuReplay, snapshotSha256: "14d6529325ef23830b8e007311e52f0ad69bbc6580987e9ad3b0e0e7d3ce064c", snapshotId: "pet-world-14d6529325ef2383" });
},function createGomokuRecords(options) {
    'use strict';
    options = options || {};
    const env = options.window || globalThis;
    const baseKey = options.storageKey || 'jinhuan.gomoku.records.v1';
    const models = new Map();
    const pendingRuns = new Map();
    const listeners = new Set();
    const instance = env.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
    const results = ['win', 'lose', 'draw'];
    const games = ['gomoku', 'card', 'rps', 'box'];
    let activeRun = null;
    let installed = false;
    let originalFetch = null;
    let warning = null;
    let runSequence = 0;
    const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const money = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    const timestamp = () => typeof options.now === 'function' ? options.now() : Date.now();
    const keyFor = account => baseKey + ':' + encodeURIComponent(account);

    function emit(event) {
        for (const listener of [options.onChange, ...listeners]) {
            try { listener?.(copy(event)); } catch { /* 界面失败不能影响游戏保存。 */ }
        }
    }

    function warn(code, message, account = null) {
        if (warning?.code === code && warning.message === message && warning.account === account) return;
        warning = { code, message, account };
        try { options.onWarning?.(message); } catch { /* 警告展示失败不影响原生操作。 */ }
        emit({ type: 'warning', message, account });
    }

    function clearWarning(codes, account) {
        if (!warning || !codes.includes(warning.code) || (warning.account !== null && warning.account !== account)) return;
        warning = null;
        try { options.onWarning?.(''); } catch { /* 恢复提示失败不影响游戏。 */ }
        emit({ type: 'warning', message: '', account });
    }

    function accountNow(quiet = false) {
        try {
            const value = options.getAccount?.();
            if ((typeof value !== 'string' && typeof value !== 'number') || !String(value).trim()) throw new Error('账号暂不可用');
            const account = String(value).trim();
            if (!quiet) clearWarning(['account'], account);
            return account;
        } catch {
            if (!quiet) warn('account', '暂未识别当前账号，请确认页面已登录。');
            return null;
        }
    }

    function modeNow() {
        try { return options.getMode?.() === 'background' ? 'background' : 'foreground'; }
        catch { return 'foreground'; }
    }

    function emptyData() { return { version: 1, records: [], seenIds: [], activeSummary: null, lastSummary: null }; }

    function validItems(items) {
        return Array.isArray(items) && items.every(item => object(item) && typeof item.id === 'string'
            && Number.isSafeInteger(item.q) && item.q >= 0 && Number.isSafeInteger(item.n) && item.n >= 0);
    }

    function validSummary(summary) {
        return summary === null || object(summary) && typeof summary.id === 'string' && Number.isFinite(summary.startedAt)
            && (summary.endedAt === null || Number.isFinite(summary.endedAt)) && money(summary.coins)
            && ['games', 'wins', 'losses', 'draws', 'unknownCoins'].every(key => Number.isSafeInteger(summary[key]) && summary[key] >= 0)
            && validItems(summary.items);
    }

    function readStored(account) {
        try {
            const storage = env.localStorage;
            if (!storage) throw new Error('本机存储不可用');
            const raw = storage.getItem(keyFor(account));
            if (!raw) return emptyData();
            const data = JSON.parse(raw);
            if (!object(data) || data.version !== 1 || !Array.isArray(data.records) || !Array.isArray(data.seenIds)
                || data.seenIds.some(id => typeof id !== 'string') || !validSummary(data.activeSummary) || !validSummary(data.lastSummary)
                || data.records.some(entry => !object(entry) || typeof entry.id !== 'string' || !Number.isFinite(entry.at)
                    || (entry.game !== undefined && !games.includes(entry.game))
                    || !results.includes(entry.result) || (entry.coins !== null && !money(entry.coins)) || !validItems(entry.items))) throw new Error('记录格式损坏');
            data.records = data.records.map(entry => ({ ...entry, game: entry.game || 'gomoku' }));
            return data;
        } catch {
            warn('read', '奖励记录读取失败，新记录仅在当前页面保留。', account);
            return null;
        }
    }

    function mergeRecords(first, second) {
        const rows = new Map();
        for (const entry of [...first, ...second]) if (!rows.has(entry.id)) rows.set(entry.id, copy(entry));
        return [...rows.values()].sort((a, b) => a.at - b.at).slice(-50);
    }

    function adoptStored(model, data) {
        model.records = mergeRecords(data.records, model.records);
        for (const id of data.seenIds) model.seen.add(id);
        for (const entry of model.records) model.seen.add(entry.id);
        for (const summary of [data.activeSummary, data.lastSummary]) {
            if (summary && !model.owned.has(summary.id)) model.runs.set(summary.id, copy(summary));
        }
        const local = model.runs.get(model.lastId);
        if (data.lastSummary && (!local || data.lastSummary.endedAt > local.endedAt)) model.lastId = data.lastSummary.id;
        model.previousId = data.activeSummary?.id || null;
    }

    function modelFor(account) {
        if (!models.has(account)) models.set(account, { records: [], seen: new Set(), runs: new Map(), owned: new Set(), lastId: null, previousId: null });
        const model = models.get(account);
        const data = readStored(account);
        if (data) adoptStored(model, data);
        return model;
    }

    function prune(account, model) {
        const keep = new Set([model.lastId, activeRun?.account === account ? activeRun.id : null]);
        for (const [id, entry] of pendingRuns) if (entry.account === account && entry.count > 0) keep.add(id);
        if (!model.lastId && activeRun?.account !== account) keep.add(model.previousId);
        for (const id of model.runs.keys()) if (!keep.has(id)) { model.runs.delete(id); model.owned.delete(id); }
    }

    function persist(account, model) {
        const stored = readStored(account);
        if (!stored) { prune(account, model); return false; }
        adoptStored(model, stored);
        const current = activeRun?.account === account ? model.runs.get(activeRun.id) : null;
        let activeSummary = current || stored.activeSummary;
        if (activeSummary && model.owned.has(activeSummary.id) && model.runs.get(activeSummary.id)?.active === false) activeSummary = null;
        const data = { version: 1, records: model.records, seenIds: [...model.seen].slice(-200),
            activeSummary: copy(activeSummary), lastSummary: copy(model.runs.get(model.lastId) || null) };
        try {
            env.localStorage.setItem(keyFor(account), JSON.stringify(data));
            clearWarning(['read', 'write'], account);
            prune(account, model);
            return true;
        } catch {
            warn('write', '奖励记录暂未保存，当前页面仍可查看。', account);
            prune(account, model);
            return false;
        }
    }

    function beginRun(config) {
        const account = accountNow();
        if (!account) return null;
        if (activeRun) finishRun('已开始新一轮');
        config = config || {};
        const model = modelFor(account);
        const id = instance + ':' + ++runSequence + ':' + timestamp();
        const summary = { id, startedAt: timestamp(), endedAt: null, reason: '', status: 'active', active: true,
            mode: config.mode === 'background' ? 'background' : config.mode === 'foreground' ? 'foreground' : modeNow(),
            games: 0, wins: 0, losses: 0, draws: 0, coins: 0, unknownCoins: 0, items: [] };
        model.runs.set(id, summary);
        model.owned.add(id);
        activeRun = { account, id };
        persist(account, model);
        emit({ type: 'begin', account, summary });
        return id;
    }

    function finishRun(reason = '本次运行已结束') {
        if (!activeRun) return null;
        const current = activeRun;
        const model = modelFor(current.account);
        const summary = model.runs.get(current.id);
        activeRun = null;
        if (!summary) return null;
        summary.endedAt = timestamp();
        summary.reason = String(reason);
        summary.active = false;
        summary.status = 'finished';
        model.lastId = summary.id;
        persist(current.account, model);
        emit({ type: 'finish', account: current.account, summary });
        return copy(summary);
    }

    function present(summary, account) {
        if (!summary) return null;
        const value = copy(summary);
        if (value.active && (activeRun?.account !== account || activeRun.id !== value.id)) {
            value.active = false;
            value.status = 'unconfirmed';
            value.reason = '此前运行未在当前页面接管，仅展示已确认奖励';
        }
        return value;
    }

    function getLastSummary() {
        const account = accountNow();
        if (!account) return null;
        const model = modelFor(account);
        return present(model.runs.get(model.lastId) || model.runs.get(model.previousId), account);
    }

    function getSummary(id) {
        const account = accountNow();
        if (!account) return null;
        const model = modelFor(account);
        const wanted = id || (activeRun?.account === account ? activeRun.id : model.lastId || model.previousId);
        return present(model.runs.get(wanted), account);
    }

    function getRecords() {
        const account = accountNow();
        if (!account) return [];
        return copy(modelFor(account).records).reverse();
    }

    function getRecentSummary() {
        const records = getRecords();
        if (!records.length) return null;
        const summary = { games: 0, wins: 0, losses: 0, draws: 0, coins: 0, unknownCoins: 0,
            items: [], firstAt: records[0].at, lastAt: records[0].at };
        const names = new Map();
        for (const entry of records) {
            addReward(summary, entry);
            summary.firstAt = Math.min(summary.firstAt, entry.at);
            summary.lastAt = Math.max(summary.lastAt, entry.at);
            // 同品质物品采用最近明细中可用的名称，不影响原有运行累计。
            for (const item of entry.items) {
                const key = JSON.stringify([item.id, item.q]);
                if (!names.has(key) && typeof item.name === 'string') names.set(key, item.name);
            }
        }
        for (const item of summary.items) {
            const key = JSON.stringify([item.id, item.q]);
            if (names.has(key)) item.name = names.get(key);
        }
        return summary;
    }

    function itemsFrom(out, practice) {
        if (practice || !Array.isArray(out.got)) return [];
        return out.got.filter(item => object(item) && typeof item.id === 'string' && item.id
            && Number.isSafeInteger(item.q) && item.q >= 0 && Number.isSafeInteger(item.n) && item.n > 0)
            .map(item => ({ id: item.id, q: item.q, n: item.n, ...(typeof item.name === 'string' ? { name: item.name } : {}) }));
    }

    function addReward(summary, entry) {
        summary.games++;
        summary[entry.result === 'win' ? 'wins' : entry.result === 'lose' ? 'losses' : 'draws']++;
        if (entry.coins === null) summary.unknownCoins++;
        else summary.coins += entry.coins;
        const items = new Map(summary.items.map(item => [JSON.stringify([item.id, item.q]), { ...item }]));
        for (const item of entry.items) {
            const key = JSON.stringify([item.id, item.q]);
            if (items.has(key)) items.get(key).n += item.n;
            else items.set(key, { ...item });
        }
        summary.items = [...items.values()];
    }

    function settlementAction(action) {
        if (action?.a !== 'npc' || !games.includes(action.g)) return false;
        if (action.g === 'gomoku') return action.k === 'end';
        if (action.g === 'box') return action.k === 'pick';
        if ((action.k || 'play') !== 'play') return false;
        return action.g === 'card' || [0, 1, 2].includes(action.m);
    }

    function recordSettlement(context) {
        context = context || {};
        if (context.responseOk !== true) return false;
        const request = context.request;
        const actionIndex = context.actionIndex;
        const action = request?.actions?.[actionIndex];
        const out = context.out;
        const operation = context.operation ?? request?.operation;
        if (typeof operation !== 'string' || !operation || !Number.isInteger(actionIndex) || actionIndex < 0
            || !settlementAction(action) || out?.ok !== true || !results.includes(out.res)
            || (out.a !== undefined && out.a !== 'npc') || (out.g !== undefined && out.g !== action.g)) return false;
        const account = context.account == null ? accountNow() : String(context.account).trim();
        if (!account) return false;
        const model = modelFor(account);
        const id = operation + ':' + actionIndex;
        if (model.seen.has(id)) return false;
        const runId = context.runId !== undefined ? context.runId : activeRun?.account === account ? activeRun.id : null;
        const summary = typeof runId === 'string' ? model.runs.get(runId) : null;
        const practice = out.practice === true;
        // 原站省略 earn 表示本局没有 D币奖励；显式畸形值才标记为未知。
        const hasEarn = Object.prototype.hasOwnProperty.call(out, 'earn');
        const entry = { id, operation, actionIndex, game: action.g, runId: summary?.id || null,
            at: Number.isFinite(context.at) ? context.at : timestamp(),
            mode: context.mode === 'background' || context.mode === 'foreground' ? context.mode : summary?.mode || modeNow(),
            result: out.res, practice, coins: practice || !hasEarn ? 0 : money(out.earn) ? out.earn : null,
            coinSource: practice ? 'practice' : !hasEarn ? 'omitted-zero' : money(out.earn) ? 'earn' : 'unknown', items: itemsFrom(out, practice) };
        if (Number.isSafeInteger(out.seed)) entry.seed = out.seed;
        if ([1, 2, 3].includes(out.d)) entry.level = out.d;
        model.records = mergeRecords(model.records, [entry]);
        model.seen.add(id);
        if (summary) addReward(summary, entry);
        persist(account, model);
        emit({ type: 'settlement', account, record: entry, summary: copy(summary) });
        return true;
    }

    function route(input, init) {
        try {
            const URL = typeof env.URL === 'function' ? env.URL : globalThis.URL;
            const location = env.location || { href: 'https://52dmeme.com/', origin: 'https://52dmeme.com' };
            const url = new URL(typeof input === 'string' ? input : input.url || input.href, location.href);
            const method = String(init?.method ?? input?.method ?? 'GET').toUpperCase();
            return url.origin === location.origin && !url.search && !url.hash && url.pathname === '/api/pet/world/act' && method === 'POST';
        } catch { return false; }
    }

    function wrappedFetch(input, init) {
        if (!installed) return originalFetch.call(env, input, init);
        const target = route(input, init);
        const account = target ? accountNow(true) : null;
        const context = account ? { account, runId: activeRun?.account === account ? activeRun.id : null, mode: modeNow() } : null;
        let requestClone = null;
        if (target && init?.body === undefined && typeof input?.clone === 'function') {
            try { requestClone = input.clone(); } catch { /* 克隆失败仍原样发送，不记录未知动作。 */ }
        }
        if (context?.runId) {
            const entry = pendingRuns.get(context.runId) || { account, count: 0 };
            entry.count++;
            pendingRuns.set(context.runId, entry);
        }
        // 原生请求在当前调用栈立刻发出，不等待读取正文、响应或记录存储。
        let pending;
        try { pending = originalFetch.call(env, input, init); }
        catch (error) { releaseRun(context); throw error; }
        if (!target || !context) {
            if (target) warn('account', '暂未识别当前账号，请确认页面已登录。');
            return pending;
        }
        clearWarning(['account'], account);
        let body;
        try { body = typeof init?.body === 'string' ? Promise.resolve(init.body) : requestClone ? requestClone.text() : Promise.resolve(null); }
        catch { body = Promise.resolve(null); }
        body = Promise.resolve(body).catch(() => null);
        return Promise.resolve(pending).then(async response => {
            try {
                if (response.ok) {
                    const [data, text] = await Promise.all([response.clone().json(), body]);
                    let request;
                    try { request = typeof text === 'string' ? JSON.parse(text) : null; } catch { request = null; }
                    if (Array.isArray(request?.actions) && typeof request.operation === 'string' && Array.isArray(data?.out) && request.actions.length === data.out.length) {
                        request.actions.forEach((action, actionIndex) => {
                            if (settlementAction(action)) recordSettlement({ ...context,
                                responseOk: true, request, actionIndex, out: data.out[actionIndex] });
                        });
                    }
                    clearWarning(['observer'], account);
                }
            } catch { warn('observer', '本局奖励未能读取，记录可能缺少这一局；游戏保存不受影响。', account); }
            return response;
        }).finally(() => releaseRun(context));
    }

    function releaseRun(context) {
        if (!context?.runId) return;
        const entry = pendingRuns.get(context.runId);
        if (entry && --entry.count <= 0) pendingRuns.delete(context.runId);
        const model = models.get(context.account);
        if (model) prune(context.account, model);
    }

    function reload() {
        const account = accountNow();
        if (!account) return false;
        const saved = persist(account, modelFor(account));
        emit({ type: 'reload', account });
        return saved;
    }

    function storageChanged(event) {
        if (typeof event.key !== 'string' || !event.key.startsWith(baseKey + ':')) return;
        try {
            const account = decodeURIComponent(event.key.slice(baseKey.length + 1));
            if (!models.has(account)) return;
            modelFor(account);
            emit({ type: 'reload', account });
        } catch { /* 不接受损坏的其他账号存储事件。 */ }
    }

    function install() {
        if (installed) return api;
        if (typeof env.fetch !== 'function') { warn('observer', '浏览器 fetch 不可用，奖励观察未启用'); return api; }
        originalFetch = env.fetch;
        env.fetch = wrappedFetch;
        env.addEventListener?.('storage', storageChanged);
        installed = true;
        return api;
    }

    function dispose() {
        if (installed && env.fetch === wrappedFetch) env.fetch = originalFetch;
        env.removeEventListener?.('storage', storageChanged);
        installed = false;
    }

    const api = { install, dispose, beginRun, finishRun, getSummary, getLastSummary, getRecords, getRecentSummary, recordSettlement, reload,
        subscribe(listener) { if (typeof listener !== 'function') return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
        getWarnings() { return warning ? [warning.message] : []; }
    };
    return api;
},"0.5.9");
