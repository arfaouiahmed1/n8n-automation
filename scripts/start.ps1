# Start the stack
$ErrorActionPreference = "Stop"

Write-Host "Starting services..."
docker compose up -d

Write-Host "n8n is running at http://localhost:5678"