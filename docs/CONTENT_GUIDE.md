# Zombie60 內容寫作規格（CONTENT GUIDE）

所有事件、任務、廣播都是 **JSON 資料**，由引擎 `src/engine.js` 讀取。寫手只寫資料，不寫程式。
寫完後一律跑 `node tools/validate.mjs` 檢查。

---

## 0. 世界觀速覽

- 舞台：新北深坑 + 台北文山區（木柵、景美、政大、貓空、萬芳、石碇）。喪屍爆發後的封城期。
- 避難所：深坑老街後巷老公寓的地下室（location id `home`）。
- 主角群（見 `data/characters.json`）：
  - **沈硯** `shenYan`：玩家本人。敘事一律用第二人稱「你」，**不要寫「沈硯說」**。
  - **黎霜** `liShuang`（29）：前台電工程師，冷靜毒舌、用數字說話，工作時綁高馬尾。LOG 5。
  - **宋寧** `songNing`（31）：居酒屋「寧」的老闆娘，溫柔大姊姊、圓滑、會說謊、替所有人擋情緒。CHA 5。
  - **夏見** `xiaJian`（26）：前消防員兼拳擊教練，直率護短、怕黑但死不承認，叫你「隊長」。COM 5。
  - 三位女主都是**成年人**、都偏「姊姊型／對等夥伴」，**不要寫成妹妹型**。
- 勢力（見 `data/world.json` → factions）：
  - `nightmarket` 夜市聯盟（景美夜市，首領「阿嬤」，精明商人）
  - `students` 指南山自治會（政大，代表「溫書言」，有發電機缺食物）
  - `military` 三號哨殘部（國道三號檢查哨，士官長「鄭岳」，連絡撤離點）
  - `blackrain` 黑雨（文湖線機廠，首領「老鴉」，掠奪者）
- 地點 id（只能用這些）：
  `home` `supermarket` `shenkeng_oldstreet` `jingmei_river` `shenkeng_school` `freeway3_checkpoint`
  `nccu` `zoo` `muzha_depot` `wanfang_hospital` `jingmei_market` `maokong` `shiding`
- 天氣 id：`clear` `rain` `heat` `fog` `typhoon`

## 1. 文風

- 小說感、短段落、畫面先於說明。每張事件 `text` 約 80–220 字，用 `\n` 分段。
- 每個選項都要有 **代價**：資源代價 或 關係代價 或 風險。沒有「純好選項」。
- 女主台詞要符合個性。對話用全形『』。
- 曖昧、張力、成年人之間的親密可以寫，但**點到為止、不露骨**（淡出、留白、肢體細節到牽手／靠肩／擁抱為止）。
- 繁體中文、台灣用語。不要出現現實品牌名。

## 2. 檔案格式

每個內容檔是一個 JSON 物件：

```json
{
  "quests": [ ...可省略... ],
  "events": [ ...事件陣列... ]
}
```

## 3. 事件（event）

```json
{
  "id": "SH_001",
  "pool": "shelter",
  "title": "水箱的怪聲",
  "weight": 10,
  "once": false,
  "conditions": { "minDay": 1 },
  "text": "敘事……",
  "choices": [ ...2–4 個選項... ]
}
```

| 欄位 | 必填 | 說明 |
|---|---|---|
| `id` | ✔ | 全域唯一，使用你被分配的**前綴**（例如 `SH_`、`RO_`、`QR_`）。 |
| `pool` | ✔ | 見下表。 |
| `title` | ✔ | 4–10 字。 |
| `text` | ✔ | 敘事。可用佔位符 `{actor}` `{target}`（見 §6）。 |
| `choices` | ✔ | 2–4 個。 |
| `weight` | | 抽取權重，預設 10。稀有事件 3–5，常見 10–15。 |
| `once` | | `true` = 一局只出現一次。任務、戀愛、獨特事件請設 `true`。 |
| `conditions` | | 觸發條件，見 §5。 |

### pool 種類

| pool | 何時出現 |
|---|---|
| `shelter` | 待在避難所的日常事件（預設池）。 |
| `romance` | 與女主的關係事件。引擎每天約 25% 機率從這裡抽（若有符合條件的）。 |
| `world` | 外界找上門：商人、陌生人、勢力、天氣、屍潮。約 25% 機率。 |
| `loc:<地點id>` | 外派隊員**抵達該地點時**的事件，例如 `loc:zoo`。`{actor}` = 外派的人。 |
| `story` | **強制劇情**：只要條件成立就在當天優先觸發（一定要寫 `conditions`，且 `once: true`）。用於任務關鍵節點。 |
| `queued` | 只能被其他事件用 `effects.queue` 排程觸發，不會被隨機抽到。 |

## 4. 選項（choice）

```json
{
  "label": "讓黎霜去修（LOG 檢定）",
  "requires": { "resources": { "Parts": { "gte": 1 } } },
  "cost": { "Parts": 1 },
  "check": { "who": "liShuang", "stat": "LOG", "dc": 7 },
  "outcomes": {
    "success": { "text": "……", "effects": { ... } },
    "fail":    { "text": "……", "effects": { ... } }
  }
}
```

- `label`：玩家看到的按鈕文字。可在括號標註代價/檢定提示。
- `requires`（可選）：與 conditions 同格式。不成立時按鈕會變灰並顯示原因。**有 cost 時請同時寫 requires**，避免資源扣成負數。
- `cost`（可選）：選了就扣的資源（正數 = 扣除）。
- `check`（可選）：屬性檢定。擲骰 = 屬性值 + 1d6（士氣 ≥70 +1；該角色壓力 ≥70 −1）≥ `dc` 即成功。
  - `who`：角色 id、`"actor"`（外派者／被選中的人）、`"best"`（在場者中該屬性最高的人）。
  - `stat`：`STR` 體力、`LOG` 理性、`CHA` 社交、`COM` 戰鬥。
  - `dc` 參考：簡單 5、普通 7、困難 9、極難 11。
- `outcomes`：
  - 有 `check` → 寫 `success` + `fail`。
  - 無 `check` → 寫 `always`。
  - 也可以同時寫 `always`（無論成敗都會套用）。

## 5. 條件（conditions / requires）

全部可選，全部要同時成立：

```json
{
  "minDay": 5,
  "maxDay": 20,
  "flags": ["hasRadio"],
  "notFlags": ["qr_done"],
  "resources": { "Food": { "lte": 3 }, "Ammo": { "gte": 1 } },
  "chars": {
    "liShuang": { "present": true, "Affection": { "gte": 30 } }
  },
  "anyChar": { "Stress": { "gte": 70 } },
  "factions": { "blackrain": { "lte": -20 } },
  "weather": ["rain", "typhoon"],
  "density": { "zoo": { "gte": 50 } },
  "chance": 0.5
}
```

- 比較運算子：`gte` `lte` `gt` `lt` `eq`。
- `chars.<id>` 可用：`alive`（true/false）、`present`（活著且人在避難所、沒外派、沒失散）、`missing`（失散中）、以及任何數值狀態 `Health` `Stress` `Infection` `Body` `Affection` `Trust`。
- `anyChar`：任一**在場的女主**符合即成立，該角色會被綁定為 `{target}`。
- `density.<地點>`：該地喪屍密度 0–100。
- `chance`：額外機率閘門（0–1）。
- 戀愛事件請用 `chars.<id>.present: true` 確保女主在場。

## 6. 效果（effects）

```json
{
  "resources": { "Food": 2, "Noise": -3 },
  "status":    { "Stress": 5 },
  "chars":     { "liShuang": { "Health": -10 }, "$actor": { "Stress": 8 }, "$target": { "Stress": -15 } },
  "relations": { "songNing": { "Affection": 4, "Trust": 2 }, "$target": { "Trust": 3 } },
  "factions":  { "nightmarket": 5 },
  "flagsSet":  ["hasRadio"],
  "flagsClear":["something"],
  "discover":  ["zoo"],
  "queue":     [ { "id": "QR_003", "inDays": 2 } ],
  "world":     { "density": { "zoo": 20 }, "horde": { "at": "nccu", "size": 40 } },
  "end":       "ending_id"
}
```

| key | 說明 |
|---|---|
| `resources` | 全域資源增減。 |
| `status` | 套用在**所有在場**角色身上（含你）。 |
| `chars` | 指定角色狀態增減：`Health` `Stress` `Infection` `Body`。`$actor`/`$target` 為佔位。 |
| `relations` | 只對女主：`Affection` 好感、`Trust` 信任（−100~100）。 |
| `factions` | 勢力聲望增減。 |
| `flagsSet` / `flagsClear` | 旗標。 |
| `discover` | 在地圖上解鎖地點，之後才能外派。 |
| `queue` | N 天後強制觸發某事件（該事件 pool 建議設 `queued`）。 |
| `world.density` | 某地喪屍密度增減。 |
| `world.horde` | 在某地生成一波屍潮（size 20–80），它會在地圖上移動。 |
| `kill` | `["xiaJian"]` 讓角色死亡（請非常節制，只用在重大選擇的失敗結果）。 |
| `rescue` | `["songNing"]` 讓失散的角色回到避難所。 |
| `end` | 立即進入結局（只有任務終點可以用）。 |

### 數值尺度（請遵守，否則平衡會崩）

| 項目 | 範圍 / 常見值 |
|---|---|
| Food / Water | 小 ±1、中 ±2~3、大 ±4~6（4 人一天基本吃 4 食 4 水） |
| Med / Ammo / Parts | ±1~2，大獎 3 |
| Morale（0–100） | ±2~8 |
| Noise（0–100） | ±1~6 |
| ExploreRisk（0–100） | ±1~5 |
| Defense（0–100） | ±3~10 |
| Health / Stress / Infection（0–100） | ±3~15 |
| Body（0–100） | ±1~3（長期趨勢，事件中少用） |
| Affection / Trust | ±1~6，關鍵劇情 ±8~10 |
| factions | ±3~10 |

資源 key 只能是：`Food` `Water` `Med` `Ammo` `Parts` `Morale` `Noise` `ExploreRisk` `Defense`。

## 7. 共用旗標（跨檔案）

| flag | 意義 |
|---|---|
| `hasRadio` | 有收音機／無線電（開局搜刮可能取得，或事件取得）。主線前提。 |
| `hasMap` | 有紙本地圖。 |
| `hasGenerator` | 避難所有發電機。 |
| `hasRainCollector` | 有集雨裝置（下雨時自動 +Water）。 |
| `metNightmarket` `metStudents` `metMilitary` `metBlackrain` | 第一次接觸該勢力。 |
| `blackrainHostile` | 與黑雨正式交惡。 |
| `evacKnown` | 得知撤離點存在。 |

自己檔案內部的旗標請加上你的前綴小寫，例如 `qr_heard_voice`、`ro_ls_rooftop`。

### 結局 id（`effects.end` 只能用這些，見 `data/endings.json`）

`ending_evac`（撤離）`ending_students`（加入指南山）`ending_blackrain`（投靠黑雨）`ending_dead` `ending_alone` `ending_survive` `ending_harem` `ending_liShuang` `ending_songNing` `ending_xiaJian`
（第 30 天引擎會依好感／存活自動判定，任務只在「明確終點」才用 `end`。）

## 8. 任務（quest）

任務是給玩家看的「任務簿」，進度由旗標驅動，實際劇情寫在事件裡。

```json
{
  "id": "q_radio",
  "title": "另一端的聲音",
  "summary": "一句話介紹。",
  "stages": [
    { "flag": "qr_s1", "text": "收音機裡有規律的雜訊。" },
    { "flag": "qr_s2", "text": "……" },
    { "flag": "qr_done", "text": "……" }
  ]
}
```

第 N 個 stage 的 `flag` 被設為 true 時，任務簿顯示到該階段。最後一個 stage 代表完成。

## 9. 自檢清單

- [ ] JSON 合法（沒有尾逗號、引號全是半形 `"`）。
- [ ] id 有前綴且唯一；`queue` 指向的 id 存在。
- [ ] 每個 choice 有 `outcomes`；有 `check` 就要有 `success` 和 `fail`。
- [ ] 只用規格內的 key、地點 id、角色 id、勢力 id。
- [ ] 有 cost 的選項有對應的 requires。
- [ ] 跑 `node tools/validate.mjs <你的檔案>` 沒有錯誤。
