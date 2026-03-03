# digital-menu-react

## Project Structure

- `frontend`: React + Vite app
- `backend`: NestJS API
- `infra`: local dependencies (MongoDB, Redis, MinIO) for development

## Environment Setup

### Frontend

1. Copy `frontend/.env.example` to `frontend/.env`.
2. Set `VITE_API_URL` to your backend URL.

Notes:
- Production build now requires `VITE_API_URL`.

### Backend

1. Copy `backend/.env.example` to `backend/.env`.
2. Fill all required variables for database, Redis, S3, JWT, and SMTP.

## Local Validation Before Deploy

Run these checks:

```bash
cd frontend
npm run lint
npm run build

cd ../backend
npx eslint "{src,apps,libs,test}/**/*.ts"
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

## Production Compose Template

Use `docker-compose.prod.example.yml` as a template and provide environment values from your deploy system or `.env` file.

Minimum required values:
- `CORS_ORIGIN`
- `MONGO_URI`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `S3_ENDPOINT`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `S3_BUCKET`
- `S3_PUBLIC_BASE_URL`
- `EMAIL_FROM`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
