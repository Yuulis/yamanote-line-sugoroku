# Official line symbols (路線記号) as in-game line icons

- Date: 2026-10-28. Every URL below was accessed on 2026-10-28 unless noted.
- Subject: can 「山手線すごろく 東京近郊版」 (free, non-commercial, unofficial browser
  game at https://yamanote-line-sugoroku.vercel.app) show each operator's
  official line symbols (JR East 「JY」 rounded-square signs, Tokyo Metro / Toei
  circled letters, private-railway symbols) as line icons, and on what
  conditions.
- Related decisions: `.claude/docs/DESIGN.md` D2 (2026-10-21, original brand,
  no JR logos / station signs) and D4 (2026-10-21, credits screen with the
  unofficial disclaimer). Prior desk scan:
  `.claude/docs/research/launch-name-mark-check.md` §3 (shapes to stay clear of).
- Current code: no line badges exist yet; the disclaimer is in
  `src/features/game/components/TitleScreen.tsx` (credits). No ads, donation
  links, or `FUNDING.yml` were found in `src/`, `index.html`, or `.github/`.

> **This is a desk research summary, not legal advice.** It relies on public
> web pages, operator terms, Wikipedia/Commons, and secondary legal commentary.
> J-PlatPat (the JPO trademark database) is a JavaScript application that could
> not be queried automatically, and a third-party mirror (ipforce.jp) returned
> 403, so **registration status of individual line symbols is unverified** except
> where an operator itself calls them its trademarks. A definitive answer needs
> a 弁理士 / 弁護士, or written permission from each operator.

## 1. Bottom line

1. **Copyright is not the obstacle.** The symbols are simple letters in basic
   shapes; Japanese case law (Asahi logo, Tokyo High Court 1996-01-25) sets a
   high bar for letter logos, and Wikimedia Commons hosts all of them as
   `PD-textlogo` (with a trademark warning).
2. **The obstacle is permission and trademark/unfair-competition exposure,
   and operator policy is explicit for the most important case.** Tokyo Metro
   — the only operator with a published self-service licence for its line
   symbols — calls its 路線記号 and 路線ナンバリング "trademarks it holds" and
   **expressly excludes games** from the no-application licence
   (「ゲームや映像等において使用する場合…を除きます」). Use in a game therefore
   needs individual permission.
3. **Permission (Option B) is not realistically obtainable for the full set.**
   JR East's licensing desk (jeki) and Odakyu's desk state they **do not
   contract with individuals**; most other operators publish no process at all.
   Toei is the exception in practice: it publishes its station-numbering icons
   under **CC BY 4.0** — but CC BY expressly does not license trademark rights.
4. **Recommended: Option C** — original badges that carry the official
   *letter code* and an approximate *line colour* in a shape that is not the
   operators' sign shape. It delivers most of the recognisability, needs no
   permission, and stays consistent with D2/D4.

## 2. Lines in the game, by operator

Source: `public/data/services.json` (`lines` array, 135 entries; the task brief
said ~134). Line-symbol letters from operator releases and the Japanese
Wikipedia station-numbering article (sources in §3).

| Operator | Lines in game | Lines with an official letter symbol | Symbols used by those lines |
|----------|--------------:|------------------------------------:|-----------------------------|
| JR East | 55 | 34 (some only on part of the section) | JY, JK, JB, JC, JA, JE, JM, JN, JI, JH, JT, JO, JU, JS, JJ, JL, SN, SE |
| Tobu | 14 | 14 | TS, TI, TN, TD, TJ |
| Seibu | 12 | 12 | SI, SS, SK, ST, SW, SY |
| Tokyo Metro | 10 | 10 | G, M (Mb numbering on the Hōnanchō branch), H, T, C, Y, Z, N, F |
| Tokyu | 9 | 9 | TY, MG, SH, DT, OM, IK, TM, SG, KD |
| Keisei | 8 | 8 | KS (all, incl. 松戸線 since 2025-04-01; formerly SL) |
| Keio | 6 | 6 | KO, IN |
| Toei (東京都交通局) | 5 | 5 | A, I, S, E (both 大江戸線 entries) |
| Keikyu | 5 | 5 | KK |
| Odakyu | 3 | 3 | OH, OE, OT |
| Sotetsu | 3 | 3 | SO |
| Yokohama Municipal Subway (横浜市交通局) | 2 | 2 | B, G |
| Tsukuba Express (首都圏新都市鉄道) | 1 | 1 | TX |
| Minatomirai Line (横浜高速鉄道) | 1 | 1 | MM |
| Hokuso (北総鉄道) | 1 | 1 | HS |
| **Total** | **135** | **114** | 21 JR lines have no letter symbol |

JR East detail (`jr-*` ids):

- **Full symbol:** yamanote JY; keihin-tohoku JK; chuo-sobu-local JB;
  chuo-rapid, ome, itsukaichi, chuo-takao-fujino JC (Takao–Ōtsuki is JC24–32;
  some 五日市線 signs reportedly no longer show it); saikyo JA;
  sotetsu-direct JA/JS (per Wikipedia: JA north of 大崎, JS south); keiyo JE;
  musashino JM; musashino-takaya / musashino-futamata (Keiyō branches, JM/JE
  stations); nambu, nambu-branch JN; tsurumi + both branches JI; yokohama JH;
  tokaido, ito JT; yokosuka, sobu-rapid, narita-airport-branch JO;
  shonan-shinjuku-local / -rapid-takasaki JS; joban-rapid JJ; joban-local JL;
  shinonoi SN; shinetsu-nagano SE (both added 2025).
- **Partial (symbol only on part of the section):** utsunomiya, takasaki JU
  (Tokyo–Ōmiya only); narita (佐倉–松岸) and sobu-main (千葉–銚子) JO only
  between Chiba/Sakura and Narita.
- **No letter symbol (21):** hachiko, kawagoe-west, sagami, narita-abiko,
  kashima, sotobo, uchibo, kururi, togane, chuo-tatsuno, koumi, oito (bare
  numbers only, no letters), shinetsu-yokokawa, joetsu, agatsuma, ryomo, mito,
  nikko, karasuyama, suigun, suigun-ota.

Implication: even Option A or B could not give every line an official icon;
21 lines would need a fallback design anyway.

## 3. Per-operator findings

Columns: **TM?** = are line symbols claimed/registered as trademarks;
**Guideline / process** = published usage rule or permission route;
**Non-commercial?** = whether non-commercial, fan, or game use is addressed.

| Operator (#lines) | Official symbols? | TM? | Guideline / process | Non-commercial / games addressed? | Sources |
|---|---|---|---|---|---|
| **Tokyo Metro** (10) | Yes, all | **Yes — operator states 路線記号 and 路線ナンバリング are 「当社が有する商標」** (registration numbers not verified) | Self-service licence (2025-04 terms + CI guideline): no application needed **only** to show station locations on maps/signboards, or to show a business relationship; unmodified official data, exact colours, no black-only rendering, reverse rendering on non-white backgrounds, Japan-only use. Otherwise ask お客様センター (0570-200-222 / web form), attach design draft; ~10 business days. | **Games explicitly excluded** from the self-service licence (「ゲームや映像等において使用する場合や有償の商品やサービスにおいて使用する場合を除きます」). Non-commercial use is not carved out. Images also on ODPT under the ODPT Basic Licence. | https://www.tokyometro.jp/support/trademark/index.html ; https://www.tokyometro.jp/support/trademark/pdf/kiyaku.pdf ; https://www.tokyometro.jp/support/trademark/pdf/guideline.pdf ; https://ckan.odpt.org/dataset/r_image-tokyometro |
| **Toei / 東京都交通局** (5) | Yes, all (designed jointly with Tokyo Metro) | Not stated by Toei; unverified | **Station-numbering icons published on ODPT under CC BY 4.0** (credit 「東京都交通局」). No trademark guideline page found. Site policy: rights belong to Tokyo Metropolitan Government; no reuse beyond private use/quotation. Licensing of route maps/photos for products via 資産運用部資産活用課 (03-5320-6054), ~2 weeks. | Not addressed. CC BY 4.0 §2(b)(2) states trademark rights are **not** licensed. | https://ckan.odpt.org/dataset/r_image-toei ; https://www.kotsu.metro.tokyo.jp/riyo/ ; https://www.kotsu.metro.tokyo.jp/other/kanren/map_rental/index.html ; https://creativecommons.org/licenses/by/4.0/legalcode |
| **JR East** (55) | 34 of 55 (see §2) | Unverified for line symbols. JR East holds many registrations (~600 filings reported; see launch-name-mark-check.md) | Site terms: no reuse of logos/images; trademarks may not be used without prior permission. Merchandise licensing via jeki (property@jeki.co.jp): basic contract + per-plan application + fee. | **jeki: 「個人のお客さまとの許諾契約は行なっておりません」** (no individuals). Game software is among licensed products (corporate licensees). | https://www.jreast.co.jp/en/site/rules.html/ (via search snippet; direct fetch 403) ; https://jreastfaq.jreast.co.jp/faq/show/1285?category_id=45&site_domain=default ; https://www.jeki.co.jp/field/property/ ; https://www.jreast.co.jp/press/2016/20160402.pdf ; https://www.jreast.co.jp/press/2024/nagano/20241213_na02.pdf |
| **Tobu** (14) | Yes, all | Unverified | Site policy: no use beyond private use without approval; IP infringement prohibited. No logo/symbol process found. | Not addressed | https://www.tobu.co.jp/sitepolicy/ |
| **Seibu** (12) | Yes, all | Unverified | Site policy: no reproduction/modification beyond private use without permission. No process found. | Not addressed | https://www.seiburailway.jp/policy/ |
| **Tokyu** (9) | Yes, all | Site: names and service marks are 「登録商標、もしくは商標」 (symbols not named) | Prior permission needed beyond private use; no process published (general inquiry only). | Not addressed | https://www.tokyu.co.jp/use/ |
| **Keisei** (8) | Yes, all (KS) | Unverified | Site policy page not located. No process found. | Not addressed | https://www.keisei.co.jp/news/detail.php?CN=6808 (松戸線 KS renumbering) |
| **Keio** (6) | Yes, all | Unverified | Site terms refuse any reuse of photos, company logo, images. No process found. | Not addressed | https://www.keio.co.jp/contact/site/ |
| **Keikyu** (5) | Yes, all (KK) | Site: rights in logos/trademarks/service marks belong to Keikyu; do not use without permission | No process published. Keikyu numbering images were offered to the ODPT Tokyo Challenge under contest-only terms with edit limits. | Not addressed | https://www.keikyu.co.jp/website-guide.html |
| **Odakyu** (3) | Yes, all | Unverified | Merchandise licence desk (odakyu-license@odakyu-dentetsu.co.jp): ~1–2 months, fee, 1-year term; covers game software. Site terms refuse reuse of company logo/images. | **「商品化許諾を申請いただけるのは法人のみ」**; no individuals. | https://www.odakyu.jp/company/otherbiz/others/license/ ; https://www.odakyu.jp/policy/ |
| **Sotetsu** (3) | Yes, all (SO) | Unverified | Site terms (operated by 相鉄HD): no reproduction/modification/public transmission without consent except private use. No process found. | Not addressed | https://www.sotetsu.co.jp/terms/ |
| **Yokohama Municipal Subway** (2) | Yes (B, G) | Unverified | No Transportation Bureau logo/symbol process found; city site policy: no reuse beyond private use/quotation unless CC-licensed. | Not addressed | https://www.city.yokohama.lg.jp/aboutweb/sitepolicy.html |
| **Tsukuba Express** (1) | Yes (TX) | 「つくばエクスプレス」, 「TSUKUBA EXPRESS」 and the TX logo are registered (per Wikipedia); the TX line symbol itself unverified | **Formal 使用承認申請**: Excel form + design draft to shonin@mir.co.jp (経営企画部 許諾担当), ~1 week, credit 「(C)つくばエクスプレス」, max 1 year. Merchandise needs a separate 商品化許諾. Image data on ODPT under the ODPT Basic Licence. | Not addressed; the form is framed around advertisers. | https://www.mir.co.jp/inquiry/copyright.html ; https://www.mir.co.jp/about_site/ ; https://ja.wikipedia.org/wiki/首都圏新都市鉄道 ; https://ckan.odpt.org/organization/mir |
| **Minatomirai Line / 横浜高速鉄道** (1) | Yes (MM) | Unverified | Site policy: no reproduction of text/illustrations/photos without permission. No process found. | Not addressed | https://www.mm21railway.co.jp/info/sitepolicy.html |
| **Hokuso** (1) | Yes (HS) | Unverified | Site policy: no copying/secondary use without permission; no modification. No process found. | Not addressed | https://www.hokuso-railway.co.jp/sitepolicy/ |

Symbol-letter sources: https://ja.wikipedia.org/wiki/駅ナンバリング (Tobu
2012-03, Seibu 2013-03, Keio 2013-02, Tokyu 2012-02, Sotetsu 2014-02, Keikyu
2010-10, Keisei 2010-07, Yokohama 2002, MM ~2012, TX letters ~2020, JR East
2016-), https://ekimeihyo.kurikomisan.com/jr_east/numbering.html (JR East
coverage), https://www.tetsudo.com/report/480/ (Keisei 松戸線).

Pattern across operators: site terms are generic "no reuse without
permission"; only Tokyo Metro speaks to line symbols directly, and it rules out
games; the two operators with merchandise desks that state eligibility (JR East
via jeki, Odakyu) exclude individuals.

## 4. Legal framing (Japan, stated cautiously)

**Copyright.** A work must express thoughts or feelings creatively
(著作権法 2条1項1号). For letter-based logos, the Asahi logo case (東京高判
平成8年1月25日, 平成6年(ネ)1470, 判時1568号119頁) held that letters are shared
cultural property with a practical function, so a stylised typeface is protected
only if it reaches aesthetic creativity comparable to fine art; the Asahi logo
did not. Line symbols (two letters in a rounded square or a coloured ring) are
simpler than that logo, so copyright protection is unlikely. Commons tags them
`PD-textlogo`, which is a copyright judgement only.
Sources: https://www.translan.com/jucc/precedent-1996-01-25.html ;
https://www.kojimatokkyojimusho.net/hanketsu/h8.html ;
https://commons.wikimedia.org/wiki/Commons:Copyright_rules_by_territory/Japan

**Trademark.** A trademark under 商標法 2条1項 is a mark used by a person who
produces goods or provides services **業として** (in the course of trade). The
JPO's training text states that 「業として」 does not require profit motive; a
single act with intent to repeat can qualify. So "non-commercial" by itself is
not a safe harbour: a public game offered continuously could be argued to be
provided 業として. Two limits work in the game's favour:

- **Not a source-identifying use.** 商標法 26条1項6号 (added 2014) says rights do
  not extend to a mark not used in a manner that lets consumers recognise whose
  goods/services they are. Using 「JY」 to label the Yamanote line inside a game
  arguably identifies *the line*, not *the game's source* — the same logic that
  courts applied in the POPEYE and ピタバ cases. This is an argument, not a
  certainty; a faithful copy of the operator's sign design weakens it, because
  it looks like the operator's own signage.
- **Goods/services scope.** Infringement needs use on goods/services identical
  or similar to the designated ones. Rail registrations sit mainly in class 39
  (transport); a browser game falls in class 41 (online game provision) or 9.
  Whether any operator registered its line symbols in 9/41 is **unverified**.
- **Registrability note.** Two plain capital letters such as 「JY」 are close to
  the 「極めて簡単で、かつ、ありふれた標章」 bar of 商標法 3条1項5号, so the
  *letters alone* are weak trademarks; the protectable part, if any, is the
  composite sign design.

Sources: https://laws.e-gov.go.jp/law/334AC0000000127 (商標法) ;
https://www.jpo.go.jp/news/kokusai/developing/training/textbook/document/index/trademark_disputes_and_their_handling_jp.pdf ;
https://www.businesslawyers.jp/practices/1042 ;
https://www.oike-law.gr.jp/wp-content/uploads/OL50-02_sakata.pdf

**Unfair competition (不正競争防止法).** 2条1項1号 (confusion with a
well-known indication) and 2号 (use of a famous indication, no confusion
needed — e.g. MariCar, 知財高判令和2年1月29日) protect unregistered marks too,
but both concern using the indication *as one's own* 商品等表示 in business
(営業). An unofficial game that reproduces official signage at scale, together
with operator names, is where a "mistaken as official / endorsed" argument
would come from. The D4 disclaimer reduces this but does not cure a design that
looks like official signage. Sources:
https://www.chizaisoudan.com/topics/356 ;
https://houritsushoku.com/archives/unfair-competition-prevention-act-unauthorized-use-of-others-mark.html

**Contract / licence terms.** Separate from statute: downloading Tokyo Metro's
official files means accepting its terms, which exclude games; ODPT data comes
with its own licence terms; Toei's CC BY 4.0 licence covers copyright only.

**Effect of monetisation.** Adding ads, paid features, or donation links
(投げ銭, Ko-fi, GitHub Sponsors) would (a) make 「業として」 and 「営業」 much
easier to argue, (b) move use into Tokyo Metro's other explicit exclusion
(「有償の商品やサービス」), and (c) look like free-riding on brand value
(the 2号 rationale). Monetisation materially raises risk for Options A and B
alike; Option C is largely unaffected. This is reasoning from the sources
above, not a cited holding.

**Realistic outcome of a problem.** No documented case was found of an operator
suing or issuing a takedown to a free fan game over line symbols (searches in
§6); absence of evidence is not tolerance. The realistic downside of Option A is
a takedown request from one operator, forcing a redesign under time pressure,
plus the reputational cost of having ignored published terms.

## 5. Sourcing options for artwork

| Source | Coverage | Licence | Caveats |
|--------|----------|---------|---------|
| Wikimedia Commons (`Category:Rapid transit icons of Japan`, e.g. `File:JR_JY_line_symbol.svg`, `File:Logo_of_Tokyo_Metro_Ginza_Line.svg`, `File:Toei_Asakusa_line_symbol.svg`, `File:Tokyu_TY_line_symbol.svg`) | Effectively every operator in §2 | `PD-textlogo` (copyright); Tokyo Metro files also carry `{{Trademarked}}`; all carry the "may be subject to other restrictions" notice | Many are community redraws (e.g. Toei A redrawn by a user, colour adjusted), so colours/geometry may not match official specs. PD status says nothing about trademark or operator terms. |
| Tokyo Metro official download | Metro only | Operator terms (no application only for maps/signboards, not games) | Unmodified data only; games excluded |
| ODPT `r_image-tokyometro` | Metro | ODPT Basic Licence (+ operator-specific conditions in the ZIP) | Requires ODPT registration; operator conditions apply |
| ODPT `r_image-toei` | Toei (+ Nippori-Toneri Liner, Toden) | **CC BY 4.0**, credit 東京都交通局 | Trademark not licensed |
| ODPT TX / Rinkai / Yurikamome image data | TX (Rinkai, Yurikamome not in game) | ODPT Basic Licence | Registration; terms not reviewed in full |
| Draw from scratch (Option C) | All, including the 21 JR lines without symbols | Project's own | Must avoid copying sign geometry |

Sources: https://commons.wikimedia.org/wiki/File:JR_JY_line_symbol.svg ;
https://commons.wikimedia.org/wiki/File:Logo_of_Tokyo_Metro_Ginza_Line.svg ;
https://commons.wikimedia.org/wiki/File:Toei_Asakusa_line_symbol.svg ;
https://commons.wikimedia.org/wiki/File:Tokyu_TY_line_symbol.svg ;
https://ckan.odpt.org/dataset/?tags=画像情報_鉄道関連-image_data__railway-related

## 6. Precedent

- **Licensed commercial games** exist: jeki and Odakyu list game software among
  licensed products (corporate licensees, fee-based). This shows operators treat
  games as a licensable use.
- **Encyclopaedic use** (Wikipedia/Commons, Wikidata logo images) is
  widespread and tolerated; it is not trade use.
- **Fan/dev projects**: Mini Tokyo 3D (open source, ODPT data) and a 2026 note
  article about a station-numbering quiz game whose author explicitly deferred
  the legal check. No operator objection or approval was found for either.
- **No published takedown** of a fan game over line symbols was found.

Sources: https://www.jeki.co.jp/field/property/ ;
https://www.odakyu.jp/company/otherbiz/others/license/ ;
https://github.com/nagix/mini-tokyo-3d ;
https://note.com/shinji_w_jp/n/n54e4acca1c91

## 7. Options and risk

| | A: official symbols as-is, no permission | B: official symbols after permission | C: original badges with official letter codes |
|---|---|---|---|
| What it means | Ship Commons/official SVGs for 114 lines | Apply to each of 15 operators; ship only approved ones | Own shape (e.g. a filled pill/tag or flag in the game's style), official letters in the game font, approximate line colour; no station numbers; no rounded-square frame, no coloured ring around a letter |
| Requires | Nothing up front; a fallback for 21 JR lines; willingness to remove on request | 15 applications; design drafts; ~1 week (TX) to 1–2 months (Odakyu) each; ongoing compliance (exact colours, no modification, credit lines, renewals); fallback for refusals and the 21 lines | Design work only; keep D4 disclaimer; avoid inventing J-prefixed codes for lines without one |
| Copyright risk | Low | None for approved | None |
| Trademark / 不競法 risk | Low–moderate legally (26条1項6号 and class arguments help, but faithful copies of signage weaken them); rises sharply with monetisation | Low for approved operators | Low (letters alone are weak marks; descriptive use; distinct shape) |
| Terms / relationship risk | **Directly contradicts Tokyo Metro's published terms** (games excluded); ignores "no reuse" site terms of the rest | None for approved | None |
| Feasibility | Immediate | **Low**: JR East (34 lines) and Odakyu state no licences to individuals; most others have no process; partial approval produces a mixed icon set | Immediate |
| Consistency with D2/D4 | Reverses D2's reasoning (avoid official marks so the game is not mistaken as official) | Consistent if approvals are disclosed | Consistent |
| Recognisability | Highest | Highest where approved | High (letters + colour carry most recognition) |

## 8. Recommendation

**Option C.** Reasons:

1. Tokyo Metro has already answered the question for its own symbols — games are
   outside the free licence — and Option A would knowingly cross a published
   operator rule, which is the fact most likely to matter if anyone objects.
2. Option B cannot cover the largest operator: JR East's licensing route
   excludes individuals, and JR lines are 55 of 135. Odakyu likewise. The result
   would be an inconsistent icon set at significant effort.
3. Most player-facing value (instant recognition of 「JY」, 「G」, 「TY」 + colour)
   survives in an original shape, and the 21 JR lines without official symbols
   need an original fallback in any option.
4. It keeps the project's D2/D4 posture (original design + unofficial
   disclaimer) intact and is unaffected by any future monetisation.

Design guardrails for C (from this research and
`launch-name-mark-check.md` §3): no rounded-square frame around two letters;
no coloured ring around a single letter; no station numbers next to the code;
no operator logos; use the game font, not the operators' sign typeface; do not
claim colours are "official"; for lines without an official code, show the line
name or colour only rather than inventing a code.

If the user still wants official artwork for some operators, the lowest-friction
partial route is: (1) ask Tokyo Metro お客様センター with a screenshot (the
terms invite exactly this), (2) ask Toei (資産活用課) whether its CC BY icons may
be used in a game, (3) TX's 使用承認申請. Treat any reply as specific to that
design and scope.

## 9. Open items / not verified

- J-PlatPat check of figure marks for line symbols per operator (applicant name
  + 区分 09/41 + 図形等分類 for circles/letters). Steps are in
  `launch-name-mark-check.md` §"J-PlatPat steps"; replace step 3 with
  「権利者/出願人」 = each operator name.
- Full text of the ODPT Basic Licence and Tokyo Metro / TX operator-specific
  image conditions (the ODPT developer site did not resolve during research).
- Keisei and Yokohama Transportation Bureau site-policy pages were not located.
- JR East site terms were read via a search snippet (direct fetch returned 403).
