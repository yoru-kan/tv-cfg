/**
 * 麒麟电视(KylinTV) 直播解析 - 酷9 JS版
 * 用法：?id=频道ID (如 cctv4, fhzw, ztxw 等)
 * 自动请求频道列表获取最新播放地址，补全TS路径后返回M3U8
 */
function main(item) {
    // ==================== 频道列表 ====================
    var CHANNEL_MAP = {
        'cctv4': '0A6E01E605CC12782BA7',
        'cctv5': 'ABD2CF65914B45B19483',
        'cctv6': '4BEE64591C6DFAAE5944',
        'zgdy': '60F2DB694B1A5CE71CC0',
        'bjws': '54BCED2228F44AA7B32A',
        'dfws': '5491DAA97B29197D8422',
        'ahws': '7E7C95B359790627F967',
        'hubws': 'FEB94C547632ACB5C4B2',
        'hunws': 'AA6E1390E1FAB21F1507',
        'jsws': 'D88B0B17C1402D08035C',
        'zjws': '689F86B990D2501E859C',
        'hxws': '568FE1430FC3C4DFD637',
        'dwqws': '995B0D3365FD79556F3C',
        'gxws': 'F84C620200C48EDE16A4',
        'ynws': '5ADD92EDBEFD0C694A56',
        'gzws': '78D22FE0B04570BCBF5E',
        'dfcj': 'A0198D09E0389F4A0585',
        'jykt': '07A7C62EE6743725CDD4',
        'fhzw': 'B0F3976EBFEDAC818FAC',
        'fhzx': '4D0FE6DD0465CB612E1B',
        'fhxg': '80AFBEF5B9AA2D1B98AB',
        'fhmz': 'A634F958A091EF234523',
        'ztxw': '44657EE3F5EBA103F5A6',
        'mswx': '9307325340919A97A964',
        'hs': '1D589A84839F3DE4EE08',
        'tvbs': '7B037168FDF5DF322FFB',
        'datv': 'A6C0FC5790D9664BEE6A',
        'good2': '37F3E3BDEB2F755DB55A',
        'kljc': '762E68A7FE0DD8610759',
        'cjjc': '90404BDC8AD31B35C04E',
        'bmjdxw': '6F625CBEA898CFADB65F',
        'bmms': '18379A9852AF4967A61B',
        'bmsh': 'DA8F6DBCF5EA2C1AC75A'
    };

    // ==================== 参数解析 ====================
    var inputUrl = item.url || '';
    var id = ku9.getQuery(inputUrl, 'id') || '';

    if (!id || !CHANNEL_MAP[id]) {
        return {
            url: '',
            msg: '参数错误，可用频道：' + Object.keys(CHANNEL_MAP).join(', ')
        };
    }

    var targetId = CHANNEL_MAP[id];

    // 通用请求头
    var headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://v.kylintv.com/',
        'Origin': 'https://v.kylintv.com'
    };

    // ==================== 步骤1：获取频道列表 ====================
    var apiUrl = 'https://api.kylintv.com/api/v1/channels_list?type=2&after=0&limit=300';
    var res1 = ku9.request(apiUrl, 'GET', headers, null, true);

    if (!res1 || res1.code !== 200 || !res1.body) {
        return { url: '', msg: '获取频道列表失败' };
    }

    var listJson;
    try {
        listJson = JSON.parse(res1.body);
    } catch (e) {
        return { url: '', msg: '频道列表JSON解析失败' };
    }

    // 查找匹配频道的播放地址
    var playbackUrl = null;
    var items = listJson.data && listJson.data.items;
    if (Array.isArray(items)) {
        for (var i = 0; i < items.length; i++) {
            var ch = items[i];
            if (ch.id === targetId && ch.playback && ch.playback.playback) {
                playbackUrl = ch.playback.playback;
                break;
            }
        }
    }

    if (!playbackUrl) {
        return { url: '', msg: '未找到该频道的播放地址' };
    }

    // ==================== 步骤2：获取M3U8内容并补全TS路径 ====================
    var res2 = ku9.request(playbackUrl, 'GET', headers, null, true);
    if (!res2 || res2.code !== 200 || !res2.body) {
        return { url: '', msg: '获取M3U8内容失败' };
    }

    var m3u8 = res2.body;
    var basePath = playbackUrl.substring(0, playbackUrl.lastIndexOf('/') + 1);

    // 补全 TS 相对路径（不以 http 开头的行）
    var lines = m3u8.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        // 判断是否是媒体文件行（非注释行且以 .ts 结尾）
        if (line.trim() && line[0] !== '#' && /\.ts$/i.test(line.trim())) {
            if (!/^https?:\/\//i.test(line.trim())) {
                lines[i] = basePath + line.trim();
            }
        }
    }

    var fixedM3u8 = lines.join('\n');

    // 返回 M3U8 及必要请求头
    return {
        m3u8: fixedM3u8,
        headers: headers
    };
}