# Google Auth Setup

## 現在の状態

- ReadTrace専用Supabaseを作成済み。既存アプリの設定・テーブルは変更していません。
- 組織: `yuumaokamori015710-droid's Org` / `ouzwucyjczohodqijfkd`
- プロジェクト: `readtrace` / `jjoqjdfldryeqblpobhh` / 東京 `ap-northeast-1`
- 作成時の見積もり: USD 0 / 月。将来のプラン変更や使用量まで無料を保証するものではありません。
- アプリは公開可能なpublishable keyのみを使用。Google Client Secret、service_roleキーはソース・GitHub Pagesに保存しません。
- 調査開始時、Googleプロバイダーは公開設定APIで `false` でした。現在のアプリは実際のプロバイダー設定を起動時・ログイン時に確認し、有効な場合にだけGoogle認証を開始します。フロントエンドのフラグを書き換えただけで完成とは扱いません。
- 管理画面へのログイン待ちです。管理用ログインと、アプリ利用者のGoogleログインは別物です。

## 管理画面で残っている設定

### Google Auth Platform

1. 自分のGoogle CloudプロジェクトでGoogle Auth Platformを開きます。
2. アプリ名をReadTraceとし、連絡先・対象ユーザーを設定します。一般公開するならExternal / In productionにします。Google側で必要となるブランド確認やポリシーを満たしてください。
3. 利用する情報は `openid`、`userinfo.email`、`userinfo.profile` の基本プロフィールだけです。Drive、Gmailなどの権限は追加しません。
4. Web application用のOAuthクライアントを作成します。

Authorized JavaScript origins:

```text
https://yuumaokamori015710-droid.github.io
http://127.0.0.1:8011
http://localhost:8011
```

Authorized redirect URI (GoogleからSupabaseへ戻るURL):

```text
https://jjoqjdfldryeqblpobhh.supabase.co/auth/v1/callback
```

Client ID / Client Secretの作成・入力は所有者が管理画面上で行ってください。チャットやGitに貼り付けないでください。

### Supabase Auth

Google provider:
https://supabase.com/dashboard/project/jjoqjdfldryeqblpobhh/auth/providers

GoogleのClient ID / Client Secretを設定し、Google providerを有効化します。nonceチェックやメール確認の保護は無効にしません。

URL Configuration:
https://supabase.com/dashboard/project/jjoqjdfldryeqblpobhh/auth/url-configuration

Site URL:

```text
https://yuumaokamori015710-droid.github.io/readtrace-prototype/reading-prototype.html
```

Redirect URLs (Supabaseからアプリへ戻るURL、完全一致):

```text
https://yuumaokamori015710-droid.github.io/readtrace-prototype/reading-prototype.html
http://127.0.0.1:8011/reading-prototype.html
http://localhost:8011/reading-prototype.html
```

全ドメインに一致するワイルドカードは登録しません。不要になった開発用URLは削除してください。

## 有効化と確認

1. `/auth/v1/settings` の `external.google` がtrueになったことを確認します。
2. アプリを再読み込みします。実際のプロバイダー設定が自動反映されます。サーバーの秘密情報をフロントへ追加する必要はありません。
3. 公開URLでGoogleの同意画面を経てログインできること、Supabase Auth Usersに対象ユーザーが存在することを確認します。
4. 空の自分の棚、再読み込み後のログイン保持、ログアウトを実際に確認します。
5. ログアウト状態で `#/share/...` を開き、ログイン後にその画面に戻ることを確認します。

認証コードはPKCEで一度だけ交換し、`getUser()`で認証サーバーに本人確認します。戻り先は既知のアプリ内ルートのみ許可し、認証コード・エラー・古いimplicit-flowトークンはURLから除去します。セッションの自動更新と他タブのサインアウトにも追従します。

## 認証と記録の保存を混同しない

現在はGoogleユーザーの棚・感想・交流をSupabase Postgresへ保存する実装とRLSを追加しています。ゲストとデモは別の端末内保存のままです。所有者によるGoogle認証設定と、実アカウントでのログイン・二端末同期の検証がまだ必要です。最新の構成・検証・Google Booksキー設定は `production-status.md` を参照してください。

## 参照

- https://supabase.com/docs/guides/auth/social-sign-in/auth-google
- https://supabase.com/docs/guides/auth/sessions/pkce-flow
- https://supabase.com/docs/guides/auth/redirect-urls
- SDK: `@supabase/supabase-js` 2.119.0 (公式npmパッケージを同梱)
