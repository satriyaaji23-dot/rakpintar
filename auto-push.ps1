param(
  [string]$Message = ""
)

$ErrorActionPreference = "Stop"

$status = git status --porcelain
if ($status) {
  if ([string]::IsNullOrWhiteSpace($Message)) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $Message = "Update Smart Shoe Rack Web ($timestamp)"
  }
  git add -A
  git commit -m $Message
} else {
  $branch = (git rev-parse --abbrev-ref HEAD).Trim()
  Write-Host "Tidak ada perubahan baru untuk di-commit. Mengecek push ke origin/$branch..."
  git push origin $branch
}

