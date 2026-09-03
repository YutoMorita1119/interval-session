# 引継ぎ

## 要約

Firebase匿名認証を前提に，秘密データをrole別文書へ分離し，7ターンのトランザクション進行，Web Audio，拍単位ピアノロール，研究目的に沿うUIを実装した．自動テスト19件と構文検査は通過している．

## 次の具体的なアクション

1. Firestore Rulesを本番へ反映する．
2. Firebase Hostingへ静的ファイルを反映する．
3. 同じURLを2タブで開き，作成，参加，7ターン，音声，終了時開示を確認する．

## 作成・編集したファイル

`index.html`，`style.css`，`script.js`，`src/`，`tests/`，`firestore.rules`，`firebase.json`，`.firebaserc`，`package.json`，`docs/`

## 主要な判断と理由

- Supabaseへ移行せずFirebaseを維持した．既存デプロイと匿名認証を活かし，短期で内部品質へ集中するため．
- 秘密データを`private/host`と`private/guest`へ分離した．進行中の非公開と終了後の開示をRulesで表現するため．
- Tone.jsを使わずWeb Audioを遅延初期化した．停止可能性，出力保護，テスト可能性を高めるため．

## アウトプット

- AIRFLOW：https://airflow-ivory.vercel.app/
- 対象アプリ：https://musical-comms-app.web.app/
