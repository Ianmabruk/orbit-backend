# Serve API

## Local database

Start Postgres locally:

```bash
cd apps/api
docker compose up -d
```

Then initialize the Prisma schema:

```bash
npx prisma generate
npx prisma migrate dev --name init
```

## Run the API

```bash
npm --workspace apps/api run dev
```
