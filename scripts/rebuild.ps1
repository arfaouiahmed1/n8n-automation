# Rebuild the entire stack
$ErrorActionPreference = "Stop"

$startTime = Get-Date

Write-Host "Stopping and removing containers..."
# Force remove the specific container to avoid name conflicts
# We use 'docker rm -f' and ignore errors (if it doesn't exist) to be robust
try { docker rm -f n8n-custom } catch {}
docker compose down --remove-orphans

Write-Host "Building images (using cache if possible)..."
docker compose build

Write-Host "Starting services..."
docker compose up -d

$endTime = Get-Date
$duration = $endTime - $startTime

# Format duration nicely
$timeParts = @()
if ($duration.Hours -gt 0) { $timeParts += "$($duration.Hours) hours" }
if ($duration.Minutes -gt 0) { $timeParts += "$($duration.Minutes) minutes" }
$timeParts += "$($duration.Seconds) seconds"
$timeString = $timeParts -join " "

Write-Host "Build and start completed in $timeString." -ForegroundColor Green

# Health Check Loop
Write-Host "Waiting for n8n to be ready..."
$maxRetries = 30
$retryCount = 0
$healthy = $false

while ($retryCount -lt $maxRetries) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:5678/healthz" -UseBasicParsing -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            $healthy = $true
            break
        }
    } catch {
        # Ignore errors and retry
    }
    
    Write-Host "." -NoNewline
    Start-Sleep -Seconds 2
    $retryCount++
}

Write-Host "" # Newline

if ($healthy) {
    Write-Host "n8n is ready! Open your browser to http://localhost:5678" -ForegroundColor Green
} else {
    Write-Host "Timed out waiting for n8n to be ready. Check logs with: docker compose logs -f" -ForegroundColor Red
}
