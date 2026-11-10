// エラーの種類（通知で、何をすればよいかを伝えるために分けている） "use strict";
/* code の意味：
   config   … 設定の問題（秘密情報が未登録・パスワードが変わった など）。やり直しても直らない → 人が直す
   auth     … Google の許可が切れた・取り消された（再認可が必要）
   notfound … 共有ファイルがドライブに見つからない
   data     … 共有ファイルの中身が読めない（同期の途中など。次回の実行で直ることが多い）
   drive    … Google ドライブ側のエラー
   transient… 一時的な通信の失敗（自動でやり直す） */
export class BackupError extends Error{
  constructor(code,message,extra){
    super(message);
    this.name="BackupError";
    this.code=code;
    this.retryable=code==="transient"||(extra&&extra.retryable)===true;
    if(extra&&extra.status)this.status=extra.status;
  }
}