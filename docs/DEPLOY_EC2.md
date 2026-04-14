# Deploy Link Nest On EC2

Last updated: 2026-04-14

This guide explains how to deploy Link Nest on an Ubuntu EC2 instance with:

- Node.js
- MongoDB
- Nginx as a reverse proxy
- systemd for process management

This version is written against the current codebase and environment variable names.

## What this guide assumes

- Ubuntu 24.04 on EC2
- one Linux user such as `ubuntu`
- Node.js 22 or newer
- MongoDB running on the same instance or reachable privately
- Link Nest served behind Nginx
- HTTPS enabled before exposing the app publicly

## 1. Connect to the server

```bash
ssh -i /path/to/your-key.pem ubuntu@YOUR_EC2_PUBLIC_IP
```

## 2. Install system packages

```bash
sudo apt-get update
sudo apt-get install -y nginx git curl gnupg ca-certificates
```

## 3. Install Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Verify:

```bash
node -v
npm -v
```

## 4. Install MongoDB 8.0

If you want MongoDB on the same machine:

```bash
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | \
  sudo gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor

echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list

sudo apt-get update
sudo apt-get install -y mongodb-org
sudo systemctl enable mongod
sudo systemctl start mongod
```

Check status:

```bash
sudo systemctl status mongod
```

Default local MongoDB address:

```text
mongodb://127.0.0.1:27017
```

If you use MongoDB Atlas or another remote database, skip local MongoDB install and use that connection string in `.env`.

## 5. Clone the project

```bash
cd ~
git clone https://github.com/minkonaing99/Link-Vault.git link-vault
cd ~/link-vault
```

## 6. Install app dependencies

```bash
npm install
```

## 7. Create the production environment file

Create `.env` in the project root:

```bash
nano .env
```

Example for local MongoDB:

```bash
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB_NAME=linknest
PORT=3080
AUTH_COOKIE_NAME=linknest_session
AUTH_SESSION_TTL_DAYS=30
ACCESS_TOKEN_TTL_MINUTES=15
REFRESH_TOKEN_TTL_DAYS=30
JWT_TTL_DAYS=30
JWT_SECRET=replace-with-a-long-random-secret-at-least-32-characters
LINKNEST_ADMIN_USERNAME=
LINKNEST_ADMIN_PASSWORD=
TRUSTED_PROXY=true
COOKIE_SECURE=true
NODE_ENV=production
```

Example for MongoDB Atlas:

```bash
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@YOUR-CLUSTER.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=linknest
PORT=3080
AUTH_COOKIE_NAME=linknest_session
AUTH_SESSION_TTL_DAYS=30
ACCESS_TOKEN_TTL_MINUTES=15
REFRESH_TOKEN_TTL_DAYS=30
JWT_TTL_DAYS=30
JWT_SECRET=replace-with-a-long-random-secret-at-least-32-characters
LINKNEST_ADMIN_USERNAME=
LINKNEST_ADMIN_PASSWORD=
TRUSTED_PROXY=true
COOKIE_SECURE=true
NODE_ENV=production
```

### Important notes

- use `LINKNEST_ADMIN_USERNAME` and `LINKNEST_ADMIN_PASSWORD`, not `LINKVAULT_*`
- the current app default port is `3080`, not `3090`
- `JWT_SECRET` must be at least 32 characters
- `COOKIE_SECURE=true` is correct when you serve the app over HTTPS
- `TRUSTED_PROXY=true` should only be used when Nginx is actually in front of the app

Generate a strong secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 8. Test the app manually first

Before creating a systemd service, make sure the app starts cleanly:

```bash
npm start
```

You should see logs similar to:

```text
Link Nest running at http://localhost:3080
Using MongoDB database: linknest.links
Auth enabled with cookie sessions, bearer access tokens, and refresh tokens.
```

Stop it with `Ctrl+C` after confirming it works.

## 9. Create a systemd service

Create the service file:

```bash
sudo nano /etc/systemd/system/linknest.service
```

Use this:

```ini
[Unit]
Description=Link Nest
After=network.target mongod.service
Wants=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/link-vault
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /home/ubuntu/link-vault/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

If your Linux username is not `ubuntu`, change both paths and the `User=` value.

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable linknest
sudo systemctl restart linknest
sudo systemctl status linknest
```

View logs:

```bash
journalctl -u linknest -n 100 --no-pager
```

## 10. Configure Nginx as a reverse proxy

Create the Nginx site config:

```bash
sudo nano /etc/nginx/sites-available/linknest
```

Use:

```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_IP;

    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/linknest /etc/nginx/sites-enabled/linknest
sudo nginx -t
sudo systemctl restart nginx
```

Then test in a browser:

```text
http://YOUR_DOMAIN_OR_IP
```

## 11. Add HTTPS with Let's Encrypt

Do this before you treat the deployment as public.

Install Certbot:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
```

Request the certificate:

```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

After HTTPS is enabled, keep:

```bash
COOKIE_SECURE=true
```

## 12. EC2 security group rules

Allow only the ports you need:

- `22` for SSH
- `80` for HTTP
- `443` for HTTPS

Do not expose MongoDB publicly.

If MongoDB runs on the same machine, it should stay bound to localhost only.

## 13. Update the app later

```bash
cd ~/link-vault
git fetch origin
git reset --hard origin/main
npm install
sudo systemctl restart linknest
```

Check logs after deploy:

```bash
journalctl -u linknest -n 100 --no-pager
```

## 14. Useful commands

Check app status:

```bash
sudo systemctl status linknest
```

Restart app:

```bash
sudo systemctl restart linknest
```

View app logs:

```bash
journalctl -u linknest -n 100 --no-pager
```

Check MongoDB:

```bash
sudo systemctl status mongod
```

Check Nginx:

```bash
sudo systemctl status nginx
```

Test Nginx config:

```bash
sudo nginx -t
```

## 15. Recommended production hardening

Do these before trusting the deployment:

- use HTTPS, not plain HTTP
- use a strong admin password
- rotate any secrets used during testing
- keep MongoDB private
- enable automatic security updates if appropriate
- back up the MongoDB database
- monitor `journalctl` and Nginx logs after deploy

## 16. Common deployment mistakes

### Wrong environment variable names

The current app expects:

- `LINKNEST_ADMIN_USERNAME`
- `LINKNEST_ADMIN_PASSWORD`

Not:

- `LINKVAULT_ADMIN_USERNAME`
- `LINKVAULT_ADMIN_PASSWORD`

### Wrong port

The app default is:

```text
3080
```

If Nginx points at `3090` while the app runs on `3080`, the site will fail.

### Forgetting proxy trust setting

If Nginx is in front of the app and you want correct client IP handling for rate limiting, set:

```bash
TRUSTED_PROXY=true
```

If the app is directly exposed without a trusted proxy, leave it disabled.

### Secure cookies on plain HTTP

If `COOKIE_SECURE=true` but you only access the app over plain HTTP, browser login cookies may not work.

For real production, that is correct because you should be using HTTPS.
For short local testing only, you can temporarily use:

```bash
COOKIE_SECURE=false
```

## Summary

A correct production deployment of Link Nest should have:

- Node.js installed
- MongoDB available
- a valid `.env`
- the app running under `systemd`
- Nginx proxying to port `3080`
- HTTPS enabled
- `TRUSTED_PROXY=true` when behind Nginx
