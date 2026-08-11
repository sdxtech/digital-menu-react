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
- `APP_BASE_URL`
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
- `EMAIL_NOTIFICATIONS_ENABLED`
- `EMAIL_RECIPIENT_OVERRIDE`
- `HOSTINGER_MAIL_API_TOKEN`
- `HOSTINGER_MAILBOX_ID` jika mailbox tidak ingin dicari otomatis dari `EMAIL_FROM`

Contoh value awal sudah ada di `frontend/.env.example` dan `backend/.env.example`, jadi tinggal sesuaikan saja.

### Email notification dengan Hostinger Mail API

Backend mengirim email secara asynchronous melalui BullMQ/Redis dan Hostinger Mail API melalui HTTPS port 443.

Konfigurasinya:

```env
APP_BASE_URL=http://localhost:5173
EMAIL_NOTIFICATIONS_ENABLED=true
EMAIL_RECIPIENT_OVERRIDE=developer@example.com
EMAIL_FROM="Food Recipe System <no-reply@your-domain.com>"
HOSTINGER_MAIL_API_TOKEN=your_hostinger_mail_api_token
HOSTINGER_MAILBOX_ID=
```

Jika `HOSTINGER_MAILBOX_ID` kosong, backend memanggil `GET /api/v1/me` sekali lalu mencari mailbox yang alamatnya sama dengan `EMAIL_FROM`. Isi resource ID mailbox secara eksplisit jika `EMAIL_FROM` menggunakan alias yang tidak muncul pada respons tersebut. Endpoint pengiriman Hostinger saat ini tidak menyediakan field Reply-To atau custom headers.

`EMAIL_RECIPIENT_OVERRIDE` mengalihkan seluruh email ke alamat developer saat pengujian. Variabel ini wajib dikosongkan di production. Token Hostinger hanya boleh disimpan di environment backend dan tidak boleh masuk Git atau frontend. Buat token di hPanel dengan akses hanya ke mailbox pengirim yang dibutuhkan aplikasi.

Untuk production, minimal sesuaikan:

```env
APP_BASE_URL=https://plvpilot.space
EMAIL_NOTIFICATIONS_ENABLED=true
EMAIL_RECIPIENT_OVERRIDE=
EMAIL_FROM="Food Recipe System <no-reply@your-domain.com>"
HOSTINGER_MAIL_API_TOKEN=your_hostinger_mail_api_token
HOSTINGER_MAILBOX_ID=
```

Event email workflow:

- recipe submit/resubmit: Unit Manager aktif pada site yang sama;
- recipe approved/rejected: hanya Chef pembuat;
- menu production submit: Unit Manager yang ditugaskan, dengan fallback ke Unit Manager aktif pada site;
- menu production review selesai: Chef pembuat dan, jika ada menu approved, Storekeeper pada site yang sama.

Menu production bulk mengirim satu ringkasan per `productionCode` setelah seluruh item dalam batch selesai direview. Pengiriman memiliki retry dan deduplikasi job antrean untuk mengurangi email duplikat.

Test transport email tersedia untuk Superadmin:

```http
POST /superadmin/test-email
Content-Type: application/json
Authorization: Bearer <superadmin-access-token>

{"to":"developer@example.com"}
```

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

Sisanya tinggal sesuaikan environment production, terutama untuk koneksi database, Redis, object storage, JWT secret, dan Hostinger Mail API.
