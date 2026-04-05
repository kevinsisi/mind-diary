## ADDED Requirements

### Requirement: GitHub Actions CI — build and push to Docker Hub
The system SHALL have a GitHub Actions workflow that triggers on push to `main`, builds the Docker image for `linux/arm64`, and pushes it to Docker Hub as `chuangkevin/mind-diary:latest`.

#### Scenario: CI build on main push
- **WHEN** code is pushed to the `main` branch
- **THEN** GitHub Actions builds the image using `docker buildx` for `linux/arm64` and pushes to `chuangkevin/mind-diary:latest`

#### Scenario: CI skipped on non-main branches
- **WHEN** code is pushed to a feature branch
- **THEN** CI build and push does not run

### Requirement: GitHub Actions CD — deploy to RPi via Tailscale SSH
The system SHALL have a GitHub Actions CD workflow that SSHes into the RPi using the Tailscale hostname (`rpi-matrix.bunny-salmon.ts.net`) and runs `docker compose pull && docker compose up -d` to update the running container.

#### Scenario: CD deployment after CI
- **WHEN** CI push to Docker Hub succeeds
- **THEN** CD workflow connects to RPi via Tailscale SSH, pulls the new image, and restarts the container with zero-downtime

#### Scenario: SSH key in GitHub Secrets
- **WHEN** CD workflow needs to connect to RPi
- **THEN** it uses the SSH private key stored in `RPi_SSH_KEY` GitHub Secret and connects to `kevin@rpi-matrix.bunny-salmon.ts.net`

### Requirement: Accessible at diary.sisihome.org
The system SHALL be accessible at `https://diary.sisihome.org` (HTTPS via Caddy wildcard TLS) and `http://diary.sisihome` (HTTP legacy via Pi-hole dnsmasq). The service runs on port 8823.

#### Scenario: HTTPS access
- **WHEN** user visits https://diary.sisihome.org from a Tailscale-connected device
- **THEN** Caddy terminates TLS and proxies to localhost:8823

#### Scenario: URL updated from vault.sisihome.org
- **WHEN** checking the Caddyfile
- **THEN** the service is registered under the `diary` subdomain, not `vault` (which was the original placeholder in early specs)
