# Deploy Link Vault On EC2

Last updated: 2026-03-20

This guide assumes:

- Ubuntu EC2 instance
- MongoDB already available, either local or hosted
- domain name optional
- Node.js app served behind Nginx
- PM2 used to keep the server running

## 1. Launch and connect

SSH into the instance:

```bash
ssh -i /path/to/your-key.pem ubuntu@YOUR_EC2_PUBLIC_IP
```

## 2. Install system packages

```bash
sudo apt update
sudo apt install -y nginx git curl
```

Install Node.js 22:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Install PM2 globally:

```bash
sudo npm install -g pm2
```

## 3. Clone the repo

```bash
cd /var/www
sudo git clone https://github.com/minkonaing99/Link-Vault.git link-vault
sudo chown -R $USER:$USER /var/www/link-vault
cd /var/www/link-vault
```

## 4. Install dependencies

```bash
npm install
```

## 5. Create production `.env`

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
- if using MongoDB Atlas, replace `MONGODB_URI` with your production cluster URI

## 6. Start the app with PM2

```bash
pm2 start server.js --name link-vault
pm2 save
pm2 startup
```

Verify:

```bash
pm2 status
pm2 logs link-vault
```

## 7. Configure Nginx reverse proxy

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

## 8. Optional HTTPS with Let's Encrypt

Install Certbot:

```bash
sudo apt install -y certbot python3-certbot-nginx
```

Request a certificate:

```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

## 9. Open EC2 security group ports

Allow:

- `22` for SSH
- `80` for HTTP
- `443` for HTTPS if using SSL

Do not expose MongoDB publicly unless you intentionally need that.

## 10. Update the app later

```bash
cd /var/www/link-vault
git pull origin main
npm install
pm2 restart link-vault
```

## 11. Useful commands

App logs:

```bash
pm2 logs link-vault
```

Restart:

```bash
pm2 restart link-vault
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
