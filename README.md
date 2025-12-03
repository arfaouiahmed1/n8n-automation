# n8n Custom Docker Setup

This project provides a custom Docker setup for n8n, pre-configured with:
- **Python 3** (in a virtual environment)
- **Puppeteer** (with Chromium)
- **Custom Python Requirements**

## Project Structure

- `docker-compose.yml`: Main Docker service configuration.
- `Dockerfile`: Custom image definition based on `node:20-slim`.
- `requirements.txt`: Python packages to install.
- `.env`: Environment variables (copy from `.env.example`).
- `scripts/`: Helper scripts for managing the stack.
- `data/`: Persistent data for n8n (ignored by git).

## Caching Strategy

The `Dockerfile` is optimized for build speed:
1.  **System Dependencies**: Cached unless you change the `apt-get` commands.
2.  **n8n/Puppeteer**: Cached unless you change the `npm install` command.
3.  **Python Requirements**: Cached unless `requirements.txt` changes.
    - If you only change your scripts or `docker-compose.yml`, the build will skip the slow install steps!

## Prerequisites

- Docker Desktop (or Docker Engine + Compose)
- PowerShell (for scripts)

## Getting Started

1.  **Setup Environment**:
    Copy `.env.example` to `.env` and adjust if needed.
    ```powershell
    Copy-Item .env.example .env
    ```

2.  **Build and Start**:
    Run the rebuild script to build the image and start the container.
    ```powershell
    ./scripts/rebuild.ps1
    ```

3.  **Access n8n**:
    Open [http://localhost:5678](http://localhost:5678) in your browser.

## Scripts

- `./scripts/rebuild.ps1`: Stops containers, rebuilds the image, starts services, and waits for health check.
- `./scripts/start.ps1`: Starts the existing containers.
- `./scripts/stop.ps1`: Stops and removes the containers.
