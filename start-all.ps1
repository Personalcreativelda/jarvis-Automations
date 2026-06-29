$ErrorActionPreference = "SilentlyContinue"
$AGENT_PATH = "C:\Users\Personalcreativelda\Desktop\jarvis-agent\agent.js"
$CF_EXE     = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$CF_LOG     = "$env:TEMP\jarvis-cf-tunnel.log"
$AGENT_PORT = 4000

Write-Host ""
Write-Host "  === JARVIS STARTUP ===" -ForegroundColor Cyan
Write-Host ""

# 0. Actualizar o prompt com a memória pessoal mais recente
$updateScript = "C:\Users\Personalcreativelda\Desktop\jarvis-agent\update-prompt.ps1"
if (Test-Path $updateScript) {
    Write-Host "  [0/3] A injectar memória pessoal no prompt..." -ForegroundColor Yellow
    & powershell -NoProfile -ExecutionPolicy Bypass -File $updateScript
}

# 1. Terminar apenas o processo na porta 4000 (jarvis-agent anterior)
Write-Host "  [1/3] A terminar jarvis-agent anterior na porta $AGENT_PORT..." -ForegroundColor Yellow
$oldPid = (Get-NetTCPConnection -LocalPort $AGENT_PORT -State Listen -ErrorAction SilentlyContinue).OwningProcess
if ($oldPid) {
    Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    Write-Host "        Processo PID $oldPid terminado." -ForegroundColor Green
} else {
    Write-Host "        Nenhum processo encontrado na porta $AGENT_PORT." -ForegroundColor DarkGray
}
Start-Sleep -Milliseconds 400

# 2. Arrancar jarvis-agent
Write-Host "  [2/3] A arrancar jarvis-agent na porta $AGENT_PORT..." -ForegroundColor Yellow
$agentProc = Start-Process -FilePath "node" `
    -ArgumentList "`"$AGENT_PATH`"" `
    -WindowStyle Minimized `
    -PassThru
Start-Sleep -Milliseconds 800
if ($agentProc -and -not $agentProc.HasExited) {
    Write-Host "        OK (PID: $($agentProc.Id))" -ForegroundColor Green
} else {
    Write-Host "        AVISO: agente pode nao ter arrancado." -ForegroundColor Red
}

# 3. Arrancar cloudflared e capturar URL
Write-Host "  [3/3] A iniciar tunel cloudflared..." -ForegroundColor Yellow
Remove-Item $CF_LOG -Force 2>$null

# Terminar cloudflared anterior se existir
Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300

$cfProc = Start-Process -FilePath $CF_EXE `
    -ArgumentList "tunnel --url http://localhost:$AGENT_PORT" `
    -RedirectStandardError $CF_LOG `
    -WindowStyle Minimized `
    -PassThru

# Aguardar URL (ate 20 segundos)
$tunnelUrl = $null
$deadline = (Get-Date).AddSeconds(20)
Write-Host "        A aguardar URL do cloudflared..." -ForegroundColor DarkGray

while ((Get-Date) -lt $deadline -and -not $tunnelUrl) {
    Start-Sleep -Milliseconds 600
    if (Test-Path $CF_LOG) {
        $content = Get-Content $CF_LOG -Raw
        if ($content -match "https://[a-z0-9\-]+\.trycloudflare\.com") {
            $tunnelUrl = $Matches[0]
        }
    }
}

Write-Host ""
if ($tunnelUrl) {
    $tunnelUrl | Set-Clipboard
    Write-Host "  +---------------------------------------------------------+" -ForegroundColor Cyan
    Write-Host "  |  CLOUDFLARED URL (copiada para clipboard):              |" -ForegroundColor Cyan
    Write-Host "  |                                                         |" -ForegroundColor Cyan
    Write-Host "  |  $tunnelUrl" -ForegroundColor White
    Write-Host "  |                                                         |" -ForegroundColor Cyan
    Write-Host "  |  Cola esta URL no n8n como webhook do agente local.     |" -ForegroundColor DarkCyan
    Write-Host "  +---------------------------------------------------------+" -ForegroundColor Cyan
} else {
    Write-Host "  AVISO: Nao foi possivel capturar a URL do cloudflared." -ForegroundColor Red
    Write-Host "         Verifica manualmente: $CF_LOG" -ForegroundColor DarkRed
}

Write-Host ""
Write-Host "  A arrancar Vite em http://localhost:8080/" -ForegroundColor Green
Write-Host "  (Ctrl+C para parar o Vite)" -ForegroundColor DarkGray
Write-Host ""

# 4. Arrancar Vite (bloqueia o terminal)
Set-Location $PSScriptRoot
npm run dev
