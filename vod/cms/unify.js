// 开心TV · 精选采集站统一分类（v2.3.6，云端订阅用）
// 在电视/盒子上运行（TVBox 的 JS 爬虫接口，和 drpy2.min.js 同一种加载方式），不依赖家里的电脑。
// 分类表由电脑每天统计好，放在订阅配置的 ext 里：
//   {"api": 采集站接口, "class": [{type_id, type_name}], "filters": {...}, "members": {大类: [[小类id, 数量], ...]}}
// 点大类 = 把它下面各小类的同一页并起来按更新时间排；小类在“筛选 → 类型”里；搜索/详情原样取。
const UA = 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';
const BAD = /伦理|倫理|福利|成人|写真|里番|情色|三级|18禁|激情|爽片|两性|擦边|预告|资讯|解说/;
const MAX_SEQ = 4;      // 没有并发接口时，大类每页最多取 4 个小类（按片量从多到少）
const MAX_BATCH = 12;   // 有并发接口（batchFetch）时最多 12 个
let S = { api: '', class: [], filters: {}, members: {} };

function url(params) {
  const qs = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
  return S.api + (S.api.indexOf('?') >= 0 ? '&' : '?') + qs;
}

function opts() {
  return { method: 'get', headers: { 'User-Agent': UA }, timeout: 10000 };
}

function parse(txt) {
  try { return JSON.parse(txt || '{}') || {}; } catch (e) { return {}; }
}

function get(u) {
  try {
    const r = req(u, opts());
    return parse(r && (r.content !== undefined ? r.content : r));
  } catch (e) {
    return {};
  }
}

function getMany(urls) {
  if (urls.length > 1 && typeof batchFetch === 'function') {
    try {
      const res = batchFetch(urls.map(u => ({ url: u, options: opts() })));
      if (res && res.length === urls.length) return res.map(x => parse(x && x.content !== undefined ? x.content : x));
    } catch (e) { /* 退回逐个取 */ }
  }
  return urls.map(get);
}

function clean(list) {
  return (list || []).filter(v => !BAD.test(String(v.type_name || '')));
}

function init(ext) {
  let e = ext;
  if (typeof e === 'string') {
    e = e.trim();
    if (e.indexOf('http') === 0) {
      e = get(e);
    } else {
      e = parse(e);
    }
  }
  S = Object.assign({ api: '', class: [], filters: {}, members: {} }, e || {});
}

function home(filter) {
  return JSON.stringify({ class: S.class, filters: S.filters });
}

function homeVod() {
  return JSON.stringify({ list: clean(get(url({ ac: 'videolist', pg: 1 })).list).slice(0, 30) });
}

function category(tid, pg, filter, extend) {
  pg = parseInt(pg || 1) || 1;
  let ext = extend || {};
  if (typeof ext === 'string') ext = parse(ext);
  const members = S.members[tid] || [];
  let ids;
  const sub = ext.cateId ? String(ext.cateId) : '';
  if (!members.length) {
    ids = [String(tid)];                       // 不是大类：当原始小类取
  } else if (sub && members.some(m => String(m[0]) === sub)) {
    ids = [sub];
  } else {
    const sorted = members.slice().sort((a, b) => (b[1] || 0) - (a[1] || 0));
    const cap = typeof batchFetch === 'function' ? MAX_BATCH : MAX_SEQ;
    ids = sorted.slice(0, cap).map(m => String(m[0]));
  }
  const parts = getMany(ids.map(t => url({ ac: 'videolist', t: t, pg: pg })));
  const seen = {};
  let items = [];
  parts.forEach(d => clean(d.list).forEach(v => {
    const k = String(v.vod_id);
    if (!seen[k]) { seen[k] = 1; items.push(v); }
  }));
  items.sort((a, b) => String(b.vod_time || '').localeCompare(String(a.vod_time || '')));
  let pc = 1, total = 0;
  parts.forEach(d => { pc = Math.max(pc, parseInt(d.pagecount || 0) || 0); total += parseInt(d.total || 0) || 0; });
  return JSON.stringify({ page: pg, pagecount: pc, limit: items.length, total: total, list: items });
}

// 播放源只留直链 m3u8（网页分享页要解析、容易带广告）；一个都没有才全留
function m3u8Only(v) {
  const from = String(v.vod_play_from || '').split('$$$');
  const urls = String(v.vod_play_url || '').split('$$$');
  const keep = [];
  for (let i = 0; i < urls.length; i++) {
    if (/\.m3u8/i.test(urls[i])) keep.push(i);
  }
  if (keep.length && keep.length < urls.length) {
    v.vod_play_from = keep.map(i => from[i] || ('线路' + (i + 1))).join('$$$');
    v.vod_play_url = keep.map(i => urls[i]).join('$$$');
  }
  return v;
}

function detail(id) {
  const ids = Array.isArray(id) ? id.join(',') : String(id);
  return JSON.stringify({ list: (get(url({ ac: 'detail', ids: ids })).list || []).map(m3u8Only) });
}

function play(flag, id, flags) {
  if (/\.(m3u8|mp4|flv|mkv)(\?|$)/i.test(id)) return JSON.stringify({ parse: 0, url: id });
  return JSON.stringify({ parse: 1, jx: 1, url: id });
}

function search(wd, quick, pg) {
  const d = get(url({ ac: 'videolist', wd: wd, pg: pg || 1 }));
  return JSON.stringify({ page: parseInt(pg || 1) || 1, pagecount: d.pagecount || 1, list: clean(d.list) });
}

export default { init: init, home: home, homeVod: homeVod, category: category, detail: detail, play: play, search: search };
