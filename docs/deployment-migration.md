# Dokumentasi Backup, Migrasi, dan Deploy Digital Menu

Dokumen ini menjelaskan proses memindahkan database dan aplikasi Digital Menu dari VPS lama ke VPS baru, lalu menjalankannya pada subdomain production.

Contoh subdomain yang digunakan:

```text
foodrec.plvpilot.space
```

> Jangan menuliskan password, token, private key, atau isi `.env` ke Git, chat, screenshot, maupun dokumentasi.

## 1. Backup database di VPS lama

Project menggunakan MongoDB. Backup berikut mengambil seluruh database `digital_menu`, termasuk collection `unitconversions`.

Pastikan `mongodump` tersedia dan MongoDB dapat diakses.

```bash
mkdir -p /root/backup/digital-menu-backup-last

mongodump \
  --uri="mongodb://localhost:27017/digital_menu" \
  --out="/root/backup/digital-menu-backup-last"
```

Verifikasi backup:

```bash
du -sh /root/backup/digital-menu-backup-last
ls -lah /root/backup/digital-menu-backup-last/digital_menu
```

Collection conversion berada di:

```text
digital_menu/unitconversions.bson
```

Jika hanya ingin mem-backup conversion:

```bash
mongodump \
  --uri="mongodb://localhost:27017/digital_menu" \
  --collection=unitconversions \
  --out="/root/backup/conversion"
```

## 2. Kompres dan transfer backup

Di VPS lama:

```bash
tar -czf /root/backup/digital-menu-backup-last.tar.gz \
  -C /root/backup digital-menu-backup-last
```

Di VPS baru, tarik backup melalui SSH:

```bash
mkdir -p /root/backup

scp root@IP_VPS_LAMA:/root/backup/digital-menu-backup-last.tar.gz \
  /root/backup/
```

Jika SSH menggunakan port khusus:

```bash
scp -P PORT_SSH root@IP_VPS_LAMA:/root/backup/digital-menu-backup-last.tar.gz \
  /root/backup/
```

Extract di VPS baru:

```bash
tar -xzf /root/backup/digital-menu-backup-last.tar.gz \
  -C /root/backup
```

## 3. Install dependency VPS baru

Contoh berikut untuk Ubuntu/Debian.

```bash
apt update
apt install -y curl git tar build-essential gnupg wget
```

Install Node.js dan npm:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
```

Verifikasi:

```bash
node -v
npm -v
```

Install Redis:

```bash
apt install -y redis-server
systemctl enable --now redis-server
redis-cli ping
```

Hasil `redis-cli ping` harus `PONG`.

Install MongoDB Database Tools untuk `mongorestore` menggunakan repository resmi MongoDB:

```bash
wget -qO- https://www.mongodb.org/static/pgp/server-8.0.asc \
  | gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg

echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" \
  > /etc/apt/sources.list.d/mongodb-org-8.0.list

apt update
apt install -y mongodb-database-tools mongodb-org
systemctl enable --now mongod
```

Verifikasi:

```bash
mongorestore --version
systemctl status mongod --no-pager
```

## 4. Restore database di VPS baru

Restore ke database kosong atau database yang memang ditargetkan untuk migrasi:

```bash
mongorestore \
  --uri="mongodb://localhost:27017/digital_menu" \
  /root/backup/digital-menu-backup-last/digital_menu
```

Validasi hasil restore:

```bash
mongosh digital_menu --eval 'show collections'
```

Untuk restore ulang dan mengganti collection target, `--drop` dapat digunakan dengan sangat hati-hati karena akan menghapus collection target terlebih dahulu:

```bash
mongorestore --drop \
  --uri="mongodb://localhost:27017/digital_menu" \
  /root/backup/digital-menu-backup-last/digital_menu
```

## 5. Deploy source code

Clone repository ke VPS baru dan gunakan branch/tag yang akan dipakai production:

```bash
mkdir -p /var/www
cd /var/www
git clone URL_REPOSITORY digital-menu-react
cd /var/www/digital-menu-react
```

Install dan build backend:

```bash
cd /var/www/digital-menu-react/backend
npm ci
npm run build
```

Pada konfigurasi project saat ini, hasil build backend berada di:

```text
backend/dist/src/main.js
```

Install dan build frontend:

```bash
cd /var/www/digital-menu-react/frontend
npm ci
npm run build
```

## 6. Konfigurasi environment

Buat file environment backend dari template:

```bash
cd /var/www/digital-menu-react/backend
cp .env.example .env
nano .env
```

Nilai production minimal:

```env
NODE_ENV=production
PORT=3000
CORS_ORIGIN=https://foodrec.plvpilot.space
APP_BASE_URL=https://foodrec.plvpilot.space
MONGO_URI=mongodb://localhost:27017/digital_menu
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=SECRET_UNIK_DAN_PANJANG
JWT_REFRESH_SECRET=SECRET_UNIK_LAINNYA
S3_REGION=us-east-1
S3_ACCESS_KEY=ACCESS_KEY_ASLI
S3_SECRET_KEY=SECRET_KEY_ASLI
S3_BUCKET=digital-menu
S3_PUBLIC_BASE_URL=https://ALAMAT_STORAGE/digital-menu
EMAIL_NOTIFICATIONS_ENABLED=false
EMAIL_RECIPIENT_OVERRIDE=
EMAIL_FROM="Food Recipe System <alamat-email-asli>"
HOSTINGER_MAIL_API_TOKEN=TOKEN_ASLI
```

Untuk mempertahankan session/token lama, gunakan JWT secret yang sama dengan VPS lama. Jika JWT secret diganti, user harus login ulang.

S3/MinIO tidak ikut dalam backup MongoDB. Bucket dan file upload harus dipindahkan atau endpoint storage lama harus tetap dapat diakses dari VPS baru.

Frontend menggunakan API melalui path `/api` pada domain yang sama:

```bash
cd /var/www/digital-menu-react/frontend
printf 'VITE_API_URL=https://foodrec.plvpilot.space/api\n' > .env
npm run build
```

## 7. Jalankan backend dengan PM2

```bash
npm install -g pm2

cd /var/www/digital-menu-react/backend
pm2 start dist/src/main.js --name digital-menu-backend
pm2 save
pm2 startup
```

Jalankan perintah `sudo ...` yang ditampilkan oleh `pm2 startup`.

Validasi backend:

```bash
curl http://127.0.0.1:3000/health/live
pm2 status
pm2 logs digital-menu-backend --lines 50
```

## 8. Konfigurasi DNS

Buat DNS record:

```text
Type: A
Name: foodrec
Value: IP_VPS_BARU
```

Validasi dari VPS atau komputer lokal:

```bash
dig +short foodrec.plvpilot.space
```

## 9. Konfigurasi Nginx

Install Nginx dan Certbot:

```bash
apt install -y nginx certbot python3-certbot-nginx
systemctl enable --now nginx
```

Buat konfigurasi:

```bash
nano /etc/nginx/sites-available/foodrec
```

Isi:

```nginx
server {
    listen 80;
    server_name foodrec.plvpilot.space;

    root /var/www/digital-menu-react/frontend/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Aktifkan dan cek konfigurasi:

```bash
ln -s /etc/nginx/sites-available/foodrec /etc/nginx/sites-enabled/foodrec
nginx -t
systemctl reload nginx
```

Pasang SSL setelah DNS sudah mengarah ke VPS baru:

```bash
certbot --nginx -d foodrec.plvpilot.space
```

## 10. Smoke test production

```bash
curl -I https://foodrec.plvpilot.space
curl https://foodrec.plvpilot.space/api/health/live
```

Tes melalui browser:

- login dan logout;
- membuka recipe dan menu production;
- unit conversion;
- upload dan download file;
- email notification jika diaktifkan.

Jika muncul `502 Bad Gateway`, periksa backend:

```bash
pm2 status
pm2 logs digital-menu-backend --lines 100
curl http://127.0.0.1:3000/health/live
```

Jika muncul `ECONNREFUSED 127.0.0.1:6379`, Redis belum berjalan. Jika startup menolak nilai placeholder, perbaiki `.env` production dan restart:

```bash
pm2 restart digital-menu-backend --update-env
```

## 11. Cutover dan rollback

Jangan langsung menghapus VPS lama. Setelah VPS baru lolos smoke test:

1. Pastikan DNS menunjuk ke VPS baru.
2. Hentikan aplikasi di VPS lama agar tidak terjadi penulisan data atau pengiriman email ganda.
3. Biarkan VPS lama tetap tersedia sementara sebagai rollback.
4. Hapus VPS lama hanya setelah periode observasi selesai dan backup tervalidasi.

Backup MongoDB tidak mencakup object storage, file upload lokal, Redis queue, atau file `.env`. Komponen tersebut harus dipindahkan atau dikonfigurasi ulang secara terpisah.
