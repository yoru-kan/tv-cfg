// 开心TV · 精选采集站统一分类 + 多源聚合（v2.3.7）
// 在电视/盒子上运行（TVBox 的 JS 爬虫接口，和 drpy2.min.js 同一种加载方式），不依赖家里的电脑。
// 分类表由电脑每天统计好，放在订阅配置的 ext 里：
//   {"api": 采集站接口, "class": [{type_id, type_name}], "filters": {...}, "members": {大类: [[小类id, 数量], ...]}}
// 点大类 = 把它下面各小类的同一页并起来按更新时间排；小类在“筛选 → 类型”里；搜索/详情原样取。
const UA = 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';
const BAD = /伦理|倫理|福利|成人|写真|里番|情色|三级|18禁|激情|爽片|两性|擦边|预告|资讯|解说/;
const MAX_SEQ = 4;      // 没有并发接口时，大类每页最多取 4 个小类（按片量从多到少）
const MAX_BATCH = 12;   // 有并发接口（batchFetch）时最多 12 个
let S = { api: '', class: [], filters: {}, members: {}, sources: [] };

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
  S = Object.assign({ api: '', class: [], filters: {}, members: {}, sources: [] }, e || {});
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
  if (S.sources && S.sources.length) {
    const first = ids.split(',')[0];
    if (first.indexOf('q@') === 0) {
      const p = first.split('@');
      return JSON.stringify({ list: [aggDetail(p.slice(1, -1).join('@'), parseInt(p[p.length - 1]) || 0, null)] });
    }
    const raw = first.indexOf('p@') === 0 ? first.slice(2) : first;
    const v = (get(url({ ac: 'detail', ids: raw })).list || [])[0];
    if (!v) return JSON.stringify({ list: [] });
    return JSON.stringify({ list: [aggDetail(v.vod_name, yearOf(v), { src: S.sources[0], v: v })] });
  }
  return JSON.stringify({ list: (get(url({ ac: 'detail', ids: ids })).list || []).map(m3u8Only) });
}

function play(flag, id, flags) {
  if (/\.(m3u8|mp4|flv|mkv)(\?|$)/i.test(id)) return JSON.stringify({ parse: 0, url: id });
  return JSON.stringify({ parse: 1, jx: 1, url: id });
}

function search(wd, quick, pg) {
  if (S.sources && S.sources.length) {
    if (parseInt(pg || 1) > 1) return JSON.stringify({ page: 2, pagecount: 1, list: [] });
    return JSON.stringify({ page: 1, pagecount: 1, list: aggSearch(String(wd || '').trim()) });
  }
  const d = get(url({ ac: 'videolist', wd: wd, pg: pg || 1 }));
  return JSON.stringify({ page: parseInt(pg || 1) || 1, pagecount: d.pagecount || 1, list: clean(d.list) });
}


// ---------------- 聚合（多源合一）----------------
// ext 里有 sources 时：分类按主站浏览；搜索同时查所有站，同一部剧合成一条；
// 详情页把各站的播放源都列出来（按集数从多到少，标“站名·N集”），在播放源里一点就切换。
const T2S = '濛蒙裏里裡里於于後后麼么劍剑傳传愛爱戀恋夢梦龍龙鳳凤華华國国當当門门開开關关時时間间東东車车馬马島岛飛飞風风雲云電电視视劇剧聲声無无燈灯殺杀戰战爭争義义俠侠樂乐歡欢喬乔紅红綠绿藍蓝黃黄長长張张陳陈劉刘楊杨趙赵鄭郑謝谢羅罗許许韓韩鍾钟錢钱萬万億亿個个們们來来說说話话語语讀读書书學学師师親亲媽妈爺爷孫孙兒儿婦妇歲岁歷历曆历陽阳陰阴靈灵衛卫軍军隊队將将帥帅雙双對对達达過过還还這这進进遠远連连運运邊边選选遺遗醫医藥药療疗臉脸腦脑體体頭头髮发發发氣气熱热難难險险驚惊憶忆懷怀戲戏夠够貓猫豬猪魚鱼鳥鸟雞鸡鴨鸭蟲虫龜龟貝贝買买賣卖貴贵賊贼財财質质紀纪級级線线經经結结給给絕绝絲丝網网緣缘總总織织聽听聖圣職职滅灭灣湾漢汉滿满溫温淚泪濤涛淺浅潛潜灑洒瀟潇態态慶庆應应廣广廳厅莊庄葉叶蘇苏藝艺蕭萧薩萨蘭兰處处號号虛虚衝冲襲袭見见規规覺觉觀观計计記记設设試试詩诗誰谁調调請请論论諜谍謎谜變变讓让賽赛趕赶蹤踪輕轻轉转輪轮辦办農农鄉乡醜丑釋释針针鐵铁銀银錦锦鏡镜閃闪閣阁闖闯隱隐雜杂離离雖虽靜静韻韵頂顶順顺領领頻频顏颜題题願愿類类顯显飯饭館馆驗验驅驱騎骑鬥斗鬧闹麗丽齊齐齡龄黨党墻墙牆墙壞坏壓压奪夺奮奋寧宁實实寫写寶宝尋寻導导屬属嶺岭帶带幫帮幹干廢废彈弹彎弯從从復复恆恒惡恶悶闷慣惯憐怜擊击擁拥據据擔担敗败敵敌數数斷断曉晓會会條条棄弃楓枫業业極极樓楼標标樣样橋桥機机權权歸归殘残決决沒没漁渔濕湿灘滩爐炉爾尔獨独獵猎獸兽環环現现瑪玛產产畫画異异瘋疯盡尽監监盤盘禮礼穩稳窮穷競竞筆笔節节範范簡简紋纹純纯紙纸細细終终組组統统續续習习聞闻聯联腳脚興兴艦舰螢萤眾众衆众裝装認认誤误謊谎證证識识護护豐丰負负貨货資资賴赖贏赢跡迹蹟迹軟软輝辉辭辞遊游遙遥鄰邻錄录錯错鎖锁陣阵陸陆隨随霧雾靂雳響响頁页飄飘餘余驕骄髒脏魯鲁鮮鲜鳴鸣麥麦點点龐庞嘆叹鬱郁臺台颱台樹树團团圓圆萊莱們们麵面鐘钟';
const TMAP = {};
for (let i = 0; i < T2S.length; i += 2) TMAP[T2S[i]] = T2S[i + 1];

function norm(name) {
  let s = String(name || '').toLowerCase().replace(/[\s·・:：,，.。!！?？'"“”‘’()（）\[\]【】《》<>\-—_~～、&]/g, '');
  let o = '';
  for (const ch of s) o += TMAP[ch] || ch;
  return o.replace(/第[一1]季$/, '').replace(/(19|20)\d\d版$/, '');   // “庆余年第一季”=“庆余年”，“天龙八部2003版”=“天龙八部”（再靠年份区分）
}

function yearOf(v) {
  const y = parseInt(v.vod_year || 0) || 0;
  return y > 1900 ? y : 0;
}

function sameYear(a, b) {
  return !a || !b || Math.abs(a - b) <= 1;
}

function searchUrls(wd) {
  return S.sources.filter(x => x.search).map(x => ({ src: x, u: x.api + (x.api.indexOf('?') >= 0 ? '&' : '?') + 'ac=videolist&wd=' + encodeURIComponent(wd) }));
}

// 各站按名字搜；某站一条都没搜到就用前半截名字再搜一次（解决 蒙/濛 这类异体字、繁体）
function searchAll(wd) {
  const key = norm(wd);
  const jobs = searchUrls(wd);
  const res = getMany(jobs.map(j => j.u));
  const out = [];
  const retry = [];
  jobs.forEach((j, i) => {
    const hit = clean(res[i].list).filter(v => norm(v.vod_name).indexOf(key) >= 0);
    if (hit.length) hit.forEach(v => out.push({ src: j.src, v: v }));
    else if (wd.length >= 3) retry.push(j.src);
  });
  if (retry.length) {
    const short = wd.slice(0, Math.max(2, Math.ceil(wd.length / 2)));
    const u2 = retry.map(x => x.api + (x.api.indexOf('?') >= 0 ? '&' : '?') + 'ac=videolist&wd=' + encodeURIComponent(short));
    getMany(u2).forEach((d, i) => clean(d.list).filter(v => norm(v.vod_name).indexOf(key) >= 0).forEach(v => out.push({ src: retry[i], v: v })));
  }
  return out;
}

function eps(u) {
  return String(u || '').split('#').filter(x => x).length;
}

function aggDetail(name, year, base) {
  const key = norm(name);
  const hits = searchAll(name).filter(h => norm(h.v.vod_name) === key && sameYear(year, yearOf(h.v)));
  if (base) hits.unshift({ src: base.src, v: base.v });
  const lines = [];
  const seen = {};
  hits.forEach(h => {
    const v = m3u8Only(Object.assign({}, h.v));
    const froms = String(v.vod_play_from || '').split('$$$');
    const urls = String(v.vod_play_url || '').split('$$$');
    urls.forEach((u, i) => {
      if (!u || seen[u]) return;
      seen[u] = 1;
      lines.push({ src: h.src, n: eps(u), u: u, order: S.sources.indexOf(h.src) * 10 + i });
    });
  });
  lines.sort((a, b) => (b.n - a.n) || (a.order - b.order));
  const cnt = {};
  lines.forEach(l => { cnt[l.src.name] = (cnt[l.src.name] || 0) + 1; });
  const idx = {};
  const from = lines.map(l => {
    idx[l.src.name] = (idx[l.src.name] || 0) + 1;
    return l.src.name + (cnt[l.src.name] > 1 ? idx[l.src.name] : '') + '·' + l.n + '集';
  });
  const info = Object.assign({}, (base || hits[0] || { v: {} }).v);
  info.vod_id = 'q@' + name + '@' + (year || '');
  info.vod_play_from = from.join('$$$');
  info.vod_play_url = lines.map(l => l.u).join('$$$');
  info.vod_remarks = (info.vod_remarks || '') + ' · ' + Object.keys(cnt).length + '个站';
  return info;
}

function aggSearch(wd) {
  const groups = {};
  const order = [];
  searchAll(wd).forEach(h => {
    const k = norm(h.v.vod_name);
    const y = yearOf(h.v);
    let g = null;
    for (const gk of order) {
      const x = groups[gk];
      if (x.k === k && sameYear(x.y, y)) { g = x; break; }
    }
    if (!g) {
      const gk = k + '|' + y + '|' + order.length;
      g = groups[gk] = { k: k, y: y, v: h.v, srcs: {} };
      order.push(gk);
    }
    if (!g.y && y) g.y = y;
    g.srcs[h.src.name] = 1;
  });
  const key = norm(wd);
  const list = order.map(gk => groups[gk]).sort((a, b) => ((b.k === key) - (a.k === key)) || (Object.keys(b.srcs).length - Object.keys(a.srcs).length))
    .map(g => ({ vod_id: 'q@' + g.v.vod_name + '@' + (g.y || ''), vod_name: g.v.vod_name, vod_pic: g.v.vod_pic, vod_year: g.y || '',
                 vod_remarks: Object.keys(g.srcs).length + '个站 · ' + (g.v.vod_remarks || '') }));
  return list;
}

export default { init: init, home: home, homeVod: homeVod, category: category, detail: detail, play: play, search: search };
