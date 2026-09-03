# チュートリアル改善の公開計画

## 解決する問題とその理由

ローカルで完成している実画面型チュートリアル，開始画面の文言整理，音量統一，余白調整が，GitHubと公開中のFirebase Hostingへまだ反映されていない．検証済みの変更を同じ単位で記録し，公開URLから確認できる状態にする．

## 成功基準

- 自動テストと構文検査が成功する．
- 差分に認証情報，ローカル成果物，意図しないファイルが含まれない．
- コードレビューで公開を妨げる問題がない．
- 現在の`main`へ変更を1コミットとして記録し，`origin/main`へpushする．
- Firebaseプロジェクト`musical-comms-app`のHostingへ公開する．Firestore Rulesは今回変更していないため，Hostingのみを対象にする．
- 公開URL`https://musical-comms-app.web.app/`で開始画面とチュートリアル開始を確認する．

## スコープ

現在の作業ツリーにあるチュートリアル，音声設定，開始画面，関連テスト，README，実装計画，引継ぎ記録を対象とする．

Firestoreデータ，Authentication設定，Firestore Rules，Firebaseプロジェクト設定は変更しない．

## 制約と依存関係

- GitHubへのpushとFirebase Hostingへのdeployは外部状態を変更する．
- deployには有効なFirebase CLI認証が必要である．
- Hostingの公開ディレクトリがリポジトリ直下であるため，`firebase.json`のignore設定に従って公開対象を限定する．
- `main`へ直接pushする既存運用を踏襲する．履歴の強制書き換えは行わない．

## 実装の順序

1. 差分と公開対象を確認し，秘密情報や不要ファイルがないことを確認する．
2. 全自動テスト，構文検査，差分検査を実行する．
3. コードレビューを実施し，重大な問題があれば公開を止める．
4. 変更を1コミットにまとめる．
5. `origin/main`へpushする．
6. `firebase deploy --only hosting`でHostingだけを公開する．
7. 公開URLの表示とチュートリアル導線を確認し，引継ぎ記録を更新する．

## 未解決の質問

- なし．現在の`main`，GitHubの`origin`，Firebase Hostingの既存サイトを対象とする．
