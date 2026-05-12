# ⚡ Merkaz Universal SupplyFlow V6 
## Complete WhatsApp Commerce Bot — Step-by-Step Deployment Guide

> Works for water delivery, gas supply, food delivery, milk/dairy, retail, and any supply business.
> Built for the Kenyan market. M-Pesa native. Zero dependencies beyond Node.js and Express.

---

## Table of Contents

1. [What You Get](#1-what-you-get)
2. [Prerequisites](#2-prerequisites)
3. [Step 1 — Meta (WhatsApp) Setup](#3-step-1--meta-whatsapp-setup)
4. [Step 2 — M-Pesa Daraja Setup](#4-step-2--m-pesa-daraja-setup)
5. [Step 3 — Firebase Setup (Optional)](#5-step-3--firebase-setup-optional)
6. [Step 4 — Local Setup & Test](#6-step-4--local-setup--test)
7. [Step 5 — Deploy to Render](#7-step-5--deploy-to-render)
8. [Step 6 — Connect the Webhook](#8-step-6--connect-the-webhook)
9. [Step 7 — Go Live Checklist](#9-step-7--go-live-checklist)
10. [Admin Dashboard Guide](#10-admin-dashboard-guide)
11. [Customising Products](#11-customising-products)
12. [Bot Conversation Map](#12-bot-conversation-map)
13. [Multi-Tenant (Multiple Businesses)](#13-multi-tenant-multiple-businesses)
14. [Troubleshooting](#14-troubleshooting)
15. [Environment Variable Reference](#15-environment-variable-reference)

---

## 1. What You Get

| Feature | Detail |
|---|---|
| WhatsApp bot | Full conversational commerce — browse, cart, checkout |
| Payment | M-Pesa STK Push (auto) + Manual Till confirmation |
| Admin dashboard | Live orders, clients, revenue charts, config |
| 5 sector catalogues | Water, Gas, Food, Milk, Retail (auto-loaded by config) |
| Database | Firebase Firestore (optional) — in-memory fallback included |
| Multi-tenant | One server, multiple businesses |
| Rate limiting | Built-in per-number protection |
| Customer notifications | Auto WhatsApp message on payment + dispatch |
| Security | Webhook signature verification, input sanitisation, XSS prevention |

---

## 2. Prerequisites

You need accounts on these platforms (all have free tiers):

| Platform | Used for | Cost |
|---|---|---|
| [Meta for Developers](https://developers.facebook.com) | WhatsApp Cloud API | Free |
| [Render](https://render.com) | Hosting the bot | Free tier available |
| [Safaricom Daraja](https://developer.safaricom.co.ke) | M-Pesa STK Push | Free sandbox |
| [Firebase](https://firebase.google.com) | Database (optional) | Free Spark plan |
| [GitHub](https://github.com) | Code repository for deploy | Free |

You also need:
- **Node.js 18+** installed locally ([nodejs.org](https://nodejs.org))
- A **registered WhatsApp Business number** (can be your current number)
- An **M-Pesa Till Number** (Buy Goods) — contact your Safaricom agent

---

## 3. Step 1 — Meta (WhatsApp) Setup

This is the most involved step. Follow carefully.

### 3.1 Create a Meta App

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Click **My Apps** → **Create App**
3. Select **Business** as the app type
4. Give it a name (e.g. "SupplyFlow Bot") and click **Create App**

### 3.2 Add WhatsApp Product

1. On your app dashboard, click **Add Product**
2. Find **WhatsApp** and click **Set Up**
3. You'll land on the **WhatsApp Getting Started** page

### 3.3 Get Your Credentials

On the WhatsApp Getting Started page:

1. Under **Step 1**, note your **Phone Number ID** — copy it → this is `PHONE_NUMBER_ID`
2. Under **Step 2**, click **Generate Token** → copy it → this is `WHATSAPP_TOKEN`
   > ⚠️ This temporary token expires in 24h. For production, generate a permanent token (Step 3.4 below).

### 3.4 Generate a Permanent Access Token

1. Go to [business.facebook.com](https://business.facebook.com) → **Settings** → **System Users**
2. Create a **System User** with Admin role
3. Click **Generate New Token** → select your app → grant `whatsapp_business_messaging` permission
4. Copy the token → this is your permanent `WHATSAPP_TOKEN`

### 3.5 Get Your App Secret

1. On your app dashboard, go to **Settings** → **Basic**
2. Scroll to **App Secret** → click **Show** → copy it → this is `APP_SECRET`

### 3.6 Note your Verify Token

This is a string YOU choose. Make it random and secret.
Example: `supplyflow_verify_abc123xyz`
Save it — this is your `VERIFY_TOKEN`.

> You will enter this same string in both your `.env` file and the Meta webhook configuration.

### 3.7 Add Your Phone Number (if not already done)

1. Go to **WhatsApp** → **Phone Numbers** → **Add Phone Number**
2. Follow the verification steps for your business number

---

## 4. Step 2 — M-Pesa Daraja Setup

### 4.1 Register on Daraja

1. Go to [developer.safaricom.co.ke](https://developer.safaricom.co.ke)
2. Sign up and verify your account
3. Go to **My Apps** → **Add a new App**
4. Select **Lipa Na M-Pesa Sandbox** → Create

### 4.2 Get Sandbox Credentials

From your app page:
- **Consumer Key** → `MPESA_KEY`
- **Consumer Secret** → `MPESA_SECRET`

### 4.3 Get Sandbox Passkey

1. Go to **APIs** → **Lipa Na M-Pesa Online (Sandbox)**
2. Under the **Simulate** tab, you'll find the **Lipa Na M-Pesa Online Passkey** → `MPESA_PASSKEY`

### 4.4 Test with Sandbox

Use these sandbox test values:
- Shortcode: `174379`
- Till (PartyB): `174379`
- Test phone numbers in Daraja simulator work without real M-Pesa

### 4.5 Going to Production

When ready to go live:
1. Apply for **Go Live** on the Daraja portal
2. Safaricom will review and approve (1–3 business days)
3. You'll receive production credentials — update `MPESA_ENV=production`
4. Use your real **Till Number** as `MPESA_TILL`

---

## 5. Step 3 — Firebase Setup (Optional)

> Skip this if you want to start with in-memory storage. Data will reset on server restart.
> **Recommended for production.**

### 5.1 Create a Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add Project** → name it → disable Google Analytics → Create

### 5.2 Enable Firestore

1. In your project, go to **Firestore Database** → **Create Database**
2. Choose **Start in production mode** → select your region → Enable

### 5.3 Create a Service Account

1. Go to **Project Settings** → **Service Accounts** tab
2. Click **Generate new private key** → Download the JSON file
3. Open the JSON file — you'll paste its contents as `FIREBASE_CONFIG`

### 5.4 Format for .env

The JSON must be on one line. On Mac/Linux:
```bash
cat your-firebase-key.json | tr -d '\n'
```
On Windows (PowerShell):
```powershell
(Get-Content firebase-key.json) -join '' | Set-Clipboard
```
Paste the result as the value of `FIREBASE_CONFIG` in your `.env`.

### 5.5 Create the Firestore Index (Important)

To avoid the analytics query error:

1. Go to **Firestore** → **Indexes** → **Composite** → **Add Index**
2. Collection: `analytics`
3. Fields: `bizId` (Ascending), `date` (Descending)
4. Click **Create**

> ⏳ Index takes 1–3 minutes to build. The bot still works without it — it falls back to client-side sorting automatically.

---

## 6. Step 4 — Local Setup & Test

### 6.1 Get the Code

```bash
# Extract the ZIP and enter the folder
unzip supplyflow_v6_universal.zip
cd supplybot
```

Or if you cloned from GitHub:
```bash
git clone https://github.com/YOUR_USERNAME/supplyflow-v6.git
cd supplyflow-v6
```

### 6.2 Install Dependencies

```bash
npm install
```

### 6.3 Create Your .env File

```bash
cp .env.example .env
```

Open `.env` in any text editor and fill in your values:

```env
PORT=3000
APP_URL=http://localhost:3000      # change to your Render URL after deploy

WHATSAPP_TOKEN=your_token_here
PHONE_NUMBER_ID=your_phone_id_here
VERIFY_TOKEN=supplyflow_verify_abc123xyz
APP_SECRET=your_app_secret_here

ADMIN_TOKEN=generate_something_random_here_32chars
ADMIN_EMAIL=you@yourbusiness.com
ADMIN_PASSWORD=YourStrongPassword123!

BUSINESS_ID=chemichemi_halisi
BIZ_NAME=ChemiChemi Halisi
BIZ_SECTOR=water
BIZ_GREETING=Welcome to *ChemiChemi Halisi* 💧\nFresh Tsavo spring water to your door!
SUPPORT_PHONE=254712345678

MPESA_TILL=6247361
MPESA_SHORTCODE=174379
MPESA_PASSKEY=your_passkey
MPESA_KEY=your_consumer_key
MPESA_SECRET=your_consumer_secret
MPESA_ENV=sandbox
```

### 6.4 Run Locally

```bash
npm start
```

You should see:
```
[SupplyFlow V6] Running on port 3000
```

Visit `http://localhost:3000` → you'll be redirected to the login page.

### 6.5 Login to Admin Dashboard

- URL: `http://localhost:3000/login.html`
- Email: whatever you set as `ADMIN_EMAIL`
- Password: whatever you set as `ADMIN_PASSWORD`

### 6.6 Test the Webhook Locally (Optional)

Install [ngrok](https://ngrok.com) to expose your local server:
```bash
npx ngrok http 3000
```
Copy the `https://xxxx.ngrok-free.app` URL — use this as your webhook URL in Meta.

---

## 7. Step 5 — Deploy to Render

### 7.1 Push to GitHub

```bash
git init
git add .
git commit -m "SupplyFlow V6 — initial deploy"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/supplyflow-v6.git
git push -u origin main
```

### 7.2 Create a Render Web Service

1. Go to [render.com](https://render.com) → **New** → **Web Service**
2. Connect your GitHub account → select your repo
3. Fill in:
   - **Name:** `supplyflow-v6` (or any name)
   - **Region:** pick closest to Kenya (e.g. Frankfurt or Ohio)
   - **Branch:** `main`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free (to start)

### 7.3 Add Environment Variables on Render

1. Scroll to **Environment Variables** section
2. Click **Add Environment Variable** for each one from your `.env` file
3. Update `APP_URL` to your Render URL: `https://supplyflow-v6.onrender.com`

> ⚠️ Do NOT upload or expose your `.env` file. Always set variables through the Render dashboard.

### 7.4 Deploy

Click **Create Web Service**. Render will:
1. Pull your code from GitHub
2. Run `npm install`
3. Start the server

Watch the **Logs** tab. When you see `[SupplyFlow V6] Running on port 3000`, it's live.

Your URL will be: `https://supplyflow-v6.onrender.com` (or whatever name you chose).

---

## 8. Step 6 — Connect the Webhook

### 8.1 Set Webhook in Meta

1. Go to [developers.facebook.com](https://developers.facebook.com) → your app
2. Go to **WhatsApp** → **Configuration** → **Webhook**
3. Click **Edit**
4. Enter:
   - **Callback URL:** `https://YOUR-APP.onrender.com/webhook`
   - **Verify Token:** exactly what you set as `VERIFY_TOKEN` in your `.env`
5. Click **Verify and Save**

If verification succeeds, you'll see a green checkmark.

### 8.2 Subscribe to Webhook Events

Under **Webhook Fields**, click **Manage** and enable:
- ✅ `messages`
- ✅ `message_deliveries`
- ✅ `message_reads`

Click **Done**.

### 8.3 Test the Bot

Send a WhatsApp message to your business number. You should receive the welcome menu within 2–3 seconds.

---

## 9. Step 7 — Go Live Checklist

Before handling real customers, verify each item:

### Security
- [ ] `ADMIN_TOKEN` is at least 32 random characters
- [ ] `ADMIN_PASSWORD` is strong (12+ chars, mixed case, numbers)
- [ ] `VERIFY_TOKEN` is set and matches Meta webhook config
- [ ] `APP_SECRET` is set (enables webhook signature verification)
- [ ] `.env` file is NOT committed to GitHub (check `.gitignore`)

### Payments
- [ ] `MPESA_TILL` is your real Till Number
- [ ] `MPESA_ENV=production` (not sandbox)
- [ ] M-Pesa callback URL registered with Safaricom: `https://YOUR-APP.onrender.com/api/admin/mpesa/callback`
- [ ] Test a real KES 1 payment end-to-end

### Bot
- [ ] Send "hi" to your WhatsApp number — get the welcome menu
- [ ] Place a test order through to payment
- [ ] Verify admin dashboard shows the order
- [ ] Update order to DISPATCHED — customer gets WhatsApp notification

### Database (if using Firestore)
- [ ] `FIREBASE_CONFIG` set correctly in Render env vars
- [ ] Firestore composite index created (bizId ASC, date DESC on `analytics`)
- [ ] Test order appears in Firestore console

---

## 10. Admin Dashboard Guide

### Accessing the Dashboard

URL: `https://YOUR-APP.onrender.com/login.html`

### Dashboard Sections

**Dashboard** — Real-time KPIs: orders today, revenue today, total clients, 30-day revenue.

**Orders** — Full order list with status filter. Click **Update** on any order to:
- Change status (Pending → Paid → Processing → Dispatched → Delivered)
- Add driver's WhatsApp number (customer gets notified automatically)
- Add an internal note

**Clients** — All registered customers with order count and last order date. Click **💬 Chat** to open a WhatsApp conversation with any customer.

**Analytics** — 14-day revenue bar chart and summary stats.

**Configuration** — Update your business name, sector, greeting message, support phone, and M-Pesa details. Changes take effect immediately (no server restart needed).

**Deployment** — Quick reference for environment variables and deployment steps.

### Confirming Manual Payments

When a customer pays manually and sends their M-Pesa code:
1. The bot automatically validates the code format and marks the order PAID
2. If needed, you can also manually confirm via admin: **Orders** → **Update** → Status: **Paid**

---

## 11. Customising Products

### Option A — Via Admin Dashboard (easiest)

1. Go to **Configuration** in the admin dashboard
2. The products array can be set via the API (see Option B)

### Option B — Via API

POST to `https://YOUR-APP.onrender.com/api/admin/config` with:

```json
{
  "products": [
    {
      "id": "w5",
      "name": "5L Spring Water Bottle",
      "price": 50,
      "description": "Fresh Tsavo spring water"
    },
    {
      "id": "w20",
      "name": "20L Dispenser Refill",
      "price": 150,
      "description": "Home & office use"
    },
    {
      "id": "plan_monthly",
      "name": "Monthly Water Plan",
      "price": 2500,
      "description": "Daily 20L delivery, 30 days"
    }
  ]
}
```

Include the header: `Authorization: Bearer YOUR_ADMIN_TOKEN`

### Option C — Via Firestore Console

1. Open Firebase Console → Firestore
2. Find the `businesses` collection → your `BUSINESS_ID` document
3. Edit the `products` field directly

### Product ID rules
- Must be unique, lowercase, no spaces: `w5`, `gas_6kg`, `lunch_box`
- Max 10 products per catalogue (WhatsApp list limit)
- Price must be a number (in KES, no decimals needed)

---

## 12. Bot Conversation Map

```
Customer sends any message (or "hi", "hello", "menu")
              │
              ▼
        ┌─────────────────────────┐
        │       MAIN MENU         │
        │  🛒 Place Order          │
        │  📦 Track Order          │
        │  💬 Support              │
        └─────┬──────┬─────┬──────┘
              │      │     │
         ORDER│  TRACK│  SUPPORT
              │      │     │
              ▼      ▼     ▼
         BROWSING  Enter  FAQ list
         (product  order  + Human
          list)    ID     escalation
              │      │
              ▼      ▼
         Tap product  Show status
              │      (PENDING/PAID/
              ▼       DISPATCHED etc)
         Choose QTY
         (1 / 2 / 5)
              │
              ▼
         CART REVIEW
         ✅ Checkout
         ➕ Add More
         🗑️ Clear Cart
              │
              ▼
         DELIVERY DETAILS
         (location pin or typed address)
              │
              ▼
         PAYMENT CHOICE
         ⚡ M-Pesa Push (STK)
         📲 M-Pesa Manual
         💵 Pay on Delivery
              │
         ┌────┴────┐
         │         │
    STK/Manual    COD
         │         │
         ▼         ▼
    Customer   Order confirmed
    sends      immediately ✅
    M-Pesa
    code
         │
         ▼
    Order marked PAID ✅
    Customer notified
```

**Global commands** (work at any step):
- `menu` / `hi` / `hello` / `0` / `back` / `cancel` → returns to Main Menu

---

## 13. Multi-Tenant (Multiple Businesses)

One deployed server can power multiple businesses simultaneously.

### How it works

Each business has its own WhatsApp Phone Number ID. When Meta sends a webhook, it includes the `phone_number_id` of the receiving number. The bot uses this to look up the correct business config.

### Setup

1. In Firestore `businesses` collection, create a document for each business using their `phone_number_id` as the document ID:

```json
// Document ID: "296847823456789" (Phone Number ID from Meta)
{
  "name": "AquaFresh Mombasa",
  "sector": "water",
  "greeting": "Welcome to AquaFresh! 💧",
  "mpesaTill": "7654321",
  "supportPhone": "254722000111",
  "products": [ ... ]
}
```

2. Each business manages its own orders and clients — fully isolated.

3. The admin dashboard shows one business at a time. Add `?bizId=PHONE_NUMBER_ID` to filter.

---

## 14. Troubleshooting

### "Webhook verification failed"
- Double-check `VERIFY_TOKEN` in `.env` matches exactly what you entered in Meta (no spaces)
- Make sure your server is deployed and accessible before verifying

### Bot doesn't respond to messages
- Check Render logs for errors (`[Bot]` lines should appear for each message)
- Verify webhook is subscribed to `messages` field
- Check `WHATSAPP_TOKEN` is valid and not expired (temporary tokens last 24h)
- Ensure your WhatsApp Business number is connected to the app

### M-Pesa STK Push not received
- Check `MPESA_ENV` — use `sandbox` for testing, `production` for live
- Verify `MPESA_KEY`, `MPESA_SECRET`, `MPESA_PASSKEY` are correct
- Safaricom sandbox only works with specific test phone numbers
- Check Render logs for `[STK Push]` error messages

### M-Pesa callback not confirming orders
- Ensure `APP_URL` in your `.env` is your live Render URL (not localhost)
- The callback URL is: `https://YOUR-APP.onrender.com/api/admin/mpesa/callback`
- Register this URL with Safaricom in your Daraja app settings
- This endpoint is public (no auth required) — correct by design

### Admin dashboard shows no data
- Check `ADMIN_TOKEN` in `.env` matches what you use to log in
- If using Firestore, verify `FIREBASE_CONFIG` is valid JSON on one line
- Without Firestore, data only persists until server restarts (Render free tier restarts ~every 15 min of inactivity)

### Analytics page crashes (Firestore index error)
- Create the composite index: Firebase Console → Firestore → Indexes → Composite
- Fields: `bizId` (Ascending), `date` (Descending), collection: `analytics`
- The bot falls back to client-side sort automatically while the index builds

### "Session expired" — customer has to restart every time
- This is expected on Render free tier (server sleeps after 15 min inactivity)
- Upgrade to Render Starter ($7/month) for always-on service
- Or add Redis for persistent sessions: uncomment the Redis code in `src/bot/session.js`

### Images / media messages from customers
- The bot currently ignores media messages (images, voice notes)
- Customers asking to share payment screenshots: ask them to type the M-Pesa code instead
- Full media handling can be added as an enhancement

---

## 15. Environment Variable Reference

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default: 3000) |
| `APP_URL` | Yes | Your full Render URL (for M-Pesa callback) |
| `WHATSAPP_TOKEN` | Yes | Meta permanent access token |
| `PHONE_NUMBER_ID` | Yes | Meta WhatsApp Phone Number ID |
| `VERIFY_TOKEN` | Yes | Secret string for webhook verification |
| `APP_SECRET` | Recommended | Meta app secret for signature verification |
| `ADMIN_TOKEN` | Yes | Bearer token for admin API/dashboard |
| `ADMIN_EMAIL` | Yes | Admin login email |
| `ADMIN_PASSWORD` | Yes | Admin login password |
| `BUSINESS_ID` | Yes | Unique identifier for your business |
| `BIZ_NAME` | Yes | Business display name |
| `BIZ_SECTOR` | Yes | `water` / `gas` / `food` / `milk` / `retail` |
| `BIZ_GREETING` | No | Custom WhatsApp greeting message |
| `SUPPORT_PHONE` | Yes | Support WhatsApp number (with country code) |
| `MPESA_TILL` | Yes | M-Pesa Buy Goods Till Number |
| `MPESA_SHORTCODE` | For STK | Business shortcode for STK Push |
| `MPESA_PASSKEY` | For STK | Lipa Na M-Pesa passkey |
| `MPESA_KEY` | For STK | Daraja Consumer Key |
| `MPESA_SECRET` | For STK | Daraja Consumer Secret |
| `MPESA_ENV` | Yes | `sandbox` or `production` |
| `FIREBASE_CONFIG` | No | Firebase service account JSON (one line) |
| `REDIS_URL` | No | Redis connection URL (for persistent sessions) |

---

## Patches Applied (V6.1)

The following bugs from the initial V6 audit were fixed in this release:

| # | Bug | Fix |
|---|---|---|
| 1 | Main menu buttons (ORDER/TRACK/SUPPORT) never triggered — bot looped on greeting | `_lastInput` removed; dispatcher now routes on the **current** message's input |
| 2 | M-Pesa STK callback behind admin auth — Safaricom couldn't reach it | Callback moved **before** `requireAuth` middleware; now public as required |
| 3 | BROWSING step double-rendered catalogue when ADD_ input arrived | BROWSING now checks for ADD_ input first and delegates to ADD_TO_CART immediately |
| 4 | Firestore `orderBy` crashed if composite index not yet created | Wrapped in try/catch; falls back to client-side sort with helpful index-creation log |
| 5 | User-typed addresses stored and rendered in admin dashboard without sanitisation (XSS) | `sanitise()` helper strips HTML/script tags from all user text inputs |

---

*SupplyFlow V6.1 — Built for Kenyan supply businesses. WhatsApp Cloud API + M-Pesa Daraja.*
