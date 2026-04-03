## ADDED Requirements

### Requirement: Docker Compose deployment
The system SHALL be deployable via a single `docker compose up -d` command. The Dockerfile SHALL use multi-stage build: build stage compiles TypeScript and bundles frontend, runtime stage runs the Express server.

#### Scenario: Build and start
- **WHEN** `docker compose up -d --build` is run on RPi
- **THEN** container builds successfully on aarch64, starts Express server on port 8823

#### Scenario: Data persistence
- **WHEN** container is recreated
- **THEN** SQLite database and uploaded files persist via Docker volume mounts

### Requirement: Port and network configuration
The system SHALL expose port 8823 on the host. The container SHALL NOT use IPv6.

#### Scenario: Port binding
- **WHEN** container starts
- **THEN** Express server listens on 0.0.0.0:8823

#### Scenario: Health check
- **WHEN** Caddy proxies a request to localhost:8823
- **THEN** the service responds with 200 OK

### Requirement: Caddy reverse proxy integration
The system SHALL be accessible at vault.sisihome.org (HTTPS) and vault.sisihome (HTTP) via Caddy reverse proxy.

#### Scenario: HTTPS access
- **WHEN** user visits https://vault.sisihome.org
- **THEN** Caddy terminates TLS and proxies to localhost:8823

#### Scenario: HTTP legacy access
- **WHEN** user visits http://vault.sisihome
- **THEN** Caddy proxies to localhost:8823

### Requirement: Environment configuration
The system SHALL read configuration from environment variables: GEMINI_API_KEYS, PORT (default 8823), DATABASE_PATH (default ./data/mind-diary.db).

#### Scenario: Custom database path
- **WHEN** DATABASE_PATH=/data/custom.db is set
- **THEN** system uses /data/custom.db as the SQLite database path

#### Scenario: Default configuration
- **WHEN** no environment variables are set (except GEMINI_API_KEYS)
- **THEN** system starts on port 8823 with database at ./data/mind-diary.db
