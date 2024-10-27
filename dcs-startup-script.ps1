# ------------------------ DISK INITIALIZATION
$disk = Get-Disk | Where-Object PartitionStyle -eq 'RAW'

try {
  # Initialize the disk
  $disk | Initialize-Disk -PartitionStyle GPT -PassThru

  # Create a new partition using the maximum size available
  $partition = $disk | New-Partition -UseMaximumSize -AssignDriveLetter

  # Format the partition
  $partition | Format-Volume -FileSystem NTFS -NewFileSystemLabel "DataDisk" -Confirm:$false -Force

  # Output the results
  Write-Host "Disk initialization completed successfully"
  Write-Host "Drive letter assigned: $($partition.DriveLetter)"
  Write-Host "Volume label: DataDisk"
  Write-Host "Size: $([math]::Round($partition.Size/1GB,2)) GB"
}
catch {
  Write-Host "An error occurred during disk initialization:"
  Write-Host $_.Exception.Message
  exit 1
}

# Verify the disk is online and healthy
Get-Disk | Where-Object Number -eq $disk.Number | Select-Object Number, OperationalStatus, HealthStatus
Get-Volume | Where-Object DriveLetter -eq $partition.DriveLetter

# ------------------------ FIREWALL
$rules = @(
  @{Name = "DCS Server"; Port = 10308 },
  @{Name = "SRS Server"; Port = 5002 },
  @{Name = "DCS Port 1"; Port = 42674 },
  @{Name = "DCS Port 2"; Port = 42675 },
  @{Name = "RDP"; Port = 3389 },
  @{Name = "DCS Web Interface"; Port = 8088 }
)

foreach ($rule in $rules) {
  New-NetFirewallRule -DisplayName "$($rule.Name) TCP $($rule.Port)" `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort $rule.Port `
    -Action Allow `
    -Profile Any

  if ($rule.Port -ne 3389) {
    New-NetFirewallRule -DisplayName "$($rule.Name) UDP $($rule.Port)" `
      -Direction Inbound `
      -Protocol UDP `
      -LocalPort $rule.Port `
      -Action Allow `
      -Profile Any
  }
}

Get-NetFirewallRule | Where-Object { 
  $_.DisplayName -like "*TCP*" -or $_.DisplayName -like "*UDP*" 
} | Select-Object DisplayName, Enabled, Direction, Action | Sort-Object DisplayName

# ------------------------ DCS-SRS
start-process "F:\DCS-SimpleRadio-Standalone\SR-Server.exe" -WorkingDirectory "F:\DCS-SimpleRadio-Standalone"

# ------------------------ DCS-SRS AUTOCONNECT
$publicIP = (Invoke-WebRequest -Uri "http://ifconfig.me/ip" -UseBasicParsing).Content.Trim()
$content = Get-Content "F:\DCS-SimpleRadio-Standalone\Scripts\DCS-SRS-AutoConnectGameGUI.lua" -Raw
$content = $content -replace 'SRSAuto\.SERVER_SRS_HOST = "127\.0\.0\.1"', "SRSAuto.SERVER_SRS_HOST = `"$publicIP`""

if (!(Test-Path "F:\Hooks")) {
  New-Item -ItemType Directory -Path "F:\Hooks"
}
$content | Set-Content "F:\Hooks\DCS-SRS-AutoConnectGameGUI.lua" -Force

if (Test-Path "F:\Hooks\DCS-SRS-AutoConnectGameGUI.lua") {
  Write-Host "File successfully created at F:\Hooks\DCS-SRS-AutoConnectGameGUI.lua"
  Write-Host "Public IP used: $publicIP"
}
else {
  Write-Host "Error: File creation failed"
}
