# Deploy no Koyeb

Este projeto roda no Koyeb via `Dockerfile`.

## 1) Banco de dados (recomendado)

Para nao perder votos em redeploy/restart, use Postgres:

- Crie um Postgres (Koyeb Postgres ou outro provider).
- Copie a connection string e configure `DATABASE_URL`.
- Se o provider exigir TLS, mantenha `PG_SSL=true` (padrao). Se der erro de certificado (ex: self-signed), configure `PG_SSL_REJECT_UNAUTHORIZED=false`.

Alternativa (sem montar URL): defina as variaveis separadas (Koyeb mostra isso na aba `.env` do Database):
- `DATABASE_HOST`
- `DATABASE_PORT` (opcional, padrao 5432)
- `DATABASE_USER`
- `DATABASE_PASSWORD`
- `DATABASE_NAME`

## 2) Criar o serviço (Git + Dockerfile)

No Koyeb:
- Crie um **Web Service** a partir do seu repo Git.
- Builder: **Dockerfile** (o repo ja tem `Dockerfile`).
- Porta: o app usa `PORT` e escuta em `0.0.0.0`.
- Healthcheck: `GET /healthz`.

Variaveis sugeridas:
- `VOTER_SALT` (Secret)
- `COOKIE_SECURE=true`
- `DATABASE_URL=...` (Postgres)

## 3) Uploads (imagens)

Hoje os uploads vao para uma pasta local (`UPLOADS_DIR`).

Opcoes:
- Se voce tiver volume persistente: `UPLOADS_DIR=/data/uploads`.
- Sem volume: os arquivos podem sumir em restart/redeploy. Para producao, o ideal e migrar uploads para um storage (S3/R2/etc).

## 4) Escalabilidade

Com SQLite/arquivos locais, evite mais de 1 replica (cada replica teria seu proprio `data.db` / `uploads`).
Com Postgres (e uploads em storage), voce pode escalar horizontalmente.
