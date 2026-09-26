# HSPS 點數銀行

班級點數銀行：學生用 iPad（或電腦）查看點數、以一次性 QR 碼互相轉帳（需老師核准）；老師在後台加扣點、批次加扣點、發放每日小組獎勵、審核轉帳、沖正與匯出報表。

- 網站：https://tyctc128.github.io/hsps-point-bank/
- 需求與設計：`docs/HSPS點數銀行_PRD_v1.3.pdf`、`docs/HSPS點數銀行_SDD_v1.4.pdf`
- 測試紀錄：`docs/HSPS點數銀行_測試紀錄.pdf`
- 維運手冊：`docs/MIGRATION.md`

## 架構

| | 正式版 | 開發 / 試用 |
|---|---|---|
| 網站 | GitHub Pages（push 到 main 自動測試並部署） | `npm run dev` |
| 資料 | Firebase（Auth + Firestore，專案 `hsps-point-bank`） | 瀏覽器內模擬資料庫 |
| 權限 | `firestore.rules`（伺服器端強制） | `src/api/mock/mockApi.ts`（相同規則） |

前端只依賴 `src/api/types.ts` 的 `BankApi` 介面，由 `VITE_BACKEND` 切換 `FirebaseApi` / `MockApi`。

## 帳號

- **教師**：帳號輸入 `teacher`（或 tyctc128@gmail.com），初始密碼在 `teacher-account.txt`（只存在老師電腦，請登入後修改並刪除該檔）。
- **學生**：名冊 `account.xlsx` 的帳號與密碼（帳號不分大小寫）。

## 管理工具（老師電腦執行）

需要 `scripts/` 內的 Firebase 服務帳戶金鑰（`*firebase-adminsdk*.json`，**機密，已排除上傳**）。

| 指令 | 用途 |
|---|---|
| `npm run admin -- import account.xlsx` | 由名冊建立學生帳號（已存在者略過） |
| `npm run admin -- reset-password <帳號> <新密碼>` | 重設學生密碼 |
| `npm run admin -- delete-orphans [--yes]` | 刪除「網頁上已刪除學生」的登入帳號 |
| `npm run admin -- backup` | 備份全部資料到 `backups/` |
| `npm run admin -- status` | 帳號與交易數量 |
| `npm run admin -- deploy-rules` | 發布 `firestore.rules` |
| `npm run admin -- init-teacher --name 導師` | 建立 / 重設教師帳號（新密碼寫入 teacher-account.txt） |

## 開發與測試

```bash
npm install
npm run dev              # 模擬資料庫版 http://localhost:5173
npm run dev:emulator     # Firebase 模擬器版（另開終端先執行 npm run emulators）
npm run ipad             # HTTPS 區網測試（平板可用相機）https://<電腦IP>:5443
```

| 指令 | 說明 |
|---|---|
| `npm test` | 單元、整合、權限、原子性測試（模擬資料庫） |
| `npm run test:firebase` | Firebase 模擬器：權限規則測試 + 同一批整合測試 |
| `npm run test:e2e` | 端對端（模擬資料庫；桌面 Chromium + iPad WebKit） |
| `npm run test:e2e:firebase` | 端對端（Firebase 模擬器；多台裝置同步） |
| `npm run test:all` | 全部測試 + 建置 |
| `npm run report` | 產生測試紀錄 |

Firebase 模擬器需要 Java 11 以上。

> ⚠ `account.xlsx`、服務帳戶金鑰、`teacher-account.txt` 含個資或機密，已列在 `.gitignore`，**絕不可提交**。
