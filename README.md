# digital-menu-react

Project ini isinya aplikasi Digital Menu Engineering.

Stack-nya dibagi jadi tiga bagian:

- `frontend` buat React + Vite
- `backend` buat API NestJS
- `infra` buat service lokal yang dibutuhin waktu development, terutama MongoDB, Redis, dan MinIO

## Menjalankan project secara lokal

Kalau di Windows, cara paling praktis biasanya pakai script yang sudah ada di root.

Sebelum itu:

1. copy `frontend/.env.example` jadi `frontend/.env`
2. copy `backend/.env.example` jadi `backend/.env`
3. install dependency di `frontend` dan `backend`
4. pastikan Docker Desktop sudah nyala

Setelah itu tinggal jalankan:

```powershell
.\start-digital-menu.bat
```

Script ini akan:

- menyalakan service di folder `infra`
- menjalankan backend dengan `npm run start:dev`
- menjalankan frontend dengan `npm run dev`

Default URL waktu local:

- frontend: `http://localhost:5173`
- backend: `http://localhost:3000`

Kalau mau stop semuanya:

```powershell
.\stop-digital-menu.bat
```

## Kalau mau jalanin manual

Kalau lagi butuh troubleshoot atau memang pengen start satu-satu, biasanya saya jalanin begini:

```powershell
cd infra
docker compose up -d

cd ..\backend
npm install
npm run start:dev

cd ..\frontend
npm install
npm run dev
```

## Environment yang penting

Frontend simpel, yang paling penting cuma:

- `VITE_API_URL`

Backend lebih banyak karena nyambung ke database, redis, storage, dan email. Minimal jangan lupa isi:

- `PORT`
- `CORS_ORIGIN`
- `MONGO_URI`
- `REDIS_URL`
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

Contoh value awal sudah ada di `frontend/.env.example` dan `backend/.env.example`, jadi tinggal sesuaikan saja.

## Cek sebelum build atau deploy

Biasanya yang saya cek dulu minimal ini:

```powershell
cd frontend
npm run lint
npm run build

cd ..\backend
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

Kalau mau lint backend juga, sudah ada script:

```powershell
cd backend
npm run lint
```

## Catatan deploy

Di root ada `docker-compose.prod.example.yml` yang bisa dipakai sebagai starting point untuk compose production.

Backend juga sudah punya health check:

- `GET /health/live`
- `GET /health/ready`

Sisanya tinggal sesuaikan environment production, terutama untuk koneksi database, redis, object storage, JWT secret, dan SMTP.
