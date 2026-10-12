# Zombie60 — 深坑・封城三十日

喪屍末日經營 × 事件小說遊戲。《60 Seconds!》式的開場搜刮 + 30 天地下室生存，舞台是新北深坑與台北文山區。
一位男主角（玩家「你」）+ 三位個性迥異的女主：黎霜（工程師）、宋寧（居酒屋老闆娘）、夏見（前消防員）。

## 怎麼玩

純前端，需要用本地伺服器開（瀏覽器不允許 `file://` 讀 JSON）：

```bash
python3 -m http.server 8000   # 然後打開 http://localhost:8000
```

1. **60 秒搜刮**：點地圖移動，撿物資、帶人，回到「地下室」放下。沒帶到的女主會失散在大世界某處，要外派去找回來。
2. **每天**：清晨分配飲食／外派／決定今晚陪誰 → 外派歸來場景 → 白天事件 → 夜話 → 入夜（喪屍壓力檢定）。
3. **第 30 天**依存活、好感、信任、任務旗標判定結局（10 種）。

## 活著的大世界

- **13 個地點**（超市、老街、河堤、國小、檢查哨、政大、動物園、機廠、萬芳醫院、夜市、貓空、石碇）會被事件逐步解鎖。
- **屍潮**在地圖上沿道路移動，噪音與探索會把它們引向你家；抵達時觸發「屍潮來襲」。
- **4 個勢力**（夜市聯盟、指南山自治會、三號哨殘部、黑雨）各有聲望，會在世界動態裡自己行動。
- **天氣**（晴／雨／酷熱／濃霧／颱風）影響搜刮、屍潮與存水。
- **收音機**每天播報，內容隨主線進度改變。
- **3 條任務線**：另一端的聲音（撤離主線）、萬芳的燈（醫生與黑雨）、指南山之約（勢力結盟）。

## 專案結構

```
index.html / style.css / main.js   介面
src/engine.js                       遊戲邏輯（無 DOM，可在 node 跑）
src/scavenge.js                     60 秒搜刮小遊戲
data/world.json                     地點、道路、勢力、天氣
data/characters.json                角色
data/endings.json                   結局
data/flavor.json                    收音機／世界動態／夜話氛圍文字
data/content/*.json                 事件與任務（165 張事件）
docs/CONTENT_GUIDE.md               內容寫作規格（新增事件請先讀）
tools/validate.mjs                  內容檢查：node tools/validate.mjs
tools/sim.mjs                       無頭平衡模擬：node tools/sim.mjs 1000 [--scavenge] [--flags]
```

新增內容的流程：依 `docs/CONTENT_GUIDE.md` 寫 JSON → 加進 `data/manifest.json` → `node tools/validate.mjs` → `node tools/sim.mjs` 看有沒有從來沒觸發的事件或卡死。
