"""Architect's approximate 1都3県 network (public knowledge, NOT the reviewed catalog).

Used only for early sensitivity runs before the researcher's catalog exists.
"""
import json

L = "local"
R = "rapid"
S = [
    ("yamanote", L, True, "新橋 浜松町 田町 高輪ゲートウェイ 品川 大崎 五反田 目黒 恵比寿 渋谷 原宿 代々木 新宿 新大久保 高田馬場 目白 池袋 大塚 巣鴨 駒込 田端 西日暮里 日暮里 鶯谷 上野 御徒町 秋葉原 神田 東京 有楽町"),
    ("keihin-tohoku-negishi", L, False, "大宮 さいたま新都心 与野 北浦和 浦和 南浦和 蕨 西川口 川口 赤羽 東十条 王子 上中里 田端 西日暮里 日暮里 鶯谷 上野 御徒町 秋葉原 神田 東京 有楽町 新橋 浜松町 田町 高輪ゲートウェイ 品川 大井町 大森 蒲田 川崎 鶴見 新子安 東神奈川 横浜 桜木町 関内 石川町 山手 根岸 磯子 新杉田 洋光台 港南台 本郷台 大船"),
    ("chuo-sobu-local", L, False, "三鷹 吉祥寺 西荻窪 荻窪 阿佐ヶ谷 高円寺 中野 東中野 大久保 新宿 代々木 千駄ケ谷 信濃町 四ツ谷 市ケ谷 飯田橋 水道橋 御茶ノ水 秋葉原 浅草橋 両国 錦糸町 亀戸 平井 新小岩 小岩 市川 本八幡 下総中山 西船橋 船橋 東船橋 津田沼 幕張本郷 幕張 新検見川 稲毛 西千葉 千葉"),
    ("chuo-rapid", L, False, "東京 神田 御茶ノ水 四ツ谷 新宿 中野 高円寺 阿佐ヶ谷 荻窪 西荻窪 吉祥寺 三鷹 武蔵境 東小金井 武蔵小金井 国分寺 西国分寺 国立 立川 日野 豊田 八王子 西八王子 高尾"),
    ("chuo-main-takao-fujino", L, False, "高尾 相模湖 藤野"),
    ("chuo-special-rapid", R, False, "東京 神田 御茶ノ水 四ツ谷 新宿 中野 三鷹 国分寺 立川 八王子 高尾"),
    ("ome", L, False, "立川 西立川 東中神 中神 昭島 拝島 牛浜 福生 羽村 小作 河辺 東青梅 青梅 宮ノ平 日向和田 石神前 二俣尾 軍畑 沢井 御嶽 川井 古里 鳩ノ巣 白丸 奥多摩"),
    ("itsukaichi", L, False, "拝島 熊川 東秋留 秋川 武蔵引田 武蔵増戸 武蔵五日市"),
    ("hachiko-south", L, False, "八王子 北八王子 小宮 拝島 東福生 箱根ケ崎 金子 東飯能 高麗川"),
    ("hachiko-north", L, False, "高麗川 毛呂 越生 明覚 小川町 竹沢 折原 寄居 用土 松久 児玉 丹荘"),
    ("kawagoe", L, False, "大宮 日進 西大宮 指扇 南古谷 川越 西川越 的場 笠幡 武蔵高萩 高麗川"),
    ("saikyo", L, False, "大崎 恵比寿 渋谷 新宿 池袋 板橋 十条 赤羽 北赤羽 浮間舟渡 戸田公園 戸田 北戸田 武蔵浦和 中浦和 南与野 与野本町 北与野 大宮"),
    ("utsunomiya", L, False, "東京 上野 尾久 赤羽 浦和 さいたま新都心 大宮 土呂 東大宮 蓮田 白岡 新白岡 久喜 東鷲宮 栗橋"),
    ("takasaki", L, False, "東京 上野 尾久 赤羽 浦和 さいたま新都心 大宮 宮原 上尾 北上尾 桶川 北本 鴻巣 北鴻巣 吹上 行田 熊谷 籠原 深谷 岡部 本庄 神保原"),
    ("tokaido", L, False, "東京 新橋 品川 川崎 横浜 戸塚 大船 藤沢 辻堂 茅ケ崎 平塚 大磯 二宮 国府津 鴨宮 小田原 早川 根府川 真鶴 湯河原"),
    ("yokosuka-sobu-rapid", L, False, "久里浜 衣笠 横須賀 田浦 東逗子 逗子 鎌倉 北鎌倉 大船 戸塚 東戸塚 保土ケ谷 横浜 新川崎 武蔵小杉 西大井 品川 新橋 東京 新日本橋 馬喰町 錦糸町 新小岩 市川 船橋 津田沼 稲毛 千葉"),
    ("shonan-shinjuku-u-y", R, False, "栗橋 東鷲宮 久喜 新白岡 白岡 蓮田 東大宮 土呂 大宮 さいたま新都心 浦和 赤羽 池袋 新宿 渋谷 恵比寿 大崎 西大井 武蔵小杉 新川崎 横浜 保土ケ谷 東戸塚 戸塚 大船 北鎌倉 鎌倉 逗子"),
    ("shonan-shinjuku-t-t", R, False, "神保原 本庄 岡部 深谷 籠原 熊谷 行田 吹上 北鴻巣 鴻巣 北本 桶川 北上尾 上尾 宮原 大宮 さいたま新都心 浦和 赤羽 池袋 新宿 渋谷 恵比寿 大崎 西大井 武蔵小杉 横浜 戸塚 大船 藤沢 辻堂 茅ケ崎 平塚 大磯 二宮 国府津 鴨宮 小田原"),
    ("joban-rapid", L, False, "品川 新橋 東京 上野 日暮里 三河島 南千住 北千住 松戸 柏 我孫子 天王台"),
    ("joban-local", L, False, "綾瀬 亀有 金町 松戸 北松戸 馬橋 新松戸 北小金 南柏 柏 北柏 我孫子 天王台"),
    ("narita-abiko", L, False, "我孫子 東我孫子 湖北 新木 布佐 木下 小林 安食 下総松崎 成田"),
    ("narita-main", L, False, "佐倉 酒々井 成田 久住 滑河 下総神崎 大戸 佐原 香取 水郷 小見川 笹川 下総橘 下総豊里 椎柴 松岸"),
    ("narita-airport", L, False, "成田 空港第2ビル 成田空港"),
    ("kashima", L, False, "香取 十二橋"),
    ("sobu-main", L, False, "千葉 東千葉 都賀 四街道 物井 佐倉 南酒々井 榎戸 八街 日向 成東 松尾 横芝 飯倉 八日市場 干潟 旭 飯岡 倉橋 猿田 松岸 銚子"),
    ("togane", L, False, "大網 福俵 東金 求名 成東"),
    ("sotobo", L, False, "千葉 本千葉 蘇我 鎌取 誉田 土気 大網 永田 本納 新茂原 茂原 八積 上総一ノ宮 東浪見 太東 長者町 三門 大原 浪花 御宿 勝浦 鵜原 上総興津 行川アイランド 安房小湊 安房天津 安房鴨川"),
    ("uchibo", L, False, "蘇我 浜野 八幡宿 五井 姉ケ崎 長浦 袖ケ浦 巌根 木更津 君津 青堀 大貫 佐貫町 上総湊 竹岡 浜金谷 保田 安房勝山 岩井 富浦 那古船形 館山 九重 千歳 南三原 和田浦 江見 太海 安房鴨川"),
    ("kururi", L, False, "木更津 祇園 上総清川 東清川 横田 東横田 馬来田 下郡 小櫃 俵田 久留里 平山 上総松丘 上総亀山"),
    ("keiyo", L, False, "東京 八丁堀 越中島 潮見 新木場 葛西臨海公園 舞浜 新浦安 市川塩浜 二俣新町 南船橋 新習志野 幕張豊砂 海浜幕張 検見川浜 稲毛海岸 千葉みなと 蘇我"),
    ("keiyo-rapid", R, False, "東京 八丁堀 新木場 舞浜 新浦安 南船橋 海浜幕張 蘇我"),
    ("keiyo-koya", L, False, "市川塩浜 西船橋"),
    ("musashino", L, False, "府中本町 北府中 西国分寺 新小平 新秋津 東所沢 新座 北朝霞 西浦和 武蔵浦和 南浦和 東浦和 東川口 南越谷 越谷レイクタウン 吉川 吉川美南 新三郷 三郷 南流山 新松戸 新八柱 東松戸 市川大野 船橋法典 西船橋 南船橋 新習志野 幕張豊砂 海浜幕張"),
    ("nambu", L, False, "川崎 尻手 矢向 鹿島田 平間 向河原 武蔵小杉 武蔵中原 武蔵新城 武蔵溝ノ口 津田山 久地 宿河原 登戸 中野島 稲田堤 矢野口 稲城長沼 南多摩 府中本町 分倍河原 西府 谷保 矢川 西国立 立川"),
    ("nambu-branch", L, False, "尻手 八丁畷 川崎新町 小田栄 浜川崎"),
    ("tsurumi", L, False, "鶴見 国道 鶴見小野 弁天橋 浅野 安善 武蔵白石 浜川崎 昭和 扇町"),
    ("tsurumi-umishibaura", L, False, "浅野 新芝浦 海芝浦"),
    ("tsurumi-okawa", L, False, "安善 大川"),
    ("yokohama", L, False, "東神奈川 大口 菊名 新横浜 小机 鴨居 中山 十日市場 長津田 成瀬 町田 古淵 淵野辺 矢部 相模原 橋本 相原 八王子みなみ野 片倉 八王子"),
    ("sagami", L, False, "茅ケ崎 北茅ケ崎 香川 寒川 宮山 倉見 門沢橋 社家 厚木 海老名 入谷 相武台下 下溝 原当麻 番田 上溝 南橋本 橋本"),
]
net = {
    "label": "architect-approx (public knowledge, unreviewed)",
    "target": "yamanote",
    "start": "新橋",
    "services": [{"id": i, "type": t, "circular": c, "stops": s.split()} for i, t, c, s in S],
}
json.dump(net, open("net-approx.json", "w"), ensure_ascii=False)
print(len(S), len({x for _, _, _, s in S for x in s.split()}))

# Coarse prefecture tags (only "which prefecture does this station touch"; Tokyo = default).
SAITAMA = set("大宮 さいたま新都心 与野 北浦和 浦和 南浦和 蕨 西川口 川口 戸田公園 戸田 北戸田 武蔵浦和 中浦和 南与野 与野本町 北与野 日進 西大宮 指扇 南古谷 川越 西川越 的場 笠幡 武蔵高萩 高麗川 金子 東飯能 毛呂 越生 明覚 小川町 竹沢 折原 寄居 用土 松久 児玉 丹荘 土呂 東大宮 蓮田 白岡 新白岡 久喜 東鷲宮 栗橋 宮原 上尾 北上尾 桶川 北本 鴻巣 北鴻巣 吹上 行田 熊谷 籠原 深谷 岡部 本庄 神保原 東所沢 新座 北朝霞 西浦和 東浦和 東川口 南越谷 越谷レイクタウン 吉川 吉川美南 新三郷 三郷".split())
CHIBA_SERVICES = {"narita-abiko", "narita-main", "narita-airport", "kashima", "sobu-main", "togane", "sotobo", "uchibo", "kururi", "keiyo-koya"}
CHIBA_EXTRA = set("市川 本八幡 下総中山 西船橋 船橋 東船橋 津田沼 幕張本郷 幕張 新検見川 稲毛 西千葉 千葉 松戸 柏 我孫子 天王台 北松戸 馬橋 新松戸 北小金 南柏 北柏 舞浜 新浦安 市川塩浜 二俣新町 南船橋 新習志野 幕張豊砂 海浜幕張 検見川浜 稲毛海岸 千葉みなと 蘇我 南流山 新八柱 東松戸 市川大野 船橋法典".split())
KANAGAWA_SERVICES = {"tsurumi", "tsurumi-umishibaura", "tsurumi-okawa", "nambu-branch", "sagami"}
KANAGAWA_EXTRA = set("川崎 鶴見 新子安 東神奈川 横浜 桜木町 関内 石川町 山手 根岸 磯子 新杉田 洋光台 港南台 本郷台 大船 戸塚 藤沢 辻堂 茅ケ崎 平塚 大磯 二宮 国府津 鴨宮 小田原 早川 根府川 真鶴 湯河原 久里浜 衣笠 横須賀 田浦 東逗子 逗子 鎌倉 北鎌倉 東戸塚 保土ケ谷 新川崎 武蔵小杉 尻手 矢向 鹿島田 平間 向河原 武蔵中原 武蔵新城 武蔵溝ノ口 津田山 久地 宿河原 登戸 中野島 稲田堤 大口 菊名 新横浜 小机 鴨居 中山 十日市場 長津田 古淵 淵野辺 矢部 相模原 橋本 相模湖 藤野".split())
pref = {}
for sid, _, _, s in S:
    for st in s.split():
        p = "東京都"
        if st in SAITAMA:
            p = "埼玉県"
        elif sid in CHIBA_SERVICES or st in CHIBA_EXTRA:
            p = "千葉県"
        elif sid in KANAGAWA_SERVICES or st in KANAGAWA_EXTRA:
            p = "神奈川県"
        pref.setdefault(st, p)
net["prefectures"] = pref
json.dump(net, open("net-approx.json", "w"), ensure_ascii=False)

# T1 variant: through services split at their nominal line termini.
def stops(sid):
    return next(s.split() for i, _, _, s in S if i == sid)

t1 = {k: v for k, v in net.items() if k != "services"}
t1["label"] = "architect-approx T1 (split at line termini)"
svc = []
for i, t, c, s in S:
    st = s.split()
    if i == "yokosuka-sobu-rapid":
        k = st.index("東京")
        svc.append({"id": "yokosuka", "type": t, "circular": c, "stops": st[: k + 1]})
        svc.append({"id": "sobu-rapid", "type": t, "circular": c, "stops": st[k:]})
    elif i in ("utsunomiya", "takasaki"):
        svc.append({"id": i, "type": t, "circular": c, "stops": st[1:]})
    elif i == "joban-rapid":
        svc.append({"id": i, "type": t, "circular": c, "stops": st[st.index("上野"):]})
    elif i in ("shonan-shinjuku-u-y", "shonan-shinjuku-t-t"):
        if i == "shonan-shinjuku-u-y":
            a, b = st.index("大宮"), st.index("大船")
            svc.append({"id": "shonan-shinjuku", "type": t, "circular": c, "stops": st[a : b + 1]})
    else:
        svc.append({"id": i, "type": t, "circular": c, "stops": st})
svc.append({"id": "ueno-tokyo-line", "type": "rapid", "circular": False, "stops": ["上野", "東京"]})
t1["services"] = svc
json.dump(t1, open("net-approx-t1.json", "w"), ensure_ascii=False)
