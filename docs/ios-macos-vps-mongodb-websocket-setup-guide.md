# iOS + macOS Menu Bar App Backend Setup Guide
## Stack
- **Client apps:** iOS app, macOS menu bar app
- **API:** REST for auth + initial/full fetch + CRUD
- **Realtime:** WebSocket for live updates only
- **Database:** MongoDB on the same VPS
- **Server:** Ubuntu VPS + Nginx + Node.js + PM2
- **Cache:** small local cache in the macOS app

---

# 1. Final architecture

```text
iOS app
macOS menu bar app
        ↓
 HTTPS REST API + WSS WebSocket
        ↓
   Node.js / Express API
        ↓
      MongoDB
```

## Rules
- **Do not connect iOS/macOS directly to MongoDB**
- **Use REST for login, initial fetch, CRUD, sync fallback**
- **Use WebSocket only for realtime events**
- **Keep MongoDB private**
- **Keep a small local cache in the macOS app**

---

# 2. Overall build order

Follow this order:

1. Buy and prepare VPS
2. Point domain/subdomain to VPS
3. Install Node.js
4. Install MongoDB
5. Secure MongoDB
6. Build Express API
7. Add WebSocket server
8. Test locally on VPS
9. Install Nginx reverse proxy
10. Add HTTPS with Let's Encrypt
11. Run app with PM2
12. Add firewall rules
13. Add backup job for MongoDB
14. Build iOS client integration
15. Build macOS menu bar integration
16. Add local cache to macOS app
17. Add reconnect + resync logic
18. Test end-to-end

---

# 3. Prepare the VPS

## Goal
Get a clean Ubuntu server ready.

## Suggested VPS size
- Minimum: **1 vCPU / 2 GB RAM**
- Better: **2 vCPU / 4 GB RAM**

## First tasks
- Buy a VPS
- Install **Ubuntu 24.04 LTS**
- Get the public IP
- Log in through SSH

Example:

```bash
ssh root@YOUR_SERVER_IP
```

## Update system
```bash
apt update && apt upgrade -y
```

## Create a normal sudo user
```bash
adduser appadmin
usermod -aG sudo appadmin
```

## Optional but recommended: copy SSH key
From your local machine:

```bash
ssh-copy-id appadmin@YOUR_SERVER_IP
```

Then log in as the new user:

```bash
ssh appadmin@YOUR_SERVER_IP
```

---

# 4. Point your domain

## Goal
Use a domain such as:

- `api.yourapp.com`

## Tasks
- Buy a domain if you do not already have one
- Add an **A record**
- Point `api.yourapp.com` to your VPS IP

## Check DNS
```bash
ping api.yourapp.com
```

Wait until it resolves to your VPS IP.

---

# 5. Install Node.js

## Goal
Install Node.js for the API server.

Use NodeSource or your preferred method.

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Check versions:

```bash
node -v
npm -v
```

---

# 6. Install MongoDB

## Goal
Install MongoDB Community Edition on the same VPS.

After installation, enable and start it:

```bash
sudo systemctl enable mongod
sudo systemctl start mongod
sudo systemctl status mongod
```

---

# 7. Secure MongoDB

## Goal
MongoDB must not be public.

## Edit config
Open config:

```bash
sudo nano /etc/mongod.conf
```

Set MongoDB to localhost only:

```yaml
net:
  port: 27017
  bindIp: 127.0.0.1
```

Restart:

```bash
sudo systemctl restart mongod
```

## Create admin user
Open Mongo shell:

```bash
mongosh
```

Create admin user:

```javascript
use admin

db.createUser({
  user: "adminuser",
  pwd: "VERY_STRONG_PASSWORD",
  roles: [ { role: "userAdminAnyDatabase", db: "admin" } ]
})
```

Exit shell.

## Enable authorization
Edit config again:

```bash
sudo nano /etc/mongod.conf
```

Add:

```yaml
security:
  authorization: enabled
```

Restart:

```bash
sudo systemctl restart mongod
```

## Create app database user
Log in with admin:

```bash
mongosh -u adminuser -p --authenticationDatabase admin
```

Create app database and user:

```javascript
use myapp

db.createUser({
  user: "appuser",
  pwd: "ANOTHER_STRONG_PASSWORD",
  roles: [ { role: "readWrite", db: "myapp" } ]
})
```

---

# 8. Create the API project

## Goal
Set up Node.js + Express project.

```bash
mkdir -p /var/www/myapp-api
sudo chown -R $USER:$USER /var/www/myapp-api
cd /var/www/myapp-api
npm init -y
npm install express mongoose dotenv cors jsonwebtoken bcrypt ws
npm install --save-dev nodemon
```

## Recommended structure

```text
/var/www/myapp-api
├── src
│   ├── config
│   ├── controllers
│   ├── middleware
│   ├── models
│   ├── routes
│   ├── websocket
│   └── server.js
├── .env
├── package.json
└── ecosystem.config.js
```

Create folders:

```bash
mkdir -p src/config src/controllers src/middleware src/models src/routes src/websocket
touch src/server.js .env ecosystem.config.js
```

---

# 9. Add environment variables

## Goal
Keep secrets out of the code.

Example `.env`:

```env
PORT=3000
MONGO_URI=mongodb://appuser:ANOTHER_STRONG_PASSWORD@127.0.0.1:27017/myapp?authSource=myapp
JWT_SECRET=use_a_long_random_secret_here
CLIENT_ORIGIN=https://yourapp.com
```

---

# 10. Build the basic Express server

Create `src/server.js`:

```javascript
require("dotenv").config();

const http = require("http");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

const server = http.createServer(app);

server.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});
```

Test:

```bash
node src/server.js
```

Then:

```bash
curl http://127.0.0.1:3000/health
```

Expected output:

```json
{"ok":true}
```

---

# 11. Design your first MongoDB collection

## Goal
Start simple.

Example: `tasks`

Suggested fields:

```json
{
  "_id": "ObjectId",
  "userId": "ObjectId",
  "title": "Buy milk",
  "done": false,
  "createdAt": "2026-03-20T00:00:00Z",
  "updatedAt": "2026-03-20T00:00:00Z",
  "deleted": false
}
```

## Why these fields matter
- `updatedAt`: needed for sync
- `deleted`: helps soft delete and resync
- `userId`: isolates each user's data

---

# 12. Create Mongoose models

Example `src/models/User.js`:

```javascript
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
```

Example `src/models/Task.js`:

```javascript
const mongoose = require("mongoose");

const taskSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  title: { type: String, required: true },
  done: { type: Boolean, default: false },
  deleted: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model("Task", taskSchema);
```

---

# 13. Build REST auth endpoints

## Goal
Use REST for auth only.

## Endpoints
- `POST /auth/register`
- `POST /auth/login`
- `GET /me`

## Tasks
- Hash passwords with bcrypt
- Generate JWT after login
- Protect private routes with middleware

## Example auth flow
1. App sends email + password to `/auth/login`
2. Server verifies credentials
3. Server returns JWT
4. App stores JWT securely
5. App sends JWT in `Authorization: Bearer <token>`

## iOS/macOS token storage
- Store tokens in **Keychain**
- Do not store tokens in plain UserDefaults

---

# 14. Build REST task endpoints

## Goal
Use REST for normal CRUD and full fetch.

## Endpoints
- `GET /tasks`
- `POST /tasks`
- `PUT /tasks/:id`
- `DELETE /tasks/:id`

## Suggested behavior
- `GET /tasks` returns all non-deleted tasks for logged-in user
- `POST /tasks` creates new task
- `PUT /tasks/:id` updates task
- `DELETE /tasks/:id` soft deletes task by setting `deleted = true`

## Important
Every create/update/delete must update `updatedAt`.

---

# 15. Add sync endpoint

## Goal
Allow client to catch missed updates after reconnect.

## Endpoint
- `GET /sync?since=2026-03-20T10:00:00Z`

## Behavior
Return all changed records after the given timestamp.

Example response:

```json
{
  "serverTime": "2026-03-20T10:15:00Z",
  "tasks": [
    {
      "_id": "123",
      "title": "Updated task",
      "done": true,
      "updatedAt": "2026-03-20T10:05:00Z",
      "deleted": false
    }
  ]
}
```

## Why this matters
If WebSocket disconnects, your app can reconnect and ask:
- what changed since my last sync?

This is critical for reliability.

---

# 16. Add WebSocket server

## Goal
Use WebSocket only for realtime events.

Create a WebSocket server attached to the same HTTP server.

Example in `src/server.js`:

```javascript
require("dotenv").config();

const http = require("http");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const WebSocket = require("ws");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  console.log("WebSocket client connected");

  ws.send(JSON.stringify({
    type: "connected",
    message: "WebSocket connected"
  }));

  ws.on("message", (message) => {
    console.log("Received:", message.toString());
  });

  ws.on("close", () => {
    console.log("WebSocket client disconnected");
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});
```

---

# 17. Define WebSocket event names

## Goal
Keep WebSocket simple and focused.

Recommended events:
- `connected`
- `auth_ok`
- `task_created`
- `task_updated`
- `task_deleted`
- `sync_required`
- `ping`
- `pong`

## Important rule
WebSocket should **notify**.
REST should **fetch or modify data**.

## Example payload
```json
{
  "type": "task_updated",
  "data": {
    "id": "123",
    "updatedAt": "2026-03-20T10:30:00Z"
  }
}
```

Client can:
- update local state directly, or
- call REST for the latest item

---

# 18. Add authentication to WebSocket

## Goal
Only logged-in users should receive events.

## Simple approach
Pass JWT when opening the socket, such as:
- query parameter
- header during upgrade
- first socket message after connection

## Recommended approach
After connection:
1. client sends auth message
2. server verifies JWT
3. server marks socket as authenticated
4. server joins that user to their own channel/group

Example first message:

```json
{
  "type": "auth",
  "token": "JWT_HERE"
}
```

If valid:
```json
{
  "type": "auth_ok"
}
```

If invalid:
```json
{
  "type": "auth_error"
}
```

---

# 19. Broadcast database changes

## Goal
Push live updates when data changes.

## After create/update/delete
When REST modifies a task:
1. save to MongoDB
2. update `updatedAt`
3. send WebSocket event to that user's connected devices

Example:
- iPhone creates task
- server stores task
- server sends `task_created`
- macOS app receives event
- macOS app updates UI immediately

---

# 20. Test API before connecting apps

## Goal
Test every endpoint first.

You do **not** need Postman, but use one of these:
- Postman
- Insomnia
- curl

## Test order
1. `/health`
2. `/auth/register`
3. `/auth/login`
4. `/tasks`
5. `/sync`
6. WebSocket connection
7. WebSocket auth
8. realtime update broadcast

---

# 21. Install Nginx

## Goal
Expose your API through Nginx.

```bash
sudo apt install nginx -y
```

Create config:

```bash
sudo nano /etc/nginx/sites-available/myapp-api
```

Example config:

```nginx
server {
    listen 80;
    server_name api.yourapp.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Enable site:

```bash
sudo ln -s /etc/nginx/sites-available/myapp-api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

# 22. Add HTTPS

## Goal
Use HTTPS and WSS only.

Install Certbot:

```bash
sudo apt install certbot python3-certbot-nginx -y
```

Get certificate:

```bash
sudo certbot --nginx -d api.yourapp.com
```

After this:
- REST uses `https://api.yourapp.com`
- WebSocket uses `wss://api.yourapp.com`

---

# 23. Run API with PM2

## Goal
Keep app running 24/7.

Install PM2:

```bash
sudo npm install -g pm2
```

Start server:

```bash
cd /var/www/myapp-api
pm2 start src/server.js --name myapp-api
pm2 save
pm2 startup
```

Useful commands:

```bash
pm2 status
pm2 logs myapp-api
pm2 restart myapp-api
```

---

# 24. Configure firewall

## Goal
Only expose needed ports.

```bash
sudo apt install ufw -y
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
sudo ufw status
```

## Important
Do **not** open MongoDB port `27017`.

---

# 25. Add MongoDB backups

## Goal
Do not lose your data.

## Simple plan
Use `mongodump` daily.

Create backup folder:

```bash
mkdir -p /var/backups/mongodb
```

Example backup command:

```bash
mongodump --uri="mongodb://appuser:ANOTHER_STRONG_PASSWORD@127.0.0.1:27017/myapp?authSource=myapp" --out /var/backups/mongodb/$(date +%F)
```

## Add cron job
```bash
crontab -e
```

Example daily backup at 3 AM:

```cron
0 3 * * * /usr/bin/mongodump --uri="mongodb://appuser:ANOTHER_STRONG_PASSWORD@127.0.0.1:27017/myapp?authSource=myapp" --out /var/backups/mongodb/$(date +\%F)
```

Also add retention cleanup later.

---

# 26. Build the iOS client integration

## Goal
iOS app uses REST + WebSocket.

## iOS tasks
1. Log in via REST
2. Store JWT in Keychain
3. Fetch initial data via REST
4. Open WebSocket
5. Authenticate WebSocket
6. Listen for live events
7. Update UI when events arrive
8. On reconnect, call `/sync`

## iOS networking split
- `URLSession`: REST
- `URLSessionWebSocketTask`: WebSocket

---

# 27. Build the macOS menu bar app integration

## Goal
macOS app behaves like a 24/7 live client.

## macOS tasks
1. Launch app
2. Load local cache immediately
3. Show current cached state in menu bar UI
4. Fetch latest data from REST
5. Connect WebSocket
6. Listen for changes
7. Update UI and cache
8. Reconnect automatically if disconnected
9. Call `/sync` after reconnect

## Important
The menu bar app should not wait for the server before showing UI.
Use cache first, then refresh.

---

# 28. Add a small local cache in macOS app

## Goal
Improve startup speed and resilience.

## Cache should store
- last fetched tasks/items
- user settings
- last sync timestamp
- maybe basic profile info

## Do not store insecurely
- JWT tokens
- raw passwords
- database credentials

## Where to store
For simple app:
- JSON file is okay

For more structured app:
- SQLite
- Core Data

## Suggested first version
Use:
- Keychain for token
- JSON file for cached tasks + last sync time

---

# 29. Add reconnect logic

## Goal
Make WebSocket reliable.

## Rules
- if socket disconnects, reconnect automatically
- use exponential backoff
- after reconnect, send WebSocket auth again
- then call `/sync?since=LAST_SYNC_TIME`

## Example backoff
- retry after 1 second
- then 2 seconds
- then 5 seconds
- then 10 seconds
- max cap, such as 30 seconds

---

# 30. Add sleep/wake and network recovery

## Goal
Keep the macOS menu bar app stable.

## On wake or network return
- reconnect WebSocket
- re-authenticate socket
- call `/sync`
- update cache
- refresh UI

This is important because laptops sleep, networks change, and sockets break.

---

# 31. Suggested API list

## REST
- `POST /auth/register`
- `POST /auth/login`
- `GET /me`
- `GET /tasks`
- `POST /tasks`
- `PUT /tasks/:id`
- `DELETE /tasks/:id`
- `GET /sync?since=...`

## WebSocket events
- `connected`
- `auth`
- `auth_ok`
- `auth_error`
- `task_created`
- `task_updated`
- `task_deleted`
- `sync_required`
- `ping`
- `pong`

---

# 32. Suggested first milestone plan

## Milestone 1
- VPS ready
- domain works
- Node.js installed
- MongoDB installed and secured

## Milestone 2
- Express app running
- `/health` works
- MongoDB connected

## Milestone 3
- auth endpoints work
- task CRUD works
- sync endpoint works

## Milestone 4
- WebSocket connection works
- WebSocket auth works
- broadcast works

## Milestone 5
- Nginx + HTTPS works
- PM2 works
- firewall works
- backups work

## Milestone 6
- iOS app connected
- macOS menu bar app connected
- cache works
- reconnect + sync works

---

# 33. Common mistakes to avoid

## Backend mistakes
- exposing MongoDB publicly
- storing passwords in plain text
- forgetting JWT auth on private routes
- using WebSocket for everything
- not having `/sync` fallback
- no backups

## Client mistakes
- storing token in plain UserDefaults
- no reconnect logic
- no local cache
- assuming WebSocket never drops
- directly connecting app to database

---

# 34. Best practice summary

## Use REST for
- login
- register
- initial fetch
- CRUD
- sync fallback

## Use WebSocket for
- live event notifications only

## Use local cache for macOS app
- fast startup
- resilience
- offline-ish behavior

## Use MongoDB privately
- localhost only
- auth enabled
- app-specific user

---

# 35. Final checklist

## Server
- [ ] VPS created
- [ ] Ubuntu updated
- [ ] non-root sudo user created
- [ ] domain pointed
- [ ] Node.js installed
- [ ] MongoDB installed
- [ ] MongoDB bound to localhost
- [ ] MongoDB auth enabled
- [ ] app DB user created
- [ ] Express API created
- [ ] JWT auth added
- [ ] task CRUD added
- [ ] sync endpoint added
- [ ] WebSocket server added
- [ ] WebSocket auth added
- [ ] Nginx configured
- [ ] HTTPS enabled
- [ ] PM2 configured
- [ ] UFW configured
- [ ] backups configured

## iOS app
- [ ] login via REST
- [ ] token stored in Keychain
- [ ] initial fetch via REST
- [ ] WebSocket connection added
- [ ] socket auth added
- [ ] event handling added
- [ ] sync fallback added

## macOS app
- [ ] menu bar UI created
- [ ] cache loads on startup
- [ ] initial REST fetch added
- [ ] WebSocket connection added
- [ ] socket auth added
- [ ] local cache saving added
- [ ] reconnect logic added
- [ ] sleep/wake recovery added
- [ ] sync fallback added

---

# 36. What to build first

Start with this exact order:

1. `/health`
2. MongoDB connection
3. `POST /auth/register`
4. `POST /auth/login`
5. `GET /tasks`
6. `POST /tasks`
7. `PUT /tasks/:id`
8. `DELETE /tasks/:id`
9. `GET /sync`
10. basic WebSocket connection
11. WebSocket auth
12. task change broadcasts
13. Nginx + HTTPS
14. iOS integration
15. macOS integration + local cache

---

# 37. Next document you should make after this

After this setup guide, create 3 more files for yourself:

1. `API_SPEC.md`
   - all REST routes
   - request/response JSON
   - auth rules

2. `WS_EVENTS.md`
   - all WebSocket event names
   - payload format
   - client behavior

3. `DEPLOY_CHECKLIST.md`
   - every production deployment step
   - backup checks
   - rollback plan

---
