# Scheibe 18: Konto (isolierte Wegwerf-Datenbank, kein echter Stripe-/Mailversand)
$ErrorActionPreference = 'Stop'
$wurzel = Split-Path -Parent $PSScriptRoot
Push-Location $wurzel
try {
  & node --disable-warning=ExperimentalWarning tools/selbsttest-konto.mjs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally { Pop-Location }
