# Expo2025 Tampermonkey Auto Booker

Tampermonkey userscript: Expo2025 の新規予約をイベント駆動で補助します。
このリポジトリは **GitHub でバージョン管理**し、`npm run build` で
`@updateURL`/`@downloadURL` を自動注入します。

> ⏱️ **更新タイミング**: 各スクリプトは毎分11秒から探索を開始し、23秒で探索フェーズを締めて次分の仕込みに入るようになりました。

## 使い方（最短）

1. このリポジトリを作成（**自分の GitHub** に作る）。
2. `package.json` の `repository.url` を自分の URL に変更（例: `https://github.com/yourname/expo2025-tm-autobooker.git`）。
3. Node 18+ を用意して、以下を実行:
   ```bash
   npm i
   npm run build
   git add .
   git commit -m "chore: initial commit"
   git push origin main
   ```
4. **Raw URL** はビルド時に自動挿入されます。Tampermonkey で「**URLから新規スクリプトを追加**」し、
   `https://raw.githubusercontent.com/<USER>/<REPO>/main/dist/expo2025-reserver.user.js`
   を登録してください。
5. 更新は以下の流れ：
   ```bash
   # 変更して…
   npm run build
   git add -A
   git commit -m "feat: ..."
   git push
   ```
   自動更新は Tampermonkey の設定で有効にしておきます。

### Android 端末で利用する場合

`expo2025-reserver-android.user.js` は Android ブラウザ（Kiwi など）向けに、
リロード実行前に画面描画と空き枠監視の再稼働を待機する調整を加えた
Tampermonkey スクリプトです。Android 端末ではこちらをインストールし、
`https://github.com/<USER>/<REPO>/raw/refs/heads/main/expo2025-reserver-android.user.js`
を Tampermonkey の「URL から追加」で指定してください。

## リリース（任意）

タグ（例: `v0.1.1`）を打つと、GitHub Actions が `dist/*.user.js` を Release Assets に添付します。
```bash
npm version patch
git push --follow-tags
```

## Codex / ChatGPT 等のプロンプト（Pull Request 向け）

> 下記テンプレを **PR 説明に貼る** と、修正タスクの意図が伝わります。

```
あなたは Tampermonkey スクリプトのリファクタリング/改修エンジニアです。
この PR の目的：<一文で>
要件：
- 予約ボタン検出の安定化（クラス変化に追随）
- 10月ページ送りの強化（JS パス最優先 + ハードクリック）
- 失敗モーダル検出時の強制リロード（最大 3 回）維持
制約：
- 外部ライブラリは追加しない（純 JS）
- メタデータブロックのキーは維持（@name/@version など）

作業内容（箇条書きで提案 → diff を提示してください）：
- [ ] セレクタを data-testid 優先に
- [ ] MutationObserver の属性監視を最小化
- [ ] nextMonthBtn のフォールバックを強化
- [ ] UI の文言修正
テスト観点：
- 初回描画遅延時の待機成功
- 10月ページ送り → 対象セル出現までの待機
- 予約完了/失敗モーダルの検出
```

## 注意

- `dist/expo2025-reserver.user.js` は **コミット対象** にしています（Tampermonkey 自動更新のため）。
- `@updateURL`/`@downloadURL` は `npm run build` で **自動注入**されるため、
  `src` のメタデータには `__RAW_URL__` 等のプレースホルダが入っています。
