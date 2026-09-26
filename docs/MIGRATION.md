# 維運手冊（Firebase 正式版）

## 已完成的部署（2026-09-27）

| 項目 | 狀態 |
|---|---|
| Firebase 專案 | `hsps-point-bank` |
| Firestore 權限規則 | 已發布（`npm run admin -- deploy-rules`） |
| 教師帳號 | tyctc128@gmail.com（初始密碼在老師電腦 `teacher-account.txt`） |
| 學生帳號 | 31 位，由 `account.xlsx` 建立 |
| 網站 | GitHub Pages：https://tyctc128.github.io/hsps-point-bank/ |

## Firebase Console 需確認的設定

1. **Authentication → Sign-in method → 電子郵件/密碼：啟用**（未啟用時所有人都無法登入）。
2. Authentication → Settings → 授權網域：加入 `tyctc128.github.io`。
3. （建議）Google Cloud Console → API 與服務 → 憑證：將瀏覽器 API 金鑰限制為 `https://tyctc128.github.io/*`。
4. （建議）App Check：註冊 reCAPTCHA v3 並對 Firestore 啟用強制執行（需修改程式加入 App Check 初始化）。

## 資料設計重點

- 學生登入帳號在 Firebase Auth 中為 `<帳號>@students.hsps-point-bank.firebaseapp.com`（不收信，僅作識別）。
- 時間欄位以毫秒數儲存；權限規則要求用戶端時間與伺服器相差 5 分鐘內，收款碼過期以伺服器時間判斷。
- 所有查詢只用單一欄位條件，**不需要複合索引**。
- 老師端即時同步最近 60 天的交易與所有審核中的申請；更早的交易在查詢時才讀取，以控制免費額度用量。

## 常見維運

| 情況 | 做法 |
|---|---|
| 學生忘記密碼 | `npm run admin -- reset-password <帳號> <新密碼>` |
| 新學生轉入 | 後台「帳號管理」匯入或新增；或 `npm run admin -- import 新名冊.xlsx` |
| 學生轉出 | 後台「學生總覽」停用（保留紀錄）或刪除；刪除後執行 `npm run admin -- delete-orphans --yes` 清除登入帳號 |
| 每月備份 | `npm run admin -- backup`（或後台「設定與備份 → 下載全部資料」） |
| 修改權限規則 | 編輯 `firestore.rules` → `npm run test:firebase` 通過 → `npm run admin -- deploy-rules` |
| 更新網站 | push 到 `main`，GitHub Actions 全部測試通過後自動部署 |
