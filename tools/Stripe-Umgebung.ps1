# Laedt den Stripe-TESTZUGANG der Sandbox "Stripe-Muster-Plattform" (acct_1UaLBWCx6kxDAyXX, Projekt 4 Muster) in die AKTUELLE PowerShell-Sitzung.
# Aufruf (mit Punkt, damit die Variablen in der Sitzung bleiben):   . .\tools\Stripe-Umgebung.ps1
# Die Werte liegen verschluesselt im Benutzerspeicher (DPAPI, nur dieser Windows-Benutzer auf diesem PC):
#   %USERPROFILE%\.claude\secrets\stripe-muster-sk-test.dpapi          (sk_test_...)
#   %USERPROFILE%\.claude\secrets\stripe-muster-whsec.dpapi   (whsec_..., fuer "stripe listen" lokal)
# Sie werden nie ausgegeben und nie in eine Datei geschrieben. Nur Testmodus: alles ausser sk_test_ wird abgelehnt.
$dir = Join-Path $env:USERPROFILE '.claude\secrets'
function Get-SecretPlain([string]$datei) {
    $p = Join-Path $dir $datei
    if (-not (Test-Path $p)) { return $null }
    $ss = Get-Content $p | ConvertTo-SecureString
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
$schluessel = Get-SecretPlain 'stripe-muster-sk-test.dpapi'
if (-not $schluessel -or -not $schluessel.StartsWith('sk_test_')) { throw 'Kein Stripe-Testschluessel (sk_test_) gefunden. Abbruch: nur Testmodus.' }
$env:STRIPE_SECRET_KEY = $schluessel
$env:STRIPE_WEBHOOK_SECRET = Get-SecretPlain 'stripe-muster-whsec.dpapi'
Remove-Variable schluessel
"Geladen: STRIPE_SECRET_KEY=$([bool]$env:STRIPE_SECRET_KEY) (nur sk_test_), STRIPE_WEBHOOK_SECRET=$([bool]$env:STRIPE_WEBHOOK_SECRET)"
