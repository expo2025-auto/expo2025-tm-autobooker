# expo2025-reserver.user.js 通常版仕様まとめ

## 1. 概要
- Expo 2025 来場予約サイト（`https://ticket.expo2025.or.jp/*`）向けTampermonkeyスクリプト。`@run-at document-idle`で動作し、`SCRIPT_VERSION`は`GM_info`から取得して未定義時は`dev`を用いる。日時選択と再試行・リロード制御を自動化し、利用者のページ更新操作も支援する。【F:expo2025-reserver.user.js†L1-L44】

## 2. 基盤ユーティリティ
- `Lget` / `Lset` / `Sget` / `Sset`で`localStorage`・`sessionStorage`をJSON形式で読み書きし、`Q`/`A`のDOMラッパーや`D`・`vis`の活性/可視判定、`KC`のクリック補助など共通ユーティリティを提供する。`waitUntil`は`MutationObserver`とポーリングを併用して条件成立を待ち、`safeReload`は複数フォールバックで安全に再読み込みする。【F:expo2025-reserver.user.js†L16-L43】
- `parseTimeLikeString`は「午前/午後」「HH:MM」「○時○分」表記を解析し、`extractSlotTime`は`time[datetime]`・`data-*`・ARIA属性・テキストを総当たりしてスロット時刻を抽出する。これによりUI上の時刻表示と内部キーを一致させる。【F:expo2025-reserver.user.js†L45-L146】

## 3. 設定・状態保持と初期化
- `CONF_KEY=nr_conf_v1`に日付配列`conf.dates`と希望時間キー`conf.times`を保存する。時間帯は`TIME_CHOICES`（9/10/11/12/17時）で定義し、`normalizeTimeKeys`が有効キーのみを昇順に整列する。全時間帯選択判定は`includesAllTimeKeys`で行う。【F:expo2025-reserver.user.js†L45-L123】【F:expo2025-reserver.user.js†L598-L620】
- `STATE_KEY=nr_state_v1`は`state.r`（自動予約ON/OFF）、`keepAlive`、`switchEnabled`、`switchTime`、`switchNextAt`を保持し、旧キー（`retryMinuteKey`等）を削除して互換性を保つ。`keepAlive`と`r`の同時有効は抑止し、`saveState`で都度セッション保存する。【F:expo2025-reserver.user.js†L148-L177】
- `cloneReservationInfo`と`reservationInfoEquals`でISO日付・スロットキー・時刻を比較し、`setCurrentReservationDisplay`/`setAttemptReservationDisplay`でUIの予約表示を更新する。`initialSelectionState`が初期選択を記録し、`captureInitialSelection`や`markDateReselected`で再描画後も選択状態を復元する。【F:expo2025-reserver.user.js†L178-L236】【F:expo2025-reserver.user.js†L512-L593】

## 4. ログイン維持と指定時刻切替
- `keepAlive`有効時は5分ごとに`safeReload`を仕込み、`keepAliveRemainingSeconds`で残り秒数を算出してUIに表示する。`scheduleKeepAliveReload`がタイマー管理、`clearKeepAliveTimer`と`updateKeepAliveCountdownDisplay`が停止・表示更新を担う。【F:expo2025-reserver.user.js†L245-L276】
- `parseSwitchTimeString`と`computeNextSwitchAt`で指定時刻を解析し、`checkAutoSwitch`がサーバ時刻と比較して切替時刻に達したら`triggerSwitchToBooking`を実行する。KeepAliveモード解除と自動予約起動を安全に行い、日付未設定時はエラー表示で停止する。【F:expo2025-reserver.user.js†L277-L358】

## 5. 失敗検出と強制リロード制御
- `FAIL_KEY`で失敗回数（最大3回）を追跡し、`robustReload`は`window.stop`→`safeReload`→`location.replace`→`history.go(0)`→`location.href=`の多段フォールバックで再読み込みする。重複防止に`__reloading`フラグを利用。【F:expo2025-reserver.user.js†L364-L387】
- `hasFailToast`と`armFastFailReload`がMutationObserverで失敗モーダルの出現を監視し、検出次第`robustReload`を発火させる。手動リロード時は`ensureForceScanAtLeast(1)`で強制スキャン回数を増やす。【F:expo2025-reserver.user.js†L388-L432】
- `FORCE_SCAN_KEY`を`ensureForceScanAtLeast`/`consumeForceScan`で管理し、リロード直後も最低回数の探索を行わせる。満席 (`ng`) 結果時には`ensureForceScanAtLeast(2)`で次回サイクルの探索強度を引き上げる。【F:expo2025-reserver.user.js†L370-L375】【F:expo2025-reserver.user.js†L1223-L1229】

## 6. カレンダー描画と日付選択ロジック
- `getCalendarRoot`が複数セレクタを試行してカレンダーDOMを取得し、`waitCalendarReady`が日付セルやヘッダー生成と140msの静穏期間を待つ。描画が安定してから日付操作を開始する設計。【F:expo2025-reserver.user.js†L434-L469】
- `getCellByISO`は`time[datetime]`属性と可視状態を基にセルを特定し、`isDateCellEnabled`が`aria-disabled`や満席アイコンで活性判定する。`ensureDate`は再選択が必要な場合にスクロールとクリックを繰り返し、`waitUntil`で選択完了を検証する。無効セルは一定時間待機し、それでも無効なら`false`を返す。【F:expo2025-reserver.user.js†L470-L596】
- 10月枠向けの`showMonthForISO`は`hardClick`と`findNextBtn`でページ送りボタンを探索し、最大3ラウンド監視して目標月の表示を確認後に140msの猶予を置く。遅延描画にも対応できるよう調整されている。【F:expo2025-reserver.user.js†L981-L1055】【F:expo2025-reserver.user.js†L1082-L1120】

## 7. 時間帯スロット選択
- `collectSlotElements`でスロットDOMを重複排除しつつ収集し、`extractSlotTime`の結果を`slotElementKey`で内部キーに変換する。`firstEnabledSlot` / `waitFirstEnabledSlot`が希望キー順に有効枠を探索し、全キー許容時は最初の有効枠を選ぶ。【F:expo2025-reserver.user.js†L597-L669】
- `ensureSlotSelectionByKey`は指定キーが選択されるまでクリックと待機を繰り返し、再選択要求がある場合は既存ボタンを再クリックして確定させる。許容キー一覧を渡した場合は`ensurePreferredSlotSelection`が調整役となる。【F:expo2025-reserver.user.js†L700-L770】
- `startSlotSelectionGuard`はMutationObserverと`setInterval`で選択状態を監視し、ターゲットキーが外れた瞬間に`ensureSlotSelectionByKey`を呼び直す。`onChange`コールバックでUI表示も追従する。【F:expo2025-reserver.user.js†L771-L809】【F:expo2025-reserver.user.js†L1210-L1220】

## 8. 予約確定シーケンス
- `flowConfirm`は候補ボタンをスコア付けしながら探索し、テキスト・ARIA・`data-message-code`を正規化して「設定」「変更」「次へ」などのヒント語でマッチングする。クリック済みボタンを`Set`で除外し、`waitTypeSelectionPage`で券種選択画面遷移を検知する。【F:expo2025-reserver.user.js†L810-L970】
- `waitOutcome`は成功モーダル・失敗モーダル・券種選択ページ表示を待ち、`ok`/`ng`/`typeSelect`/`none`を返す。【F:expo2025-reserver.user.js†L961-L979】
- `tryOnceForDate`は日付確定→スロット確保→`flowConfirm`→`waitOutcome`の流れをまとめ、UIへ候補スロットを表示する。満席 (`ng`) 結果では`ensureForceScanAtLeast(2)`で次サイクルの探索強度を上げる。【F:expo2025-reserver.user.js†L1100-L1235】

## 9. サーバ時刻同期とリロード戦略
- `syncServer`は`HEAD /`で`Date`ヘッダを取得し、`serverOffset`を算出する。60秒以内の再取得を抑制し、並行実行は`pendingServerSync`で共有する。`serverNow`・`secondsInMinute`・`delayUntilNextMinute_15s`で15秒トリガーの待機時間を算出する。【F:expo2025-reserver.user.js†L1238-L1266】
- `FORCED_RELOAD_KEY`に分単位の`minute`と`count`を保存し、`incrementForcedReload`が1分あたり最大3回まで強制リロードを許容する。`scheduleRetryOrNextMinute`はサーバ時刻が25秒未満かつ回数未満なら即リロードし、閾値超過時は次の15秒まで待機して`safeReload`を予約する。【F:expo2025-reserver.user.js†L1267-L1292】

## 10. UIウィジェット構成とイベント
- 固定配置のカードUIに自動予約トグル、ログイン維持トグル、指定時刻入力、現在時刻表示、時間帯チェックボックス、日付追加フォーム、選択日チップ、ステータス表示、変更先候補表示を備える。フォントや影などのスタイルもスクリプト側で指定している。【F:expo2025-reserver.user.js†L1294-L1380】
- 入力イベント:
  - 自動予約トグルON時に日付・時間帯設定を検証し、KeepAliveが有効なら解除した上で`runCycle`を即実行する。OFF時は`state.r=false`にして強制リロードカウンタをリセットし、UIを停止状態へ戻す。【F:expo2025-reserver.user.js†L1381-L1388】
  - KeepAliveトグルONで`state.r`を停止し、`scheduleKeepAliveReload`と`checkAutoSwitch`を起動する。OFF時は`switchEnabled`や`switchNextAt`も解除してステータスを再計算する。【F:expo2025-reserver.user.js†L1384-L1388】
  - 指定時刻トグル／入力変更時は`state.switchTime`と`switchNextAt`を更新し、無効値なら即解除する。KeepAlive中はステータス更新と`checkAutoSwitch`再評価を行う。【F:expo2025-reserver.user.js†L1388-L1390】
- `renderChips`・`add.onclick`で日付リストを編集し、`formatReservationText`が「変更先候補: YYYY/MM/DD HH:MM」形式で表示する。`ui.setStatus`は`lastStatusText`を監視して重複更新を抑制し、`ui.uncheck`で外部から自動予約トグルをオフにできる。【F:expo2025-reserver.user.js†L1383-L1424】

## 11. メインループとリトライ制御
- `runCycle`は券種選択ページ表示、成功モーダル表示、失敗モーダル表示中、`state.r`がfalse、`keepAlive`中といった条件で早期リターンし、該当しない場合のみ探索に進む。【F:expo2025-reserver.user.js†L1434-L1445】
- サーバ時刻で15秒未満は待機、25秒以上は次分へ回し、15〜25秒帯で空き枠探索を実行する。対象日リストを可視性と活性度で優先順位付けし、`tryOnceForDate`で予約試行を行う。成功時は`stopOK`で自動停止、券種選択遷移はステータス表示のみ、満席時は`ensureForceScanAtLeast(2)`で次サイクルを強化する。【F:expo2025-reserver.user.js†L1454-L1535】
- 探索終了後は`resetForcedReload`でカウンタをクリアし、次の15秒まで`safeReload`をタイマー登録する。`stopOK`は自動停止とUI更新、強制リロードカウンタのリセットを一括で処理する。【F:expo2025-reserver.user.js†L1435-L1436】【F:expo2025-reserver.user.js†L1530-L1535】

## 12. トレース・監視機能
- `state.keepAlive`がONの初期状態では即ステータスを更新し、`syncServer({force:true})`と250ms周期の時計更新・`checkAutoSwitch`を開始する。【F:expo2025-reserver.user.js†L1394-L1395】【F:expo2025-reserver.user.js†L1428-L1432】
- `window.__nrTrace`トレースは月送りボタンのクリック時刻とターゲット日セル表示時刻を計測し、既存インスタンスがあれば再初期化せずログ出力のみ行う。【F:expo2025-reserver.user.js†L1539-L1570】
- 手動リロード検知や強制スキャンカウンタとUIステータス更新を組み合わせ、利用者が再試行回数と状態を把握できるようにする。【F:expo2025-reserver.user.js†L423-L432】【F:expo2025-reserver.user.js†L1521-L1528】
