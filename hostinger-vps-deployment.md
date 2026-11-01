# Rudra Creative — Hostinger VPS deployment guide

**Guide date:** 31 October 2026  
**Target:** Hostinger VPS, Ubuntu 24.04 LTS, 4 GB RAM, Docker Compose, Caddy, PostgreSQL 16  
**Deployment shape:** `https://YOUR_DOMAIN` storefront + `https://admin.YOUR_DOMAIN` admin + private Docker-only API/PostgreSQL

> ## Important release blocker
>
> The project archive currently does **not** contain `package-lock.json`. The Dockerfiles deliberately stop when this file is missing. Do not skip this gate or weaken the Dockerfiles. Generate and review the lockfile on a trusted machine with npm registry access, run the full release checks, and include the reviewed lockfile before transferring the project to the VPS. The previous authoring environment could not install dependencies or run Docker, so this guide describes how to deploy and verify; it is not evidence that deployment has already succeeded.
>
> The repository also deliberately defaults `PAYMENTS_ENABLED=false` and `R2_UPLOADS_ENABLED=false`. Keep them disabled until their separate staging tests and release gates are complete.

---

## 1. What you are deploying

The production Compose file creates three services:

| Service | Role | Public exposure |
|---|---|---|
| `web` | Caddy serves the compiled storefront/admin assets and proxies `/api/*` to the API | TCP 80 and 443 only |
| `api` | Express/TypeScript API, Prisma client, authentication, catalog, commerce and integrations | Docker network only; port 4000 is not published on the host |
| `postgres` | PostgreSQL transactional database | Private Docker network only; port 5432 is not published |

Caddy is the reverse proxy used by this repository; do not install a second Nginx proxy on ports 80/443. Caddy obtains and renews TLS certificates automatically when the configured domains resolve to the VPS and ports 80/443 are reachable.

**Recommended hostnames:**

- Storefront: `example.com`
- Admin: `admin.example.com`
- Public product image hostname: `assets.example.com` (configured separately on Cloudflare R2)

The current Caddyfile does not configure `www.example.com`. Do not point `www` at this server unless you also add a `www` site/redirect to the Caddyfile and test it.

---

## 2. Prepare and validate the release on a connected computer

Do this on a trusted workstation or CI runner with internet access. You do not need to install Node.js on the Hostinger VPS because the Dockerfiles build and run the app inside pinned Node images.

### 2.1 Extract the project

Extract the project archive so that the repository root contains `package.json`, `frontend/`, `admin/`, `backend/`, and `docker-compose.production.yml`.

Open a terminal in that `3d-commerce` directory.

### 2.2 Use the pinned Node/npm versions

The repository's `.nvmrc` pins Node.js `24.22.2`; the root package requires npm `11.19.1` or later within npm 11.

With NVM:

```bash
nvm install 24.22.2
nvm use 24.22.2
node --version       # must print v24.22.2
npm install --global npm@11.19.1
npm --version        # must print 11.19.1 (or a compatible npm 11 release)
```

### 2.3 Generate the lockfile and run the full release gate

```bash
npm run lock:refresh
```

Review the generated `package-lock.json` and commit it alongside the exact package manifests. Then run:

```bash
npm run secure:release
```

That script performs the pinned-version check, clean `npm ci`, both npm audit gates, Prisma generation/validation, TypeScript typechecking, tests and frontend/backend production builds.

**Stop if any command fails.** Do not use `npm audit fix --force`, do not remove the audit gate, and do not manually invent a lockfile. Fix the advisory or compatibility problem, regenerate/review the lockfile, then rerun the entire script. Preserve the command output as the release evidence.

The release must contain `package-lock.json`. Confirm:

```bash
test -s package-lock.json && echo 'Lockfile present'
git status --short
```

If you deploy from Git, push the validated commit to a private repository. If you deploy from ZIP, create a new release ZIP after adding `package-lock.json`; exclude `.env`, `node_modules/`, and build output. Never include real credentials in the ZIP.

---

## 3. Create the Hostinger VPS

1. Sign in to Hostinger hPanel.
2. Open **VPS → Manage** for the server.
3. Select a 4 GB RAM VPS (the project Compose limits are tuned as a starting point for this size; actual capacity still needs load testing).
4. Choose **Ubuntu 24.04 LTS**. If available, Hostinger's Docker VPS template is the easiest route; it is an Ubuntu 24.04 image with Docker preinstalled.
5. Record the VPS public IPv4 address.
6. Make sure you can reach the VPS console in hPanel before changing SSH or firewall settings.

Hostinger's Docker template and current setup steps are documented in its [Docker VPS template guide](https://www.hostinger.com/support/8306612-how-to-use-the-docker-vps-template-at-hostinger/).

### 3.1 Connect with SSH

From your computer (replace the IP):

```bash
ssh root@VPS_IPV4
```

On Windows PowerShell, use the same `ssh` command. If Hostinger shows a non-default SSH port, add `-p SSH_PORT`.

### 3.2 Update the operating system

```bash
apt update
apt full-upgrade -y
apt install -y ca-certificates curl git unzip ufw fail2ban age
systemctl enable --now fail2ban
```

If the kernel or core system packages were upgraded, reboot and reconnect:

```bash
reboot
```

### 3.3 Create a non-root deployment user

Keep the current root SSH session open while setting this up. Add a user:

```bash
adduser --disabled-password --gecos '' deploy
usermod -aG sudo deploy
install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
nano /home/deploy/.ssh/authorized_keys
```

Paste your **public** SSH key (one line beginning with `ssh-ed25519` or another supported public-key type). Never paste your private key into the VPS. Then:

```bash
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
```

Open a second terminal on your computer and verify key login:

```bash
ssh deploy@VPS_IPV4
```

Do not close the root session until this succeeds. Once verified, harden SSH:

```bash
sudo tee /etc/ssh/sshd_config.d/60-rudra-hardening.conf >/dev/null <<'SSHCFG'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
SSHCFG
sudo sshd -t
sudo systemctl reload ssh
```

Test `ssh deploy@VPS_IPV4` again in a new terminal. Keep the Hostinger console as recovery access. Do not add `deploy` to the Docker group; membership in that group is effectively root-level access. Run Docker commands with `sudo`.

### 3.4 Install/verify Docker Engine and Compose

First check whether the Hostinger Docker template already installed Docker:

```bash
sudo docker --version
sudo docker compose version
sudo systemctl is-active docker
sudo docker run --rm hello-world
```

If those commands work, skip the manual installation below.

If Docker is missing on Ubuntu 24.04, install Docker Engine from Docker's official apt repository (not the convenience script):

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<DOCKERREPO
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
DOCKERREPO

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
```

Official details: [Docker Engine installation for Ubuntu](https://docs.docker.com/engine/install/ubuntu/).

### 3.5 Hostinger firewall and Ubuntu firewall

In hPanel, go to **VPS → Manage → Security → Firewall**. Create/activate a firewall policy that allows inbound:

| Protocol | Port | Source |
|---|---:|---|
| TCP | Your actual SSH port (normally 22) | Your fixed admin IP if possible; otherwise temporarily Anywhere |
| TCP | 80 | Anywhere |
| TCP | 443 | Anywhere |

Do not open 4000, 5173, 5174, or 5432. Hostinger's provider firewall and the OS firewall are separate layers; both must allow the intended traffic.

On Ubuntu, if UFW is not already configured, make sure SSH is allowed **before** enabling it:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status verbose
sudo ufw enable
```

If SSH uses a nonstandard port, replace `OpenSSH` with `sudo ufw allow SSH_PORT/tcp`. Verify a second SSH session before closing the first.

**Docker firewall note:** Docker-published container ports can bypass ordinary UFW filtering. This Compose file publishes only the Caddy web ports 80/443; do not add host port mappings for the API or database. Keep the Hostinger managed firewall active too. See [Docker's firewall warning](https://docs.docker.com/engine/install/ubuntu/#firewall-limitations) and [Hostinger's VPS firewall guide](https://www.hostinger.com/support/8172641-how-to-use-a-managed-vps-firewall-at-hostinger/).

### 3.6 Optional swap for image builds

A 4 GB VPS may experience memory pressure when compiling all workspaces and building containers. Prefer building images in CI and deploying those tested images if you have a container registry. If you must build on the VPS, use sequential builds (shown later) and consider a small swap file as emergency headroom, not as a replacement for RAM:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

Skip this if your VPS/storage policy does not permit swap or if a swap file already exists.

---

## 4. Point the domain to the VPS

Use the DNS provider that is authoritative for your domain. If the domain is managed in Hostinger, open **Domains → Domain portfolio → Manage → DNS / Nameservers**. If it is registered elsewhere, add the records at that registrar or use Hostinger's DNS Manager after changing nameservers.

Create these records:

| Type | Name/Host | Value |
|---|---|---|
| A | `@` | VPS public IPv4 |
| A | `admin` | VPS public IPv4 |

Use the default TTL. Remove conflicting old A/CNAME records for those same hostnames. Do not add an AAAA record unless IPv6 is configured and reachable on the VPS. Do not add `www` until the Caddyfile has been updated to serve/redirect it.

Hostinger's instructions: [Point a domain to your VPS](https://www.hostinger.com/support/1583227-how-to-point-a-domain-to-your-vps-at-hostinger/).

Check DNS from your computer:

```bash
dig +short A example.com
dig +short A admin.example.com
dig +short AAAA example.com
```

The A results should be the VPS IP. An empty AAAA result is expected if you are not using IPv6. Wait for DNS propagation; Hostinger notes it can take up to 24 hours.

Caddy requires the domain to resolve correctly and ports 80/443 to be externally reachable before it can obtain trusted HTTPS certificates. See [Caddy automatic HTTPS prerequisites](https://caddyserver.com/docs/quick-starts/https).

---

## 5. Create Cloudflare R2 storage

The API's production startup validation requires complete R2 configuration even while `R2_UPLOADS_ENABLED=false`. Therefore configure R2 before starting the production-mode API.

In Cloudflare:

1. Create a **private** R2 bucket for customer uploads. This name becomes `R2_BUCKET_NAME`. Do not enable public access for it.
2. Create a **separate public product-image** bucket. This name becomes `R2_PUBLIC_BUCKET_NAME`. Never put private customer files in this bucket.
3. Create an R2 API token/key with only the bucket permissions required by the app for these two buckets. Store its access key ID and secret securely.
4. Set the S3 endpoint to `https://ACCOUNT_ID.r2.cloudflarestorage.com`.
5. Configure a custom domain such as `assets.example.com` for the public image bucket and verify HTTPS. This becomes `R2_PUBLIC_BASE_URL`.
6. For the private bucket, add CORS for the exact storefront and admin origins, allowing `PUT` and the headers `Content-Type`, `If-None-Match`, `x-amz-meta-assetid`, and `x-amz-meta-ownerid`. Do not use wildcard origins with credentialed application requests.
7. Add the `incoming/` lifecycle/cleanup rule described in `docs/storage.md` and decide retention for customer uploads.

Keep `R2_UPLOADS_ENABLED=false` for the initial deployment. The current browser-to-R2 upload path verifies actual file size after transfer; a hard pre-transfer ingress size cap must be installed and tested before enabling it. This means custom 3D-file upload is intentionally unavailable at first.

---

## 6. Prepare the production environment file

### 6.1 Copy the example and protect it

Log in as `deploy` and create the empty app folder first. Then complete section 7 to copy the validated source into it; return here and create/edit the environment file:

```bash
sudo mkdir -p /opt/rudra-creative
sudo chown deploy:deploy /opt/rudra-creative
cd /opt/rudra-creative
```

After section 7 has placed the source in this directory, create the environment file:

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Generate each random secret independently on the VPS:

```bash
openssl rand -hex 32
```

Use a fresh value for `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `SESSION_SECRET`, `OTP_PEPPER`, and `CSRF_SECRET`. A 64-character hex DB password is URL-safe, so it does not need percent-encoding in `DATABASE_URL`.

### 6.2 Production-mode staging values

For the first public staging deployment, set these values in `.env`:

```dotenv
NODE_ENV=production
DEPLOYMENT_STAGE=staging

POSTGRES_DB=commerce
POSTGRES_USER=commerce_admin
POSTGRES_PASSWORD=PASTE_A_UNIQUE_RANDOM_HEX_SECRET
APP_DB_USER=commerce_app
APP_DB_PASSWORD=PASTE_A_DIFFERENT_RANDOM_HEX_SECRET
DATABASE_URL=postgresql://commerce_app:PASTE_THE_SAME_APP_DB_PASSWORD@postgres:5432/commerce?schema=public

PUBLIC_APP_DOMAIN=example.com
PUBLIC_ADMIN_DOMAIN=admin.example.com

SESSION_SECRET=PASTE_A_UNIQUE_RANDOM_HEX_SECRET
OTP_PEPPER=PASTE_A_DIFFERENT_RANDOM_HEX_SECRET
CSRF_SECRET=PASTE_ANOTHER_RANDOM_HEX_SECRET

SMTP_HOST=YOUR_AUTHENTICATED_SMTP_HOST
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=YOUR_SMTP_USERNAME
SMTP_PASSWORD=YOUR_SMTP_PASSWORD
MAIL_FROM=YOUR_VERIFIED_SENDER_ADDRESS

R2_ACCOUNT_ID=YOUR_32_CHARACTER_CLOUDFLARE_ACCOUNT_ID
R2_ACCESS_KEY_ID=YOUR_R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY=YOUR_R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME=YOUR_PRIVATE_BUCKET_NAME
R2_PUBLIC_BUCKET_NAME=YOUR_PUBLIC_IMAGE_BUCKET_NAME
R2_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
R2_PUBLIC_BASE_URL=https://assets.example.com
R2_PRESIGN_TTL_SECONDS=180
R2_UPLOADS_ENABLED=false
MAX_UPLOAD_BYTES=52428800

PAYMENTS_ENABLED=false
CASHFREE_ENVIRONMENT=sandbox
CASHFREE_API_VERSION=2026-01-01

BUSINESS_NAME=OWNER_APPROVED_BUSINESS_NAME
BUSINESS_ADDRESS=OWNER_APPROVED_BUSINESS_ADDRESS
BUSINESS_SUPPORT_EMAIL=OWNER_APPROVED_SUPPORT_EMAIL
BUSINESS_SUPPORT_PHONE=OWNER_APPROVED_INDIAN_PHONE
BUSINESS_GSTIN=
DEFAULT_CURRENCY=INR
DEFAULT_SHIPPING_FLAT_RATE_PAISE=OWNER_CONFIGURED_INTEGER_PAISE
DEFAULT_TAX_MODE=EXCLUSIVE
```

Replace every example value. Do not paste the literal placeholders above. Keep payment credentials blank while payments are disabled. Keep `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` blank in `.env`; they are supplied only to the one-off admin bootstrap command later.

SMTP rules enforced by the API:

- Port `587`: use STARTTLS and `SMTP_SECURE=false`.
- Port `465`: use implicit TLS and `SMTP_SECURE=true`.
- Production startup rejects other ports and missing SMTP credentials.

Production startup also requires all R2 values, distinct private/public bucket names, HTTPS public URLs, and owner-supplied business name, address, support email and Indian support phone. The `BUSINESS_GSTIN` is optional in the schema; only enter a real owner-provided identifier. Do not invent GSTIN, HSN/SAC classifications, tax rates, or legal/business information.

The Compose file builds the container's `PUBLIC_APP_URL`, `PUBLIC_ADMIN_URL`, and `CORS_ALLOWED_ORIGINS` from the two domain variables. In this production deployment, the local development URL/CORS values in `.env.example` are not used by the Compose service.

### 6.3 Shipping and tax configuration

`DEFAULT_SHIPPING_FLAT_RATE_PAISE` is an integer amount in paise (for example, `9900` represents ₹99.00). Set the actual shipping policy approved by the business. `FREE_SHIPPING_THRESHOLD_PAISE` can be left blank if no threshold is used.

If shipping is taxable and the configured shipping charge is nonzero, the app expects `SHIPPING_TAX_CODE`, `SHIPPING_TAX_RATE_BPS`, and `SHIPPING_TAX_EFFECTIVE_FROM` (an ISO-8601 date/time with timezone) to be configured. Product tax classification/rates also need to be entered in the admin and confirmed by the business's tax professional. `DEFAULT_TAX_MODE` must match the approved price-display policy.

### 6.4 Validate environment permissions and Compose interpolation

```bash
chmod 600 .env
sudo docker compose --env-file .env -f docker-compose.production.yml config --quiet
```

If this fails, fix missing/invalid variables before continuing. Do not paste the full resolved Compose configuration into support chats; it can contain secrets.

---

## 7. Transfer the validated source to the VPS

### Option A — private Git repository (recommended)

On the VPS, clone the private repository using a deploy key/token that has read-only access:

```bash
cd /opt
sudo -u deploy git clone YOUR_PRIVATE_REPOSITORY_URL rudra-creative
sudo chown -R deploy:deploy /opt/rudra-creative
cd /opt/rudra-creative
```

Make sure the exact commit includes the reviewed `package-lock.json` and passed `npm run secure:release` in CI/workstation.

### Option B — ZIP upload

From your computer, transfer the **newly regenerated archive that includes package-lock.json** (not the earlier archive that lacked it):

```bash
scp ./rudra-creative-release.zip deploy@VPS_IPV4:/tmp/
```

On the VPS:

```bash
mkdir -p /tmp/rudra-release
unzip /tmp/rudra-creative-release.zip -d /tmp/rudra-release
sudo cp -a /tmp/rudra-release/3d-commerce/. /opt/rudra-creative/
sudo chown -R deploy:deploy /opt/rudra-creative
cd /opt/rudra-creative
test -s package-lock.json
```

Do not overwrite an existing `.env` with a release archive. Create/edit the production `.env` on the VPS as described in section 6 before building.

---

## 8. Build the production images

The Dockerfiles use the reviewed lockfile, `npm ci`, and npm audit gates. Build sequentially to reduce peak RAM on a 4 GB VPS:

```bash
cd /opt/rudra-creative
sudo docker compose --env-file .env --parallel 1 -f docker-compose.production.yml build
```

If this fails due to a dependency audit, type error, or build failure, stop and fix it in the source/CI environment. Do not remove the security gates on the server. Check memory/disk if the build is killed:

```bash
free -h
df -h
sudo docker system df
```

Validate the Compose file without printing secrets:

```bash
sudo docker compose --env-file .env -f docker-compose.production.yml config --quiet
```

---

## 9. Start PostgreSQL and apply migrations

Start only the database first:

```bash
sudo docker compose --env-file .env -f docker-compose.production.yml up -d postgres
sudo docker compose --env-file .env -f docker-compose.production.yml ps
sudo docker compose --env-file .env -f docker-compose.production.yml logs --tail=100 postgres
```

Wait until `postgres` reports `healthy` in `docker compose ps`.

On a **fresh** database volume, the init script creates the separate `APP_DB_USER` role and grants schema access. The init script only runs when PostgreSQL initializes an empty data directory for the first time. If you reuse an existing volume, inspect/create the least-privilege app role manually before migration; changing `.env` does not rerun the init script.

Apply the versioned Prisma migrations from the built API image before starting the API or public web proxy:

```bash
sudo docker compose --env-file .env -f docker-compose.production.yml run --rm --no-deps api npx prisma migrate deploy --schema backend/prisma/schema.prisma
```

If migration fails, do not start the web service. Read the error, verify the application database URL/role, and take a backup before any corrective database operation. Never delete the Postgres volume to “fix” a migration.

---

## 10. Start the API, then Caddy

Start the API:

```bash
sudo docker compose --env-file .env -f docker-compose.production.yml up -d api
sudo docker compose --env-file .env -f docker-compose.production.yml ps
sudo docker compose --env-file .env -f docker-compose.production.yml logs --tail=150 api
```

Wait for the API healthcheck to report `healthy`. Its readiness endpoint performs a database query. Then start Caddy:

```bash
sudo docker compose --env-file .env -f docker-compose.production.yml up -d web
sudo docker compose --env-file .env -f docker-compose.production.yml ps
sudo docker compose --env-file .env -f docker-compose.production.yml logs --tail=150 web
```

Caddy obtains certificates automatically when both DNS records point to the VPS, TCP 80/443 are open in Hostinger and Ubuntu firewalls, and no other service occupies those ports.

Check from your computer:

```bash
curl -fsS https://example.com/api/v1/health/live
curl -fsS https://example.com/api/v1/health/ready
curl -I https://example.com/
curl -I https://admin.example.com/
```

Expected API responses include `{"status":"ok"...}` for liveness and `{"status":"ready"...}` for readiness. The storefront and admin should return HTTP 200 over HTTPS. Check Caddy logs if certificates or routing fail.

---

## 11. Create the first administrator

Do not create an admin by public registration. The one-off bootstrap script requires an email and a password of at least 16 characters. Leave the values out of the long-running `.env` and pass them only to the one-off container.

Run this on the VPS as `deploy` (in the project directory):

```bash
read -r -p 'Owner admin email: ' INITIAL_ADMIN_EMAIL
read -r -s -p 'Unique admin password (16+ characters): ' INITIAL_ADMIN_PASSWORD
echo
export INITIAL_ADMIN_EMAIL INITIAL_ADMIN_PASSWORD
sudo --preserve-env=INITIAL_ADMIN_EMAIL,INITIAL_ADMIN_PASSWORD \
  docker compose --env-file .env -f docker-compose.production.yml run --rm --no-deps \
  -e INITIAL_ADMIN_EMAIL -e INITIAL_ADMIN_PASSWORD \
  api node backend/dist/modules/auth/bootstrap-admin.js
unset INITIAL_ADMIN_EMAIL INITIAL_ADMIN_PASSWORD
```

If your sudo policy does not permit `--preserve-env`, run the one-off command from an authorized root shell or use a protected temporary env file and delete it immediately afterwards. Never put the password in Git, the ordinary `.env`, a screenshot, or a ticket.

The bootstrap account is marked email-verified, but administrator login still requires the email OTP flow. Confirm SMTP delivery to the admin mailbox before considering the admin console usable.

---

## 12. Configure the initial store

Sign in at `https://admin.example.com` using the new administrator account and email OTP.

Before inviting customers:

1. Configure categories and subcategories.
2. Add products, SKUs, descriptions, real product images, dimensions, weights, lead times, material/colour variants and inventory.
3. Configure each product's tax classification/rate only after professional approval.
4. Configure shipping charges and the India-only address rules.
5. Draft, preview and publish owner-approved terms, privacy, shipping, returns/refunds, custom-print terms and contact information. Do not publish placeholder legal content.
6. Verify registration, email OTP, password reset and transactional email delivery.
7. Create a non-admin customer account and verify that it cannot see another customer's addresses, orders, quotes or private assets.
8. Complete the manual test plan in `docs/manual-testing.md` and preserve the actual results.

**Initial feature restrictions:**

- `PAYMENTS_ENABLED=false` means checkout/payment initiation is disabled. Do not advertise a functioning checkout until payment sandbox acceptance passes.
- `R2_UPLOADS_ENABLED=false` means customer 3D-model/reference-file uploads remain disabled. Keep it that way until a hard pre-transfer upload-size limit is installed and verified.
- Product image storage also depends on real R2 bucket credentials, CORS and the configured public asset hostname.

---

## 13. Payment staging and live activation

The project requires complete credentials and webhook secrets for **both** providers before `PAYMENTS_ENABLED=true` is accepted. Do not put provider secrets into frontend `.env` files or Vite variables.

### 13.1 Staging

Set `DEPLOYMENT_STAGE=staging`, use Razorpay test credentials (`rzp_test_...`) and Cashfree sandbox credentials, and set:

```dotenv
CASHFREE_ENVIRONMENT=sandbox
PAYMENTS_ENABLED=true
```

Only do this after all six credentials (three per provider) are supplied. Configure these exact HTTPS webhook endpoints in the corresponding provider sandbox dashboards:

```text
https://example.com/api/v1/payments/webhooks/razorpay
https://example.com/api/v1/payments/webhooks/cashfree
```

Test success, failure, abandoned checkout, delayed status, duplicate and out-of-order webhooks, invalid signatures, amount/currency mismatch and API restart. Razorpay must be configured for the capture behavior expected by the app. Verify the final payment state from the server/provider and database, not only the browser redirect.

### 13.2 Live production

Only after staging tests, reconciliation/refund operations, tax/legal approval, security review and owner approval:

1. Back up the database and record the source revision.
2. Set `DEPLOYMENT_STAGE=production`.
3. Replace Razorpay test keys with the owner's live `rzp_live_...` key, secret and webhook secret.
4. Set Cashfree to its production environment and enter the production app ID, secret and webhook secret.
5. Set `PAYMENTS_ENABLED=true`.
6. Re-run `docker compose config --quiet`, recreate the API, and run payment smoke checks without making unintended charges.

```bash
sudo docker compose --env-file .env -f docker-compose.production.yml up -d --force-recreate api
sudo docker compose --env-file .env -f docker-compose.production.yml ps
sudo docker compose --env-file .env -f docker-compose.production.yml logs --tail=150 api
```

The repository still documents automated refunds, complete financial reconciliation, payment reservation expiry and related workflow gaps. Do not accept real money until those release blockers have an owner-approved operational process and the remaining acceptance gates pass.

---

## 14. Backups and restore readiness

The database volume is persistent, but persistence is not a backup. Back up PostgreSQL daily, encrypt the dump, copy it off the VPS, and protect the decryption identity elsewhere. R2 objects need their own retention/recovery strategy; a PostgreSQL dump does not contain object bytes.

### 14.1 Create an age key off the VPS

On a secure workstation, install `age` and generate a key:

```bash
age-keygen -o rudra-backup-identity.txt
```

Store `rudra-backup-identity.txt` offline in a controlled password manager/secure backup location. The public recipient is printed by `age-keygen` in a comment beginning `# public key:`. Put that public `age1...` recipient in your secure server environment as `BACKUP_AGE_RECIPIENT`; do not put the private identity on the VPS.

### 14.2 Create an encrypted database backup from the Postgres container

The production Compose file does not publish PostgreSQL to the VPS host. Therefore, the provided `backup-postgres.sh` (which expects a host-reachable `DATABASE_URL` and local `pg_dump`) cannot be run unchanged against `postgres:5432` from the Hostinger host. Use the Postgres container's own `pg_dump` instead:

```bash
cd /opt/rudra-creative
sudo install -d -o deploy -g deploy -m 700 /var/backups/rudra
umask 077
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP="/tmp/rudra-postgres-${STAMP}.dump"
OUT="/var/backups/rudra/postgres-${STAMP}.dump.age"

sudo docker compose --env-file .env -f docker-compose.production.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' > "$TMP"
age --recipient "$BACKUP_AGE_RECIPIENT" --output "$OUT" "$TMP"
sha256sum "$OUT" > "$OUT.sha256"
chmod 600 "$OUT" "$OUT.sha256"
rm -f "$TMP"
printf 'Encrypted backup: %s\n' "$OUT"
```

Copy the `.dump.age` and `.sha256` files to off-site storage immediately. Keep the private age identity off the VPS. Automate this command with a root/deploy-owned systemd timer or a vetted backup service and alert if the backup is missing or too old.

### 14.3 Restore drill

Before launch, restore a recent encrypted dump into a new, empty, isolated database. Do not test by restoring over production. Verify users, products, orders, payment references, constraints and that the referenced R2 objects still exist. Record recovery time and any data loss. Follow `docs/backup-restore.md`; its restore script intentionally requires an explicit target and confirmation.

---

## 15. Routine operations

Run commands from `/opt/rudra-creative`:

```bash
# Service state
sudo docker compose --env-file .env -f docker-compose.production.yml ps

# Logs
sudo docker compose --env-file .env -f docker-compose.production.yml logs --tail=200 api
sudo docker compose --env-file .env -f docker-compose.production.yml logs --tail=200 web
sudo docker compose --env-file .env -f docker-compose.production.yml logs --tail=200 postgres

# Resource/disk monitoring
free -h
df -h
sudo docker stats --no-stream
sudo docker system df
```

Set up external uptime alerts for both domains and the readiness URL. Monitor disk usage, Docker restarts/OOM events, database health, SMTP delivery, payment webhook failures and backup freshness. The repository does not configure a complete monitoring/alerting service for you.

### Safe release update

1. Validate the new source revision and lockfile in CI/workstation.
2. Copy/pull the exact release revision to the VPS; do not edit source directly on production.
3. Create and verify an encrypted database backup; confirm R2 retention.
4. Build new images sequentially.
5. Apply backward-compatible migrations from the new API image.
6. Recreate API and web services and run smoke/acceptance checks.
7. Record revision, image IDs, migration version and test evidence.

Example after new source is in place:

```bash
sudo docker compose --env-file .env --parallel 1 -f docker-compose.production.yml build
sudo docker compose --env-file .env -f docker-compose.production.yml run --rm --no-deps api npx prisma migrate deploy --schema backend/prisma/schema.prisma
sudo docker compose --env-file .env -f docker-compose.production.yml up -d api web
sudo docker compose --env-file .env -f docker-compose.production.yml ps
```

Never run `docker compose down -v` on production; it deletes persistent data volumes. Do not automatically roll back data migrations. Roll back application code only when compatible with the current schema; database restore is a deliberate owner-approved recovery operation.

---

## 16. Common problems

| Symptom | Likely cause and action |
|---|---|
| Docker build says `package-lock.json` missing | Generate/review/commit the lockfile on a connected workstation; do not remove the build guard. |
| Compose says a required variable is missing | Recheck `.env`, its permissions and current directory; validate with `config --quiet`. |
| API exits at startup | Review API logs; production requires HTTPS domain origins, 32-byte independent secrets, working SMTP, R2 configuration and owner business contact details. |
| Postgres is healthy but migration cannot connect | Check `DATABASE_URL`, APP_DB_USER/APP_DB_PASSWORD and whether the app role was created on this volume. The init script only runs on first initialization. |
| Caddy cannot issue a certificate | Check root/admin DNS A records, remove invalid AAAA records, release ports 80/443 in both firewalls, and inspect `web` logs. |
| Storefront loads but API returns 502 | API is unhealthy/not ready; inspect API logs and database readiness. |
| OTP email does not arrive | Check SMTP host/credentials, port/secure pairing (587 STARTTLS false; 465 implicit TLS true), verified sender and provider delivery logs. |
| Checkout is unavailable | `PAYMENTS_ENABLED=false`, or complete provider keys/webhooks are missing. Configure both providers and finish sandbox tests before enabling. |
| Model upload is unavailable | Expected while `R2_UPLOADS_ENABLED=false`; keep it disabled until the hard pre-transfer size cap is implemented and verified. |
| Admin works on one hostname but not the other | Check `PUBLIC_APP_DOMAIN`, `PUBLIC_ADMIN_DOMAIN`, Caddy site blocks, DNS, and exact CORS origins generated by Compose. |

---

## 17. Production launch checklist

Do not call the website production-ready until all relevant boxes have evidence:

- [ ] Reviewed `package-lock.json` committed to the release.
- [ ] `npm run secure:release` passes on the exact release commit.
- [ ] Docker images build from the same release commit and lockfile.
- [ ] Hostinger firewall permits only SSH, HTTP and HTTPS inbound as required; no DB/API/dev ports are public.
- [ ] DNS for root and admin resolves to the VPS; TLS works and renews.
- [ ] PostgreSQL role separation, migrations, restart persistence and backup restoration are tested.
- [ ] SMTP OTP and recovery email work reliably.
- [ ] R2 private/public separation, CORS, access keys, retention and restore strategy are tested.
- [ ] Hard pre-transfer upload limit is installed and oversized uploads rejected before enabling uploads.
- [ ] Razorpay and Cashfree sandbox payment/verification/webhook edge cases pass.
- [ ] Refund and uncertain-payment reconciliation have an implemented, tested operator workflow.
- [ ] Tax, invoice/receipt, GST and shipping settings are owner/accountant-approved.
- [ ] Business/legal content is approved and placeholder pages are not publicly published.
- [ ] Multi-customer authorization, admin permissions, CSRF, XSS, rate-limit and upload security checks pass.
- [ ] Monitoring, alerts, off-site backups, restore drill, incident contacts and rollback procedure exist.
- [ ] Manual acceptance tests are completed and critical/high-risk findings resolved.
- [ ] Owner explicitly approves live payment credentials and production activation.

This guide takes the project to a Hostinger **staging deployment** first. Live payment activation and customer-upload enablement are separate decisions and must wait for their release gates.

---

## Official references

- [Hostinger — Docker VPS template](https://www.hostinger.com/support/8306612-how-to-use-the-docker-vps-template-at-hostinger/)
- [Hostinger — Point a domain to your VPS](https://www.hostinger.com/support/1583227-how-to-point-a-domain-to-your-vps-at-hostinger/)
- [Hostinger — VPS firewall setup](https://www.hostinger.com/support/4805502-how-to-set-up-a-firewall-at-vps/)
- [Hostinger — Managed VPS firewall](https://www.hostinger.com/support/8172641-how-to-use-a-managed-vps-firewall-at-hostinger/)
- [Docker — Install Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Docker — Firewall limitations](https://docs.docker.com/engine/install/ubuntu/#firewall-limitations)
- [Caddy — Automatic HTTPS](https://caddyserver.com/docs/quick-starts/https)
