# Ping Monorepo - Interactive Service Manager

$root = $PSScriptRoot
if (-not $root) { $root = Get-Location }

function Show-Menu {
    Write-Host ""
    Write-Host "  ========= Ping Monorepo =========" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  --- Start ---" -ForegroundColor DarkCyan
    Write-Host "  [1] Start All (Backend + Frontend)" -ForegroundColor White
    Write-Host "  [2] Start Backend" -ForegroundColor White
    Write-Host "  [3] Start Frontend" -ForegroundColor White
    Write-Host "  [4] Start Registry" -ForegroundColor White
    Write-Host "  [5] Start MongoDB" -ForegroundColor White
    Write-Host ""
    Write-Host "  --- Stop ---" -ForegroundColor DarkCyan
    Write-Host "  [6] Stop All" -ForegroundColor Red
    Write-Host "  [7] Stop Backend" -ForegroundColor Red
    Write-Host "  [8] Stop Frontend" -ForegroundColor Red
    Write-Host "  [9] Stop Registry" -ForegroundColor Red
    Write-Host "  [10] Stop MongoDB" -ForegroundColor Red
    Write-Host ""
    Write-Host "  --- Build ---" -ForegroundColor DarkCyan
    Write-Host "  [11] Build All" -ForegroundColor Yellow
    Write-Host "  [12] Build Backend" -ForegroundColor Yellow
    Write-Host "  [13] Install Dependencies" -ForegroundColor Yellow
    Write-Host "  [14] Status" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "  --- Dev ---" -ForegroundColor DarkCyan
    Write-Host "  [20] Dev Start (Reset DB + Seed + Start All)" -ForegroundColor Green
    Write-Host "  [21] Seed DB (teams + agents + admin)" -ForegroundColor Green
    Write-Host "  [22] Reset DB (drop all data)" -ForegroundColor Red
    Write-Host "  [23] Seed Admin User only" -ForegroundColor Green
    Write-Host ""
    Write-Host "  [0] Exit" -ForegroundColor DarkGray
    Write-Host ""
}

function Start-Service($name, $dir, $cmd, $windowTitle) {
    $existing = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq $windowTitle }
    if ($existing) {
        Write-Host "  $name is already running" -ForegroundColor DarkYellow
        return
    }
    Write-Host "  Starting $name..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList @(
        "-NoExit", "-Command",
        "`$Host.UI.RawUI.WindowTitle = '$windowTitle'; Set-Location '$dir'; Write-Host '=== $name ===' -ForegroundColor Cyan; $cmd"
    )
    Write-Host "  $name started" -ForegroundColor Green
}

function Stop-ServiceByPort($name, $port) {
    $found = $false
    $lines = netstat -ano 2>$null | Select-String ":${port}\s.*LISTENING"
    foreach ($line in $lines) {
        $parts = ($line.ToString().Trim()) -split '\s+'
        $pid = $parts[-1]
        if ($pid -and $pid -ne '0') {
            try {
                $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
                Stop-Process -Id $pid -Force -ErrorAction Stop
                Write-Host "  $name stopped (PID $pid, port $port)" -ForegroundColor Green
                $found = $true
            } catch {
                # Process may have already exited
            }
        }
    }
    if (-not $found) {
        Write-Host "  $name is not running (port $port)" -ForegroundColor DarkGray
    }
}

function Build-Package($name, $dir, $cmd) {
    Write-Host "  Building $name..." -ForegroundColor Yellow
    Push-Location $dir
    Invoke-Expression $cmd
    Pop-Location
    Write-Host "  $name built" -ForegroundColor Green
}

function Get-MongoConfig {
    $envFile = "$root\packages\backend\.env"
    $uri = "mongodb://localhost:27017"
    $port = "27017"
    if (Test-Path $envFile) {
        $line = Get-Content $envFile | Where-Object { $_ -match '^MONGODB_URI=' }
        if ($line) {
            $uri = ($line -split '=', 2)[1].Trim()
            if ($uri -match ':([0-9]+)') { $port = $Matches[1] }
        }
    }
    return @{ Uri = $uri; Port = $port }
}

function Start-MongoDB {
    $config = Get-MongoConfig
    $mongo = Get-Process mongod -ErrorAction SilentlyContinue
    if ($mongo) {
        Write-Host "  MongoDB is already running (PID $($mongo.Id))" -ForegroundColor DarkYellow
        Write-Host "  URI: $($config.Uri)" -ForegroundColor DarkGray
        return
    }
    Write-Host "  Starting MongoDB on port $($config.Port)..." -ForegroundColor Yellow
    Write-Host "  URI: $($config.Uri)" -ForegroundColor DarkGray
    # Try Docker first
    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if ($docker) {
        docker start ping-mongo 2>$null
        if ($LASTEXITCODE -ne 0) {
            docker run -d --name ping-mongo -p "$($config.Port):27017" -v ping-mongo-data:/data/db mongo:7
        }
        Write-Host "  MongoDB started (Docker)" -ForegroundColor Green
    } else {
        # Try local mongod
        $mongodExe = (Get-ChildItem "C:\Program Files\MongoDB\Server\*\bin\mongod.exe" -ErrorAction SilentlyContinue | Select-Object -Last 1).FullName
        if ($mongodExe) {
            Start-Process $mongodExe -ArgumentList "--port", $config.Port, "--dbpath", "C:\data\db" -WindowStyle Minimized
            Write-Host "  MongoDB started (local)" -ForegroundColor Green
        } else {
            Write-Host "  MongoDB not found! Install MongoDB or Docker." -ForegroundColor Red
        }
    }
}

function Stop-MongoDB {
    # Try Docker
    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if ($docker) {
        docker stop ping-mongo 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  MongoDB stopped (Docker)" -ForegroundColor Green
            return
        }
    }
    # Try local process (needs admin to stop a Windows service)
    $mongo = Get-Process mongod -ErrorAction SilentlyContinue
    if ($mongo) {
        try {
            $mongo | Stop-Process -Force -ErrorAction Stop
            Write-Host "  MongoDB stopped" -ForegroundColor Green
        } catch {
            Write-Host "  MongoDB requires admin privileges to stop. Run:" -ForegroundColor Red
            Write-Host "    net stop MongoDB" -ForegroundColor Yellow
            Write-Host "  Or stop it from Services (services.msc)" -ForegroundColor DarkGray
        }
    } else {
        Write-Host "  MongoDB is not running" -ForegroundColor DarkGray
    }
}

function Show-Status {
    Write-Host ""
    # Backend (port 3002)
    $be = netstat -ano 2>$null | Select-String ":3002\s.*LISTENING"
    if ($be) { Write-Host "  Backend   http://localhost:3002    RUNNING" -ForegroundColor Green }
    else     { Write-Host "  Backend   http://localhost:3002    STOPPED" -ForegroundColor Red }

    # Frontend (port 3000)
    $fe = netstat -ano 2>$null | Select-String ":3000\s.*LISTENING"
    if ($fe) { Write-Host "  Frontend  http://localhost:3000    RUNNING" -ForegroundColor Green }
    else     { Write-Host "  Frontend  http://localhost:3000    STOPPED" -ForegroundColor Red }

    # MongoDB (port 27017)
    $mongo = Get-Process mongod -ErrorAction SilentlyContinue
    if ($mongo) { Write-Host "  MongoDB   localhost:27017        RUNNING" -ForegroundColor Green }
    else        { Write-Host "  MongoDB   localhost:27017        STOPPED" -ForegroundColor Red }

    Write-Host ""
}

function Reset-Database {
    Write-Host "  Resetting database..." -ForegroundColor Yellow
    Push-Location "$root\packages\backend"
    bun run db:reset
    Pop-Location
    Write-Host "  Database reset complete" -ForegroundColor Green
}

function Seed-Database {
    Write-Host "  Seeding database..." -ForegroundColor Yellow
    Push-Location "$root\packages\backend"
    bun run seed
    Write-Host "  Seeding admin user..." -ForegroundColor Yellow
    bun run seed:admin
    Pop-Location
    Write-Host "  Database seeded (including admin user)" -ForegroundColor Green
}

# Main loop
while ($true) {
    Show-Menu
    $choice = Read-Host "  Choose"

    switch ($choice) {
        "1" {
            Write-Host ""
            Set-Location $root; bun install 2>$null
            Start-MongoDB
            Build-Package "All Packages" "$root" "bun run build"
            Start-Service "Backend"  "$root\packages\backend"  "bun dist/server.js" "Ping - Backend"
            Start-Sleep -Seconds 2
            Start-Service "Frontend" "$root\packages\frontend" "bun run dev"       "Ping - Frontend"
        }
        "2" {
            Build-Package "All Packages" "$root" "bun run build"
            Start-Service "Backend" "$root\packages\backend" "bun dist/server.js" "Ping - Backend"
        }
        "3" {
            Start-Service "Frontend" "$root\packages\frontend" "bun run dev" "Ping - Frontend"
        }
        "4" {
            Build-Package "Registry" "$root\packages\registry" "bun run build"
            Start-Service "Registry" "$root\packages\registry" "bun run start" "Ping - Registry"
        }
        "5" {
            Start-MongoDB
        }
        "6" {
            Stop-ServiceByPort "Backend"  3002
            Stop-ServiceByPort "Frontend" 3000
            Stop-MongoDB
        }
        "7"  { Stop-ServiceByPort "Backend"  3002 }
        "8"  { Stop-ServiceByPort "Frontend" 3000 }
        "9"  { Stop-ServiceByPort "Registry" 3001 }
        "10" { Stop-MongoDB }
        "11" {
            Build-Package "All Packages" "$root" "bun run build"
        }
        "12" { Build-Package "All Packages" "$root" "bun run build" }
        "13" { Set-Location $root; bun install }
        "14" { Show-Status }
        "20" {
            Write-Host ""
            Write-Host "  === Dev Start ===" -ForegroundColor Green
            Set-Location $root; bun install 2>$null
            Start-MongoDB
            Start-Sleep -Seconds 2
            Reset-Database
            Seed-Database
            Build-Package "All Packages" "$root" "bun run build"
            Start-Service "Backend"  "$root\packages\backend"  "bun dist/server.js" "Ping - Backend"
            Start-Sleep -Seconds 2
            Start-Service "Frontend" "$root\packages\frontend" "bun run dev"       "Ping - Frontend"
            Write-Host ""
            Write-Host "  Dev environment ready with seed data!" -ForegroundColor Green
        }
        "21" {
            Start-MongoDB
            Start-Sleep -Seconds 2
            Seed-Database
        }
        "22" {
            $confirm = Read-Host "  This will DELETE all data. Continue? [y/N]"
            if ($confirm -eq "y") {
                Start-MongoDB
                Start-Sleep -Seconds 2
                Reset-Database
            } else {
                Write-Host "  Cancelled" -ForegroundColor DarkGray
            }
        }
        "23" {
            Start-MongoDB
            Start-Sleep -Seconds 2
            Write-Host "  Seeding admin user..." -ForegroundColor Yellow
            Push-Location "$root\packages\backend"
            bun run seed:admin
            Pop-Location
            Write-Host "  Admin user seeded" -ForegroundColor Green
        }
        "0"  { Write-Host "  Bye!" -ForegroundColor DarkGray; break }
        default { Write-Host "  Invalid option" -ForegroundColor Red }
    }
}
