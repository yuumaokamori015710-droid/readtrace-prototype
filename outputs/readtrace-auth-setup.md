# Google Auth Setup

## 現在の状態

- ReadTrace専用Supabaseを作成済み。既存アプリの設定・テーブルは変更していません。
- 組織: `yuumaokamori015710-droid's Org` / `ouzwucyjczohodqijfkd`
- プロジェクト: `readtrace` / `jjoqjdfldryeqblpobhh` / 東京 `ap-northeast-1`
- 作成時の見積もり: USD 0 / 月。将来のプラン変更や使用量まで無料を保証するものではありません。
- アプリは公開可能なpublishable keyのみを使用。Google Client Secret、service_roleキーはソース・GitHub Pagesに保存しません。
- 調査開始時、Googleプロバイダーは公開設定APIで `false` でした。現在のアプリは実際のプロバイダー設定を起動時・ログイン時に確認し、有効な場合にだけGoogle認証を開始します。フロントエンドのフラグを書き換えただけで完成とは扱いません。
- 2026-11-06: 所有者がGoogle OAuthクライアントを作成し、SupabaseへClient ID/Secretを登録済みです。明示的な許可後にGoogle providerを有効化し、公開設定APIの `external.google: true` と実Googleログインを確認しました。
- Site URLとRedirect URLは本番HTMLの完全一致URLを設定済みです。登録されたRedirect URLは1件で、ワイルドカードや開発用URLは追加していません。
- 実Googleユーザーでクラウド保存・更新・再読み込み・別タブ復元・ログアウト・共有先へ再ログイン後に戻ることを確認しました。iPhone Safari実機や二端末・別Googleアカウントの検証は未実施です。
- Google Auth Platformの対象はExternal / Testingです。基本プロフィールとメールだけを使うGoogleログインは、テストユーザー限定・7日失効の例外です。ブランド名や独自ドメイン向けの公開設定は別途整備します。

## 再設定時の手順

### Google Auth Platform

1. 自分のGoogle CloudプロジェクトでGoogle Auth Platformを開きます。
2. アプリ名をReadTraceとし、連絡先・対象ユーザーを設定します。一般公開するならExternal / In productionにします。Google側で必要となるブランド確認やポリシーを満たしてください。
3. 利用する情報は `openid`、`userinfo.email`、`userinfo.profile` の基本プロフィールだけです。Drive、Gmailなどの権限は追加しません。
4. Web application用のOAuthクライアントを作成します。

Authorized JavaScript origins（現在は本番の1件のみ登録）:

```text
https://yuumaokamori015710-droid.github.io
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

Redirect URLs (Supabaseからアプリへ戻るURL、現在登録済みの完全一致URL):

```text
https://yuumaokamori015710-droid.github.io/readtrace-prototype/reading-prototype.html
```

全ドメインに一致するワイルドカードは登録しません。ローカル認証を使うときだけ、必要なlocalhost/127.0.0.1の完全一致URLを明示的に追加してください。

## 有効化と確認

1. `/auth/v1/settings` の `external.google` がtrueになったことを確認します。
2. アプリを再読み込みします。実際のプロバイダー設定が自動反映されます。サーバーの秘密情報をフロントへ追加する必要はありません。
3. 公開URLでGoogleの同意画面を経てログインできること、Supabase Auth Usersに対象ユーザーが存在することを確認します。
4. 空の自分の棚、再読み込み後のログイン保持、ログアウトを実際に確認します。
5. ログアウト状態で `#/share/...` を開き、ログイン後にその画面に戻ることを確認します。

認証コードはPKCEで一度だけ交換し、`getUser()`で認証サーバーに本人確認します。戻り先は既知のアプリ内ルートのみ許可し、認証コード・エラー・古いimplicit-flowトークンはURLから除去します。セッションの自動更新と他タブのサインアウトにも追従します。

## 認証と記録の保存を混同しない

Googleユーザーの棚・感想・交流をSupabase Postgresへ保存し、RLSで公開範囲を制御します。実Googleログインと記録のDB保存・復元まで確認済みです。ゲストとデモは別の端末内保存のままです。二端末同期・iPhone Safari実機の検証はまだ必要です。最新の構成・検証・Google Booksキー設定は `production-status.md` を参照してください。

## 独自ドメインへの変更

同じSupabaseプロジェクトを継続すれば、ユーザーとクラウド記録を維持できます。GitHub PagesのCustom domain/DNS/HTTPS、Supabase Site URL/Redirect URL、書誌Edge Functionの許可Origin、Google側の必要な生成元・ブランドURLを更新します。GoogleからSupabaseへ戻るcallback URLは同じです。新しいOriginでは再ログインが必要で、旧Originのゲスト記録は事前にクラウドへ取り込んでください。

## 参照

- https://supabase.com/docs/guides/auth/social-sign-in/auth-google
- https://supabase.com/docs/guides/auth/sessions/pkce-flow
- https://supabase.com/docs/guides/auth/redirect-urls
- https://support.google.com/cloud/answer/15549945
- SDK: `@supabase/supabase-js` 2.119.0 (公式npmパッケージを同梱)
