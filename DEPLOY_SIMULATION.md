# Deploy Simulation

Production-like local test ini memakai Docker Compose terpisah dari workflow dev yang sudah ada. Fokusnya hanya runtime production, containerization, dan kemudahan cek resource usage.

## File Created or Updated

- `frontend/Dockerfile`
- `frontend/nginx.conf`
- `frontend/.dockerignore`
- `backend/.dockerignore`
- `infra/minio-cors.prodlike.xml`
- `docker-compose.prodlike.yml`
- `docker-compose.prodlike.env`
- `scripts/prodlike-up.bat`
- `scripts/prodlike-down.bat`
- `scripts/prodlike-logs.bat`
- `scripts/prodlike-stats.bat`

Backend memakai `backend/Dockerfile` yang sudah ada karena isinya sudah production-oriented: build NestJS lalu menjalankan `node dist/main.js`.

## Exact Commands

Run everything with one Docker Compose command:

```powershell
docker compose --env-file docker-compose.prodlike.env -f docker-compose.prodlike.yml up --build -d
```

Helper scripts on Windows:

```powershell
scripts\prodlike-up.bat
scripts\prodlike-down.bat
scripts\prodlike-logs.bat
scripts\prodlike-stats.bat
```

## URLs

- Frontend: `http://localhost:8080`
- Backend API: `http://localhost:3001`
- Backend health:
  - `http://localhost:3001/health/live`
  - `http://localhost:3001/health/ready`
- MinIO API: `http://localhost:9002`
- MinIO Console: `http://localhost:9003`

Presigned/object URLs for browser-facing file access use `http://minio.localhost:9002`.

MinIO credentials for this local simulation are defined in `docker-compose.prodlike.env`.

## Usage / Resource Checks

Compose status:

```powershell
docker compose --env-file docker-compose.prodlike.env -f docker-compose.prodlike.yml ps
```

Live resource usage:

```powershell
docker stats
```

Disk usage by Docker objects:

```powershell
docker system df
```

Logs:

```powershell
docker compose --env-file docker-compose.prodlike.env -f docker-compose.prodlike.yml logs -f
```

## Manual Test Flow

1. Start the stack and wait until `docker compose ... ps` shows the app services up.
2. Open the frontend at `http://localhost:8080`.
3. Login and navigate several pages that hit backend APIs.
4. If you want more realistic usage, perform flows that trigger:
   - authentication
   - listing pages with pagination
   - file upload / import flows
   - image access from MinIO
5. While testing, run `scripts\prodlike-stats.bat` or `docker stats`.
6. After the test session, inspect `docker system df` to estimate image, cache, and volume footprint.

## Notes

- Frontend production build is served by nginx, not Vite dev server.
- Frontend API calls are built with `VITE_API_URL=/api`, then proxied by nginx to the backend container.
- Backend CORS is still set for `http://localhost:8080` and `http://127.0.0.1:8080` so direct browser testing to the backend host port remains possible.
- MinIO bucket initialization is handled by `minio-init`.
- Backend resolves `minio.localhost` through Docker's host gateway so presigned MinIO URLs can be consumed by the host browser and by the backend container with the same hostname.
- MinIO bucket CORS is applied on a best-effort basis because the current local `minio/minio` + `minio/mc` image pair may reject the bucket CORS API even though the bucket itself is created correctly.
- Infra host ports are intentionally offset from common local defaults so this stack is less likely to collide with an existing dev setup on the same machine.
- This setup is for local simulation only. The env file contains local-only defaults and should not be reused as real deployment secrets.
