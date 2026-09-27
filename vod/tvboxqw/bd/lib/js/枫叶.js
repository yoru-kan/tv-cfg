// ==UserScript==
// @name         枫叶影院 App 播放（融合剧集链接）
// @namespace    https://www.runjiaxcl.com/
// @version      1.0.2
// @description  详情页点击剧集链接直接调用 App 播放，不再额外添加按钮
// @author       AI Assistant
// @match        *://www.runjiaxcl.com/*
// @run-at       document-end
// @grant        GM_addStyle
// @grant        GM_log
// ==/UserScript==

(function() {
    'use strict';

    if (window.top !== window) return;

    // ---------- 等待 fm SDK ----------
    function waitForFmSDK(callback) {
        if (typeof fm !== 'undefined' && fm.play) {
            callback();
            return;
        }
        window.addEventListener('fmsdk', function() {
            callback();
        }, { once: true });
        let attempts = 0;
        const check = setInterval(function() {
            attempts++;
            if (typeof fm !== 'undefined' && fm.play) {
                clearInterval(check);
                callback();
            } else if (attempts > 50) {
                clearInterval(check);
                console.warn('[枫叶影院] fm SDK 加载超时');
            }
        }, 100);
    }

    // ---------- 样式 ----------
    GM_addStyle(`
        /* 剧集链接上的手机图标样式 */
        .app-play-indicator {
            font-size: 14px;
            margin-left: 4px;
            opacity: 0.8;
        }
        /* 剧集链接 hover 效果 */
        .app-play-link:hover .app-play-indicator {
            opacity: 1;
        }

        /* 通用播放按钮（无播放列表时使用） */
        .app-play-detail-btn {
            display: inline-block;
            padding: 8px 24px;
            margin: 6px 4px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #fff !important;
            border: none;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
            line-height: 32px;
            vertical-align: middle;
            text-decoration: none !important;
        }
        .app-play-detail-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
        }

        /* Toast 提示 */
        .app-play-toast {
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.75);
            color: #fff;
            padding: 10px 24px;
            border-radius: 20px;
            font-size: 14px;
            z-index: 99999;
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            animation: toastFadeIn 0.3s ease;
            pointer-events: none;
        }
        @keyframes toastFadeIn {
            from { opacity: 0; transform: translateX(-50%) translateY(20px); }
            to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
    `);

    function showToast(msg) {
        const existing = document.querySelector('.app-play-toast');
        if (existing) existing.remove();
        const div = document.createElement('div');
        div.className = 'app-play-toast';
        div.textContent = msg;
        document.body.appendChild(div);
        setTimeout(() => { div.style.opacity = '0'; div.style.transition = 'opacity 0.5s'; }, 2000);
        setTimeout(() => { div.remove(); }, 3000);
    }

    function getPageType() {
        const path = window.location.pathname;
        if (path === '/' || path === '/index.html') return 'home';
        if (path.startsWith('/detail/')) return 'detail';
        if (path.startsWith('/play/')) return 'play';
        return 'other';
    }

    // ---------- 核心播放调用 ----------
    function handlePlayRequest(url, title) {
        waitForFmSDK(function() {
            try {
                const fullUrl = url.startsWith('http') ? url : new URL(url, window.location.origin).href;
                GM_log('[枫叶影院] 请求播放:', fullUrl, title);
                if (typeof fm !== 'undefined' && fm.play) {
                    fm.play(fullUrl, {
                        title: title || '枫叶影院',
                        from: 'runjiaxcl',
                        source: window.location.href
                    });
                    showToast('🎬 已推送到 App 播放');
                } else if (typeof fm !== 'undefined' && fm.pan && fm.pan.play) {
                    fm.pan.play(fullUrl);
                    showToast('📦 已推送到网盘播放');
                } else {
                    showToast('⚠️ 播放器未就绪，请重试');
                    console.error('[枫叶影院] fm SDK 不可用');
                }
            } catch (e) {
                console.error('[枫叶影院] 播放出错:', e);
                showToast('❌ 播放失败: ' + e.message);
            }
        });
    }

    // ---------- 详情页增强：劫持剧集链接 ----------
    function enhanceDetailPage() {
        // 查找播放列表容器
        const playListContainer = document.querySelector('.play-list, .playlist, .player-list, [class*="play-list"], [class*="playlist"]');
        if (!playListContainer) {
            // 没有播放列表，尝试添加通用按钮
            addGlobalPlayButton();
            return;
        }

        // 获取所有剧集链接
        const playLinks = playListContainer.querySelectorAll('a[href^="/play/"], a[href*="/play/"]');
        if (!playLinks.length) {
            addGlobalPlayButton();
            return;
        }

        playLinks.forEach(function(link) {
            // 避免重复绑定
            if (link.dataset.appPlayHandled) return;
            link.dataset.appPlayHandled = 'true';

            // 保存原始 href
            const originalHref = link.getAttribute('href');
            const episodeText = link.textContent.trim() || '';

            // 添加视觉提示：在文本后加 📱
            if (!link.querySelector('.app-play-indicator')) {
                const indicator = document.createElement('span');
                indicator.className = 'app-play-indicator';
                indicator.textContent = ' 📱';
                link.appendChild(indicator);
                // 给链接添加一个类以便样式
                link.classList.add('app-play-link');
            }

            // 劫持点击事件
            link.addEventListener('click', function(e) {
                // 如果按住 Ctrl/Cmd，则允许正常跳转
                if (e.ctrlKey || e.metaKey || e.shiftKey) {
                    return; // 让浏览器默认处理
                }
                e.preventDefault();
                e.stopPropagation();

                const fullUrl = new URL(originalHref, window.location.origin).href;
                const title = document.title || '';
                handlePlayRequest(fullUrl, title);
            });
        });
    }

    // ---------- 当没有播放列表时，添加通用按钮 ----------
    function addGlobalPlayButton() {
        const titleEl = document.querySelector('.vod-title, .detail-title, h1, .page-title');
        if (!titleEl) return;
        if (titleEl.parentElement.querySelector('.app-play-detail-btn')) return;

        const btn = document.createElement('button');
        btn.className = 'app-play-detail-btn';
        btn.textContent = '📱 App 播放全部';
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            extractVideoSourceFromPage();
        });
        titleEl.parentElement.insertBefore(btn, titleEl.nextSibling);
    }

    // ---------- 从页面提取视频源（用于通用按钮） ----------
    function extractVideoSourceFromPage() {
        const video = document.querySelector('video');
        if (video && video.src) {
            handlePlayRequest(video.src, document.title);
            return;
        }
        const iframe = document.querySelector('iframe[src*="m3u8"], iframe[src*=".mp4"], iframe[src*="play"');
        if (iframe && iframe.src) {
            handlePlayRequest(iframe.src, document.title);
            return;
        }
        const pageText = document.body.innerText;
        const m3u8Match = pageText.match(/(https?:\/\/[^\s]+\.m3u8[^\s]*)/);
        if (m3u8Match) {
            handlePlayRequest(m3u8Match[1], document.title);
            return;
        }
        showToast('🔍 未找到可播放的源，请手动选择集数');
    }

    // ---------- 播放页自动拦截 ----------
    function interceptPlayPage() {
        const video = document.querySelector('video');
        if (video && video.src) {
            setTimeout(function() {
                const src = video.src;
                if (src && src.startsWith('http')) {
                    handlePlayRequest(src, document.title);
                    showToast('🎬 已捕获视频流，推送到 App');
                }
            }, 1500);
            return;
        }
        const iframe = document.querySelector('iframe');
        if (iframe && iframe.src) {
            handlePlayRequest(iframe.src, document.title);
            showToast('📺 已捕获播放源');
        }
    }

    // ---------- 监听动态加载（详情页） ----------
    function observeDetailPage() {
        const observer = new MutationObserver(function(mutations) {
            if (getPageType() !== 'detail') return;
            // 检查是否有新的播放列表加入
            let shouldUpdate = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.querySelector && (node.querySelector('.play-list') || node.querySelector('.playlist'))) {
                                shouldUpdate = true;
                                break;
                            }
                            if (node.classList && (node.classList.contains('play-list') || node.classList.contains('playlist'))) {
                                shouldUpdate = true;
                                break;
                            }
                        }
                    }
                }
                if (shouldUpdate) break;
            }
            if (shouldUpdate) {
                clearTimeout(window._extUpdateTimer);
                window._extUpdateTimer = setTimeout(function() {
                    enhanceDetailPage();
                }, 300);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        return observer;
    }

    // ---------- 主入口 ----------
    function main() {
        const pageType = getPageType();
        GM_log('[枫叶影院] 页面类型:', pageType);

        if (pageType === 'detail') {
            enhanceDetailPage();
            observeDetailPage();
        } else if (pageType === 'play') {
            interceptPlayPage();
        }
        // 其他页面（首页、分类）不做任何处理
    }

    if (document.readyState === 'complete') {
        main();
    } else {
        window.addEventListener('load', main, { once: true });
    }

    // fm SDK 就绪后重新增强（确保可调用）
    window.addEventListener('fmsdk', function() {
        GM_log('[枫叶影院] fm SDK 已就绪');
        if (getPageType() === 'detail') {
            enhanceDetailPage();
        }
    }, { once: true });
})();