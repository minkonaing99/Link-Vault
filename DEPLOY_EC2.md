# Deploy Link Vault On EC2

Last updated: 2026-03-20

This guide assumes:

- Ubuntu 24.04 EC2 instance
- local MongoDB on the same server
- domain name optional
- Node.js app served behind Nginx
- `systemd` used to keep the server running

## 1. Launch and connect

SSH into the instance:

```bash
ssh -i /path/to/your-key.pem ubuntu@YOUR_EC2_PUBLIC_IP
```

## 2. Install system packages

```bash
sudo apt update
sudo apt install -y nginx git curl gnupg
```

Install Node.js 22:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

## 3. Install MongoDB 8.0

```bash
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list
sudo apt update
sudo apt install -y mongodb-org
sudo systemctl enable mongod
sudo systemctl start mongod
sudo systemctl status mongod
```

MongoDB should listen locally on `127.0.0.1:27017` by default.

## 4. Clone the repo

```bash
cd ~
git clone https://github.com/minkonaing99/Link-Vault.git link-vault
cd ~/link-vault
```

## 5. Install dependencies

```bash
npm install
```

## 6. Create production `.env`

Create:

```bash
nano .env
```

Example:

```bash
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB_NAME=linkvault
PORT=3090
AUTH_COOKIE_NAME=linkvault_session
AUTH_SESSION_TTL_DAYS=30
ACCESS_TOKEN_TTL_MINUTES=15
REFRESH_TOKEN_TTL_DAYS=30
JWT_TTL_DAYS=30
JWT_SECRET=replace-with-a-long-random-secret
LINKVAULT_ADMIN_USERNAME=admin
LINKVAULT_ADMIN_PASSWORD=change-this-now
```

Notes:

- use a strong `JWT_SECRET`
- do not reuse exposed passwords
- if you later switch back to MongoDB Atlas, replace `MONGODB_URI` with your production cluster URI

## 7. Create a systemd service

```bash
sudo nano /etc/systemd/system/link-vault.service
```

Use:

```ini
[Unit]
Description=Link Vault
After=network.target mongod.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/link-vault
ExecStart=/usr/bin/node /home/ubuntu/link-vault/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable link-vault
sudo systemctl restart link-vault
sudo systemctl status link-vault
```

App logs:

```bash
journalctl -u link-vault -n 100 --no-pager
```

## 8. Configure Nginx reverse proxy

Create a site config:

```bash
sudo nano /etc/nginx/sites-available/link-vault
```

Use:

```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_IP;

    location / {
        proxy_pass http://127.0.0.1:3090;
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
sudo ln -s /etc/nginx/sites-available/link-vault /etc/nginx/sites-enabled/link-vault
sudo nginx -t
sudo systemctl restart nginx
```

Then open:

```text
http://YOUR_DOMAIN_OR_IP
```

## 9. Optional HTTPS with Let's Encrypt

Install Certbot:

```bash
sudo apt install -y certbot python3-certbot-nginx
```

Request a certificate:

```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

## 10. Open EC2 security group ports

Allow:

- `22` for SSH
- `80` for HTTP
- `443` for HTTPS if using SSL

Do not expose MongoDB publicly. Keep it bound to localhost only.

## 11. Update the app later

```bash
cd ~/link-vault
git fetch origin
git reset --hard origin/main
npm install
sudo systemctl restart link-vault
```

## 12. Useful commands

App logs:

```bash
journalctl -u link-vault -n 100 --no-pager
```

Restart:

```bash
sudo systemctl restart link-vault
```

MongoDB status:

```bash
sudo systemctl status mongod
```

Nginx status:

```bash
sudo systemctl status nginx
```

## Recommended production follow-up

- rotate any credentials used during local development
- use HTTPS before exposing login to the internet
- add MongoDB backups
- restrict inbound traffic to only required ports
- consider adding rate limiting and CORS policy if the iOS app will call this from a different origin setup
