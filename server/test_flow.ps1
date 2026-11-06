# Login as Dev User and test category creation + file upload
$curl = "C:\Windows\System32\curl.exe"
$baseUrl = "http://localhost:8787"
$cookieFile = "E:\proeject\tg drive\tgstore\server\cookies.txt"
$tempDir = "$env:TEMP\tgtest"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

# Create JSON payload file to avoid PowerShell escaping
$catJson = '{"name":"Photos"}'
Set-Content -Path "$tempDir\cat.json" -Value $catJson

Write-Output "=== Step 1: Login (Dev) ==="
$login = & $curl -s -X POST "$baseUrl/api/auth/dev" -H "Content-Type: application/json" -d '{}' -c $cookieFile
Write-Output $login

Write-Output "`n=== Step 2: Create category 'Photos' ==="
$cat = & $curl -s -X POST "$baseUrl/api/categories" -H "Content-Type: application/json" --data "@$tempDir\cat.json" -b $cookieFile
Write-Output $cat

Write-Output "`n=== Step 3: List categories ==="
& $curl -s "$baseUrl/api/categories" -b $cookieFile

Write-Output "`n`n=== Step 4: Create test file ==="
Set-Content -Path "$tempDir\test_upload.txt" -Value "TGStore test upload for category system"
Get-Content "$tempDir\test_upload.txt"

Write-Output "`n=== Step 5: Upload file to category ==="
# Get the actual category ID from the response
$catData = $cat | ConvertFrom-Json
$catId = $catData.category.id
Write-Output "Using categoryId: $catId"
& $curl -s -X POST "$baseUrl/api/files/upload" -F "file=@$tempDir\test_upload.txt" -F "categoryId=$catId" -F "name=test_upload.txt" -b $cookieFile

Write-Output "`n=== Step 6: List files ==="
& $curl -s "$baseUrl/api/drive?categoryId=$catId" -b $cookieFile

# Cleanup
Remove-Item $cookieFile -ErrorAction SilentlyContinue