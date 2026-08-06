# Paredão da Semana

Aplicação web full stack para gerenciamento de votações semanais, com painel administrativo, histórico, upload de imagens e persistência em SQLite ou PostgreSQL.

## Tecnologias

- Node.js
- Express
- JavaScript
- SQLite
- PostgreSQL
- Docker
- Multer

## Funcionalidades

### Área pública

- consulta da votação aberta;
- exibição dos três candidatos;
- registro de um voto por navegador;
- mensagens estruturadas para voto inválido ou duplicado.

### Administração

- criação de semanas;
- edição de candidatos;
- abertura e encerramento da votação;
- upload de imagens;
- consulta dos resultados;
- histórico das votações.

## Executar localmente

Requisitos: Node.js 18+ e npm.

```bash
npm install
npm run dev
```

Acessos:

```text
Aplicação:  http://localhost:3000/
Admin:      http://localhost:3000/admin
Healthcheck:http://localhost:3000/healthz
```

Por padrão, a aplicação utiliza SQLite. Para PostgreSQL, configure `DATABASE_URL` ou as variáveis separadas de conexão.

## Principais rotas

```text
GET  /api/public/status
POST /api/public/vote
POST /admin/weeks
POST /admin/weeks/:id/open
POST /admin/weeks/:id/close
PUT  /admin/weeks/:id/candidates
GET  /admin/weeks/:id/results
```

## Regras relevantes

- somente uma semana pode ficar aberta por vez;
- o voto é vinculado a um identificador anônimo com hash;
- votos duplicados retornam `409 Conflict`;
- candidatos inválidos retornam `400 Bad Request`;
- o banco pode operar localmente com SQLite ou em produção com PostgreSQL.

## Segurança e limitações

O projeto demonstra um protótipo funcional. O painel administrativo ainda não possui autenticação e não deve ser publicado em produção sem uma camada de controle de acesso.

Também há rate limit simples em memória e armazenamento local de uploads, que devem ser substituídos por soluções persistentes em um ambiente produtivo.

## Oportunidades para Quality Engineering

Este projeto é adequado para demonstrar:

- testes de API;
- validação de regras de votação;
- testes de concorrência e duplicidade;
- testes de upload;
- testes de persistência em diferentes bancos;
- segurança do painel administrativo;
- testes de performance e carga.

## Autor

**Rafael Siqueira**  
QA Engineer | Test Automation | APIs | Performance
