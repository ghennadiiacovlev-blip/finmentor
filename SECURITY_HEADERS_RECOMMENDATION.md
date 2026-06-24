# SECURITY_HEADERS_RECOMMENDATION.md

В архиве не найден deploy-конфиг (`_headers`, `netlify.toml`, `vercel.json`, `.htaccess` или Cloudflare Pages config), поэтому заголовки безопасности нужно добавить на уровне хостинга.

Рекомендуемые безопасные заголовки:

```text
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Content-Security-Policy не добавлен в код сайта, потому что текущая версия использует inline-стили, inline-скрипты, Google Tag Manager и Google Fonts. CSP лучше настраивать отдельно после тестирования, чтобы не сломать аналитику, формы, шрифты и интерактивные блоки.

Не рекомендуется добавлять anti-copy скрипты, блокировку правой кнопки мыши, запрет Ctrl+C, всплывающие предупреждения, noindex или блокировку индексации в `robots.txt`.
