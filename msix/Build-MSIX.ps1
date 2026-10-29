# Build reproduzivel do MSIX - Horizonte de Cuidado
# Uso: powershell -ExecutionPolicy Bypass -File msix\Build-MSIX.ps1
# Requer: Node/pnpm, .NET Framework 4.8 (csc), Windows SDK (makeappx/signtool).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$msix = Join-Path $root 'msix'
$staging = Join-Path $msix 'staging'
$lib = Join-Path $msix 'lib'
$manifestTemplate = Join-Path $msix 'AppxManifest.xml'
$sdkRoot = 'C:\Program Files (x86)\Windows Kits\10\bin'
$sdkBin = Get-ChildItem $sdkRoot -Directory |
  Where-Object { Test-Path (Join-Path $_.FullName 'x64\makeappx.exe') } |
  Sort-Object Name -Descending | Select-Object -First 1 |
  ForEach-Object { Join-Path $_.FullName 'x64' }
if (-not $sdkBin) { throw 'Windows SDK com makeappx.exe nao encontrado.' }
$makeappx = Join-Path $sdkBin 'makeappx.exe'
$signtool = Join-Path $sdkBin 'signtool.exe'
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$utf8 = New-Object System.Text.UTF8Encoding($false)

$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$version = [string]$pkg.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "package.json version invalida: $version" }
$version4 = "$version.0"
$appVersion = $version

Write-Host "== Horizonte de Cuidado $version4 ==" -ForegroundColor Cyan
Push-Location $root
try {
  & pnpm build
  if ($LASTEXITCODE -ne 0) { throw 'pnpm build falhou.' }
} finally { Pop-Location }

if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Force -Path $staging, (Join-Path $staging 'www'), (Join-Path $staging 'Assets') | Out-Null

# WebView2: DLLs fixadas em msix/lib (versao 1.0.2903.40) para build offline.
Copy-Item (Join-Path $lib '*.dll') $staging -Force

# App web + documentos legais locais.
Copy-Item (Join-Path $root 'dist\*') (Join-Path $staging 'www') -Recurse -Force
if (Test-Path (Join-Path $root 'public\legal')) {
  New-Item -ItemType Directory -Force -Path (Join-Path $staging 'www\legal') | Out-Null
  Copy-Item (Join-Path $root 'public\legal\*') (Join-Path $staging 'www\legal') -Recurse -Force
}

# Assets de identidade visual.
Copy-Item (Join-Path $msix 'Assets\*') (Join-Path $staging 'Assets') -Recurse -Force

# Manifesto com versao carimbada.
$manifest = [System.IO.File]::ReadAllText($manifestTemplate, $utf8)
$manifest = [regex]::Replace($manifest, '(?m)^(\s*Version=")[0-9.]+(")',
  { param($m) $m.Groups[1].Value + $version4 + $m.Groups[2].Value })
[System.IO.File]::WriteAllText((Join-Path $staging 'AppxManifest.xml'), $manifest, $utf8)

# OAuth Desktop. O arquivo nunca e versionado; se nao existir, o pacote
# compila e a UI mostra "nuvem nao configurada" (bloqueio documentado).
$clientCandidates = @(
  (Join-Path $root 'google-client.json'),
  (Join-Path $msix 'google-client.json')
)
$client = $clientCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($client) {
  Copy-Item $client (Join-Path $staging 'google-client.json') -Force
  Write-Host 'OAuth: google-client.json incluido no pacote.' -ForegroundColor Yellow
} else {
  Write-Host 'OAuth: google-client.json ausente; o app abrira sem nuvem configurada.' -ForegroundColor Yellow
}

# Compila o host WinForms/WebView2.
$hostExe = Join-Path $staging 'HorizonteDeCuidado.exe'
$webViewForms = Join-Path $staging 'Microsoft.Web.WebView2.WinForms.dll'
$webViewCore = Join-Path $staging 'Microsoft.Web.WebView2.Core.dll'
$launcher = Join-Path $msix 'src\Launcher.cs'
& $csc /target:winexe /platform:x64 `
  "/out:$hostExe" `
  "/reference:$webViewForms" `
  "/reference:$webViewCore" `
  /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.dll `
  /reference:System.Net.Http.dll /reference:System.Security.dll /reference:System.Web.Extensions.dll `
  $launcher
if ($LASTEXITCODE -ne 0) { throw 'Compilacao do host falhou.' }

# Nunca empacotar cache, cookies, sessao ou perfil WebView2.
Get-ChildItem $staging -Recurse -Force -Directory |
  Where-Object { $_.Name -like '*.WebView2' } |
  ForEach-Object { Remove-Item $_.FullName -Recurse -Force }

$outDir = Join-Path $root 'entregas'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$out = Join-Path $outDir ("HorizonteDeCuidado_{0}_x64.msix" -f $version4)

& $makeappx pack /d $staging /p $out /nv /o
if ($LASTEXITCODE -ne 0) { throw 'makeappx falhou.' }

# Certificado de teste local. O .pfx e a senha ficam fora do git.
$pfx = Join-Path $msix 'devcert.pfx'
$cer = Join-Path $outDir 'HorizonteDeCuidado-dev.cer'
$passwordFile = Join-Path $msix '.devcert-password'
if (-not (Test-Path $pfx)) {
  $password = $env:HORIZONTE_CERT_PASSWORD
  if (-not $password) {
    if (Test-Path $passwordFile) {
      $password = (Get-Content $passwordFile -Raw).Trim()
    } else {
      $bytes = New-Object byte[] 18
      [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
      $password = [Convert]::ToBase64String($bytes).Replace('/', 'A').Replace('+', 'B')
      [System.IO.File]::WriteAllText($passwordFile, $password, $utf8)
    }
  }
  $secure = ConvertTo-SecureString -String $password -AsPlainText -Force
  $cert = New-SelfSignedCertificate -Type Custom -Subject 'CN=57BB464E-553F-45B6-A4ED-B253157408EB' `
    -KeyUsage DigitalSignature -FriendlyName 'Horizonte de Cuidado (teste)' `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3')
  Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $secure | Out-Null
  Export-Certificate -Cert $cert -FilePath $cer | Out-Null
  Write-Host "Certificado de teste criado: $pfx" -ForegroundColor Yellow
} elseif (-not (Test-Path $cer)) {
  $secure = ConvertTo-SecureString -String ((Get-Content $passwordFile -Raw).Trim()) -AsPlainText -Force
  $cert = Get-PfxCertificate -FilePath $pfx
  Export-Certificate -Cert $cert -FilePath $cer | Out-Null
}

$password = if ($env:HORIZONTE_CERT_PASSWORD) { $env:HORIZONTE_CERT_PASSWORD } else { (Get-Content $passwordFile -Raw).Trim() }
& $signtool sign /fd SHA256 /f $pfx /p $password $out
if ($LASTEXITCODE -ne 0) { throw 'Assinatura do MSIX falhou.' }

# Verificacao do artefato final (nao apenas do fonte).
$checkDir = Join-Path $env:TEMP ('horizonte-msix-check-' + [Guid]::NewGuid().ToString('N'))
& $makeappx unpack /p $out /d $checkDir /o | Out-Null
$packedManifest = [System.IO.File]::ReadAllText((Join-Path $checkDir 'AppxManifest.xml'), $utf8)
if ($packedManifest -notmatch [regex]::Escape($version4)) { throw 'Versao do manifesto empacotado nao confere.' }
if (-not (Test-Path (Join-Path $checkDir 'www\index.html'))) { throw 'www/index.html ausente no pacote.' }
if (-not (Test-Path (Join-Path $checkDir 'HorizonteDeCuidado.exe'))) { throw 'Executavel ausente no pacote.' }
$leak = Get-ChildItem $checkDir -Recurse -Force | Where-Object { $_.FullName -match '\.WebView2($|\\)' }
if ($leak) { throw 'Dados de perfil WebView2 encontrados no pacote.' }
Remove-Item $checkDir -Recurse -Force

$hash = (Get-FileHash $out -Algorithm SHA256).Hash
Write-Host "OK: $out" -ForegroundColor Green
Write-Host "SHA256: $hash"
Write-Host "Certificado publico: $cer"
