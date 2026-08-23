# Staging deployment

GitHub Actions builds and tests the Angular and .NET applications, publishes
immutable images to GHCR, transfers the exact tested images to the server over
SSH, and then starts them with Docker Compose. The server never stores a GitHub
registry credential.

## One-time server preparation

1. Give `iqama6368` permission to run Docker, or provide an equivalent narrowly
   scoped deployment command. The current account can SSH but cannot access
   `/var/run/docker.sock`.
2. Copy `.env.staging.example` to
   `/home/iqama.momyum.com/deentime/.env.staging`, fill the secret values, and
   restrict it to the deployment user.
3. Configure the `iqama.momyum.com` OpenLiteSpeed virtual host to proxy `/` to
   `127.0.0.1:10080`. OpenLiteSpeed continues to terminate the existing
   Let's Encrypt certificate; the web container serves Angular and proxies API
   paths to the .NET container on `127.0.0.1:18080`.
4. Add the private deployment key to the GitHub repository secret named
   `STAGING_SSH_PRIVATE_KEY`.

The workflow pins the server's current ED25519 host key and verifies the public
website, `/health/ready`, and `/api/version` after each deployment. A failed
local health check automatically returns to the previously deployed image tag.
