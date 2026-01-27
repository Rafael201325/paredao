# Migração: SQLite (local) -> Postgres (Koyeb)

Este guia copia os dados do `data.db` local (SQLite) para o Postgres do Koyeb.

## 0) Pré-requisitos

- Node.js instalado localmente
- Arquivo SQLite local (ex: `data.db`) com seus dados
- Credenciais do Postgres do Koyeb (aba `.env` em “Connection details” do Database)

## 1) Configure as variáveis do Postgres

Você pode usar **uma** dessas opções:

### Opção A (recomendada): `DATABASE_URL`

Defina `DATABASE_URL` com a connection string completa.

### Opção B: variáveis separadas (como o Koyeb mostra)

- `DATABASE_HOST`
- `DATABASE_PORT` (opcional, padrão 5432)
- `DATABASE_USER`
- `DATABASE_PASSWORD`
- `DATABASE_NAME`

Opcional:
- `PG_SCHEMA=app` (padrão do projeto)
- `PG_SSL=true` (padrão)
- `PG_SSL_REJECT_UNAUTHORIZED=false` (padrão)

## 2) Teste (dry-run) para ver quantos registros existem

PowerShell:
```powershell
$env:DATABASE_HOST="..."
$env:DATABASE_USER="..."
$env:DATABASE_PASSWORD="..."
$env:DATABASE_NAME="koyebdb"
$env:PG_SCHEMA="app"

npm run migrate:postgres -- --sqlite .\data.db --dry-run
```

## 3) Importar de verdade

```powershell
npm run migrate:postgres -- --sqlite .\data.db
```

## 4) Substituir tudo que já está no Postgres (wipe)

Isso apaga as tabelas do app e importa do zero:
```powershell
npm run migrate:postgres -- --sqlite .\data.db --wipe
```

## Problemas comuns

### `permission denied for schema ...`

Isso significa que o usuário do Postgres que você está usando não tem permissão de **CREATE** no schema escolhido.

Opções:
- Use um usuário/role com permissão de escrita (ver Database → Roles no Koyeb) e refaça a migração.
- Se as tabelas já existirem no schema (criadas por outro usuário), rode o script com `--skip-ddl`:
  ```powershell
  npm run migrate:postgres -- --sqlite .\data.db --skip-ddl
  ```
- Se você tiver um usuário “admin/owner”, crie um schema e conceda permissões para o usuário da aplicação (exemplo):
  ```sql
  CREATE SCHEMA IF NOT EXISTS app;
  GRANT USAGE, CREATE ON SCHEMA app TO "DATABASE_URL";
  ```

## Observações

- Uploads (imagens) **não** são migrados (no Koyeb Free não tem volume). Só ficam os caminhos/URLs salvos no banco.
- Se você rodar o script sem `--wipe`, ele usa `ON CONFLICT DO NOTHING` (não duplica quando houver conflito).
