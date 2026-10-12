/**
 * PRT比較アンケート 回答受付用 Google Apps Script
 *
 * 設置手順:
 *  1. 回答保存用の Google スプレッドシートを作成（URL の /d/ と /edit の間が SPREADSHEET_ID）
 *  2. このファイルの内容を Apps Script に貼り付け、SHARED_TOKEN を任意の文字列に変更。
 *     スプレッドシートの「拡張機能 > Apps Script」から開いた場合は SPREADSHEET_ID は空のままでよい。
 *     script.google.com で単独に作った場合は SPREADSHEET_ID にスプレッドシートの ID を入れる。
 *  3. デプロイ > 新しいデプロイ > 種類「ウェブアプリ」
 *       実行ユーザー: 自分 / アクセスできるユーザー: 全員
 *  4. 発行された URL を GitHub リポジトリの Variables に VITE_SUBMIT_ENDPOINT として、
 *     SHARED_TOKEN と同じ値を VITE_SUBMIT_TOKEN として登録
 *
 * 1回の送信 = 1行（評価者×問題）。同じ問題を再送すると新しい行が追加され、
 * 集計スクリプト(decode-responses.mjs)が updated_at の最新を採用する。
 * 実トラック名はここには一切届かない（PRT-A/B/C と mapping_id のみ）。
 */
const SHARED_TOKEN = 'change-me'
const SPREADSHEET_ID = '' // 単独スクリプトの場合のみ設定
const SHEET_NAME = 'responses'
const MAX_BYTES = 200000

function doPost(e) {
  try {
    const body = e.postData && e.postData.contents
    if (!body || body.length > MAX_BYTES) return json_({ ok: false, error: 'invalid body' })
    const data = JSON.parse(body)
    if (data.token !== SHARED_TOKEN) return json_({ ok: false, error: 'invalid token' })
    const r = data.record
    if (!r || !r.evaluator_id || !r.problem_key || !r.prts) return json_({ ok: false, error: 'invalid record' })

    const lock = LockService.getScriptLock()
    lock.waitLock(10000)
    try {
      const sheet = getSheet_()
      sheet.appendRow([
        // タイムゾーン設定に依存しないよう、日本時間を明示した文字列で保存する（例: 2026-10-12T10:37:56+09:00）
        Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX"),
        String(r.evaluator_id),
        String(r.problem_key),
        String(r.mapping_id || ''),
        r.completed === true,
        String(r.updated_at || ''),
        JSON.stringify(r),
      ])
    } finally {
      lock.releaseLock()
    }
    return json_({ ok: true })
  } catch (err) {
    return json_({ ok: false, error: String(err) })
  }
}

function doGet() {
  return json_({ ok: true, service: 'prt-survey' })
}

function getSheet_() {
  const ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet()
  if (!ss) throw new Error('スプレッドシートを開けません。SPREADSHEET_ID を設定してください')
  let sheet = ss.getSheetByName(SHEET_NAME)
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME)
    sheet.appendRow(['received_at', 'evaluator_id', 'problem_key', 'mapping_id', 'completed', 'updated_at', 'payload'])
    sheet.setFrozenRows(1)
  }
  return sheet
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}
